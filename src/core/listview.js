// The game's storage list: about 12 Pokémon per screenshot, each a tile with its CP, a sprite,
// its name and a green bar under the name. Read: the tiles (by their bars), name and CP per tile,
// the search's result count from the header and the search field's text. Screenshots of one
// search, scrolled, are stitched into one list by the tiles they share.
//
// Positions are fractions of the screenshot's width (W), as in image.js: the list scales with
// the width on every phone seen (iPhone 17 Pro 1206 px, iPhone 8 750 px).
import { crop, thresholdDarkText } from './image.js';
import { readNameTokens } from './namereader.js';
import { parseName } from './tilename.js';

/** The tile's parts, relative to its bar (y: the bar's top; x: the bar's centre), in W. */
export const TILE = Object.freeze({
	pitch: 0.361,	// from one row of tiles to the next
	name: { dy0: -0.062, dy1: -0.006, w: 0.27 },	// narrow: the scroll widget sits at the right edge
	sprite: { dy0: -0.215, dy1: -0.068, w: 0.20 },
	cp: { dy0: -0.300, dy1: -0.235, w: 0.30 },
});

/** The green bar under a tile's name (iPhone 17: 110,238,184; iPhone 8: 143,235,187). */
const isBar = (r, g, b) => g > 200 && g - r > 60 && g - b > 25 && g - b < 80 && b > 140;

/**
 * The tiles' bars: [{x, y, x0, x1, col}] sorted by row, then column. A bar under a floating
 * button or cut by the screen's edge is not found; its tile is read from another screenshot.
 */
export function findBars(img) {
	const { width: W, height: H, data } = img;
	const runs = [];
	for (let y = 0; y < H; y++) {
		let start = -1;
		for (let x = 0; x <= W; x++) {
			const i = (y * W + x) * 4;
			const on = x < W && isBar(data[i], data[i + 1], data[i + 2]);
			if (on && start < 0) start = x;
			if (!on && start >= 0) {
				if (x - start > 0.09 * W && x - start < 0.2 * W) runs.push({ y, x0: start, x1: x - 1 });
				start = -1;
			}
		}
	}
	const bars = [];
	for (const r of runs) {
		const b = bars.find(t => Math.abs(t.x0 - r.x0) < 0.01 * W && r.y - t.y1 <= 2 && r.y >= t.y1);
		if (b) { b.y1 = r.y; b.x0 = Math.min(b.x0, r.x0); b.x1 = Math.max(b.x1, r.x1); } else bars.push({ y0: r.y, y1: r.y, x0: r.x0, x1: r.x1 });
	}
	return bars.filter(b => b.y1 - b.y0 >= 0.003 * W)
		.map(b => ({ x: Math.round((b.x0 + b.x1) / 2), y: b.y0, x0: b.x0, x1: b.x1, col: Math.min(2, Math.floor(((b.x0 + b.x1) / 2) / (W / 3))) }))
		.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The columns' centres, in W. */
const COLS = [0.183, 0.5, 0.815];

/**
 * A list view, not a Pokémon's page or an appraisal: at least one tile bar sits at a column of
 * the grid (18, 50, 82 % of the width) with a tile bar's width (13.5 %). A Pokémon's page has
 * no such bar (its only bar-like shape is at 41 % and 10.5 % wide on the iPhone 17).
 */
export function isListView(img, bars = findBars(img)) {
	const W = img.width;
	return bars.some(b => {
		const w = b.x1 - b.x0 + 1;
		return w >= 0.12 * W && w <= 0.16 * W && COLS.some(c => Math.abs(b.x - c * W) <= 0.025 * W);
	});
}

/** Bars → rows of the grid: [{y, slots: [bar|null, bar|null, bar|null]}]. */
export function gridRows(bars, W) {
	const rows = [];
	for (const b of bars) {
		let r = rows.find(t => Math.abs(t.y - b.y) < 0.03 * W);
		if (!r) rows.push(r = { y: b.y, slots: [null, null, null] });
		r.slots[b.col] = b;
	}
	return rows.sort((a, b) => a.y - b.y);
}

/** A box of a tile part, clipped to the image; null when it would leave the screenshot. */
export function partBox(img, bar, part) {
	const W = img.width, p = TILE[part];
	const y = Math.round(bar.y + p.dy0 * W), h = Math.round((p.dy1 - p.dy0) * W);
	const w = Math.round(p.w * W), x = Math.round(bar.x - w / 2);
	if (y < 0 || x < 0 || x + w > img.width || y + h > img.height) return null;
	return { x, y, w, h };
}

// ---------- what lies over the list: the header's edge, the scroll pill ----------

/** Header white: the header's background (250,255,248); the list's is greener (244,255,240). */
const hwhite = (d, i) => d[i] >= 246 && d[i + 1] >= 246 && d[i + 2] >= 246;

/**
 * Where the header ends and the list begins (y), or null. The header's background is white
 * across the width; the list's is tinted at both sides and behind its tiles. The last band of
 * white rows (at least 0.02 W) above 0.85 W is the header's lower part (under "SHOW EVOLUTIONARY
 * LINE"); its last row + 1 is the edge. A tile's CP half above it is read wrong (184 for 164).
 */
export function headerBottom(img) {
	const { width: W, data } = img;
	let run = 0, edge = null;
	for (let y = Math.round(0.25 * W); y < Math.round(0.85 * W) && y < img.height; y++) {
		let n = 0, k = 0;
		for (let x = Math.round(0.05 * W); x < 0.95 * W; x += 4, k++) if (hwhite(data, (y * W + x) * 4)) n++;
		if (n >= 0.93 * k) run++;
		else { if (run >= 0.02 * W) edge = y; run = 0; }
	}
	return edge;
}

/**
 * The scroll pill (the white "⌃⌄" at the right edge, shown while and after scrolling), or null:
 * {x0, y0, y1}. Rows where 0.915-0.955 W is white or the pill's teal chevrons, 0.08-0.16 W tall,
 * below the header and above the floating buttons.
 */
export function scrollPill(img, top = headerBottom(img)) {
	const { width: W, height: H, data } = img;
	const xa = Math.round(0.915 * W), xb = Math.round(0.955 * W);
	const on = i => hwhite(data, i) || (data[i] < 170 && data[i + 1] - data[i] > 20);
	let start = -1, last = -1, best = null;
	const y0 = Math.max(top ?? 0, Math.round(0.5 * W)) + 1, y1 = H - Math.round(0.30 * W);
	for (let y = y0; y <= y1; y++) {
		let n = 0;
		if (y < y1) for (let x = xa; x < xb; x++) if (on((y * W + x) * 4)) n++;
		// a few rows less white (the chevrons' anti-aliased strokes) don't end the pill
		if (y < y1 && n >= 0.5 * (xb - xa)) { if (start < 0) start = y; last = y; continue; }
		if (start >= 0 && (y >= y1 || y - last > 4)) {
			const h = last + 1 - start;
			if (h >= 0.08 * W && h <= 0.16 * W && (!best || h > best.y1 - best.y0)) best = { y0: start, y1: last };
			start = -1;
		}
	}
	if (!best) return null;
	const yc = (best.y0 + best.y1) >> 1;
	let x0 = xa;
	while (x0 > 0.8 * W && hwhite(data, (yc * W + x0 - 1) * 4)) x0--;
	return { x0, ...best };
}

/** Text ink (the tiles' dark grey and the name's circles; not the sparkles of a shiny). */
const ink = (d, i) => d[i] + d[i + 1] + d[i + 2] < 350;

/**
 * A text box (name or CP) cropped, with the scroll pill painted white; null when the text runs
 * under the pill. Per row: the pill's left edge, found from inside its white left part (0.01 W
 * right of its widest edge) leftwards, or rightwards at its rounded ends, and 0.004 W of its
 * shadow. (The pill over "CP 418" was read "4182".)
 * - A CP (kind 'cp'): ink within 0.004 W of the pill's white in any row is a digit running under
 *   it. The CP's digits are tall and plain; "CP 2768" ends 8 px before the pill's white and is read.
 * - A name ('name'): centred on the tile's bar (the box's centre), so its left end mirrored is
 *   where it should end; when that lies at the pill and the ink seen ends short of it, the rest
 *   is hidden (the pill hid a name's last digit behind a gap). Not by touch: a name that ends
 *   2 px from the pill's rounded end is whole.
 */
export function cropBesidePill(img, box, pill, kind = 'cp') {
	const c = crop(img, box);
	if (!pill) return c;
	const { width: W, data } = img, sh = Math.round(0.004 * W), gap = Math.round(0.003 * W);
	const x1 = pill.x0 + Math.round(0.01 * W), xt = Math.round(0.925 * W);
	const white = (x, y) => hwhite(data, (y * W + x) * 4);
	// the pill's edge per row of the box (null: not beside the pill in that row)
	const edges = [];
	for (let y = box.y; y < box.y + box.h; y++) {
		let e = null;
		if (y >= pill.y0 && y <= pill.y1) {
			let x = x1;
			if (white(x, y)) { while (x > box.x && white(x - 1, y)) x--; e = x - sh; }
			else { while (x < xt && !white(x, y)) x++; if (x < xt) e = x - sh; }
		}
		edges.push(e != null && e < box.x + box.w ? e : null);
	}
	if (edges.every(e => e == null)) return c;
	if (kind === 'cp') {
		const near = Math.round(0.004 * W);
		for (let k = 0; k < edges.length; k++) {
			const e = edges[k], y = box.y + k;
			if (e != null) for (let x = Math.max(box.x, e + sh - near); x < e + sh; x++) if (ink(data, (y * W + x) * 4)) return null;
		}
	} else {
		let left = box.x + box.w, right = box.x - 1;
		edges.forEach((e, k) => {
			const y = box.y + k, end = e ?? box.x + box.w;
			for (let x = box.x; x < end; x++) if (ink(data, (y * W + x) * 4)) { left = Math.min(left, x); right = Math.max(right, x); }
		});
		const mirror = 2 * box.x + box.w - left, near = Math.min(...edges.filter(e => e != null));
		if (right >= box.x && mirror + gap >= near && right < mirror - Math.round(0.005 * W)) return null;
	}
	edges.forEach((e, k) => { if (e != null) for (let x = Math.max(box.x, e); x < box.x + box.w; x++) c.data.set([255, 255, 255, 255], (k * box.w + x - box.x) * 4); });
	return c;
}

// ---------- text ----------

/** "CP 1234", "CP1234", "cp 1234" → 1234 */
export function parseTileCp(s) {
	const m = /c?p?\s*(\d{2,5})/i.exec(String(s || '').replace(/[oO]/g, '0').replace(/\s+/g, ' '));
	return m ? Number(m[1]) : null;
}

/** The header's "(50)": the search's result count. */
export function parseCount(s) {
	const m = /\(\s*(\d{1,5})\s*\)/.exec(String(s || ''));
	return m ? Number(m[1]) : null;
}

// ---------- the search field ----------

/** The search field's fill (iPhone 17: 231,244,224): light, a little green, not white. */
const isField = (d, i) => { const r = d[i], g = d[i + 1], b = d[i + 2]; return g >= 225 && g < 250 && g - r >= 6 && g - b >= 8 && r >= 200; };
const lumAt = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * The search field, found by what it is, never by a place on the screen: the rounded bar of the
 * field's fill under the tabs, the widest band of it in the top part of the screen; in it, the
 * magnifier (the first dark shape from the left) and the clear button's divider (a column a
 * little darker over most of the bar's height, near its right end).
 * → {x0, x1, y0, y1, text: {x, y, w, h}} or null (no field seen).
 */
export function searchField(img) {
	const { width: W, height: H, data } = img;
	const yEnd = Math.min(H - 1, Math.round(0.9 * W));
	// rows where the fill covers at least 20 % of 0.1-0.98 W and fill or text 60 % (a row through
	// a long search's letters keeps about 40 % of fill)
	const band = [];
	for (let y = Math.round(0.1 * W); y < yEnd; y++) {
		let n = 0, m = 0, k = 0;
		for (let x = Math.round(0.1 * W); x < 0.98 * W; x += 3, k++) {
			const i = (y * W + x) * 4;
			if (isField(data, i)) n++;
			else if (!hwhite(data, i)) m++;
		}
		band.push(n >= 0.2 * k && n + m >= 0.6 * k);
	}
	// the longest run of a field's height (on a dimmed screen the tiles' background passes as
	// fill too, in a run far too tall)
	let best = null;
	for (let i = 0; i < band.length;) {
		if (!band[i]) { i++; continue; }
		let j = i;
		while (j + 1 < band.length && (band[j + 1] || (band[j + 2] && j + 2 < band.length))) j++;
		const h = j - i;
		if (h >= 0.05 * W && h <= 0.16 * W && (!best || h > best.y1 - best.y0)) best = { y0: i + Math.round(0.1 * W), y1: j + Math.round(0.1 * W) };
		i = j + 1;
	}
	if (!best) return null;
	const { y0, y1 } = best;
	// its ends: the longest run of the fill (gaps under 0.08 W: the magnifier, letters) on rows a
	// quarter and three quarters down; the back arrow's side of the screen is not part of it
	const ends = y => {
		let out = [-1, -1], a = -1, last = -1;
		for (let x = 0; x < W; x++) {
			if (!isField(data, (y * W + x) * 4)) continue;
			if (a < 0 || x - last > 0.08 * W) a = x;
			last = x;
			if (last - a > out[1] - out[0]) out = [a, last];
		}
		return out;
	};
	const [a1, b1] = ends(Math.round(y0 + 0.25 * (y1 - y0))), [a2, b2] = ends(Math.round(y0 + 0.75 * (y1 - y0)));
	const x0 = Math.max(a1, a2), x1 = Math.min(b1, b2);
	if (x0 < 0 || x1 - x0 < 0.5 * W) return null;
	const dark = (x, y) => lumAt(data, (y * W + x) * 4) < 170;
	const colDark = x => { let n = 0; for (let y = y0; y <= y1; y++) if (dark(x, y)) n++; return n; };
	// the magnifier: the first dark columns from the left; its end, where 0.015 W of no dark follows
	let mx0 = -1, mx1 = -1, gap = 0;
	for (let x = x0; x < x0 + 0.25 * W && x < x1; x++) {
		const on = colDark(x) > 0;
		if (on) { if (mx0 < 0) mx0 = x; mx1 = x; gap = 0; } else if (mx0 >= 0 && ++gap > 0.015 * W) break;
	}
	if (mx0 < 0 || mx1 - mx0 > 0.09 * W || mx1 - mx0 < 0.02 * W) return null;
	// the clear button's divider: a thin column a little darker than the fill (iPhone 17: 212,226,
	// 212 on 231,244,224) over half the bar's height, with no dark text in it; the rightmost one
	// in the last 0.25 W of the field (the ⊗ ring right of it is dark), from 0.03 W inside the
	// field's end, whose rounded edge passes on a dimmed screen
	let div = -1;
	for (let x = x1 - Math.round(0.03 * W); x > x1 - 0.25 * W; x--) {
		let n = 0, d = 0;
		for (let y = y0; y <= y1; y++) { const l = lumAt(data, (y * W + x) * 4); if (l < 170) d++; else if (l > 195 && l < 232) n++; }
		if (n >= 0.5 * (y1 - y0) && d <= 2) { div = x; break; }
	}
	const tx0 = mx1 + Math.round(0.01 * W), tx1 = (div > 0 ? div : x1 - Math.round(0.1 * W)) - Math.round(0.012 * W);
	const pad = Math.round(0.18 * (y1 - y0));
	if (tx1 - tx0 < 0.2 * W) return null;
	return { x0, x1, y0, y1, text: { x: tx0, y: y0 + pad, w: tx1 - tx0, h: y1 - y0 - 2 * pad } };
}

/** The search field's text: '' when the field shows none, null when no field was found. */
export async function readSearchField(img, engine, f = searchField(img)) {
	if (!f) return null;
	const { data, width: W } = img;
	let any = false;
	for (let y = f.text.y; y < f.text.y + f.text.h && !any; y++) for (let x = f.text.x; x < f.text.x + f.text.w; x += 2) if (lumAt(data, (y * W + x) * 4) < 150) { any = true; break; }
	if (!any) return '';
	return (await engine.line(thresholdDarkText(crop(img, f.text), 150), '', '7')).trim();
}

/**
 * Is the field's text this search? The reader's slips cost nothing: case, spaces, and ! i l I |
 * 1 for one another (a run of them counts once: "!xxs" read "!Ixxs"). Short searches ("xxl")
 * must match whole; from 8 letters on one character may be off. → true, false, or null when
 * the field wasn't seen or shows nothing.
 */
export function fieldIs(text, search) {
	if (text == null || text === '' || !search) return null;
	const norm = x => String(x || '').toLowerCase().replace(/\s+/g, '').replace(/[!il|1]/g, 'l').replace(/l+/g, 'l').replace(/&/g, '8');
	const t = norm(text), s = norm(search);
	if (t === s) return true;
	if (s.length < 8) return false;
	let prev = Array.from({ length: s.length + 1 }, (_, j) => j);
	for (let i = 1; i <= t.length; i++) {
		const cur = [i];
		for (let j = 1; j <= s.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (t[i - 1] === s[j - 1] ? 0 : 1));
		prev = cur;
	}
	return prev[s.length] <= 1;
}

// ---------- reading one screenshot ----------

/** The header's count sits between the top and the search field, in the middle third. */
const COUNT_BOX = { x: 0.30, w: 0.40, y0: 0.08, y1: 0.30 };
/** The scroll pill's glass halo round it, in W (it fades a level ring 0.002-0.02 W above it). */
const HALO = 0.02;

/**
 * One list screenshot → {count, field, num, pill, rows: [{y, slots: [tile | 'covered' | 'empty'
 * ×3]}]}: tile {col, cp, name, p (the name parsed, tilename.js), cut, under?}. A tile whose CP
 * lies above the visible list (scrolled under the header) has cp null and cut true; its name
 * still stitches it to the screenshot before. count: the header's number; field: the search
 * field's text (readSearchField); num: sorted by number (sortedByNumber).
 * @param {ReturnType<import('./pipeline.js').tesseractEngine>} engine
 */
export async function readListShot(img, engine) {
	const W = img.width;
	const rows = gridRows(findBars(img), W);
	const top = headerBottom(img), pill = scrollPill(img, top);
	const box = { x: Math.round(COUNT_BOX.x * W), y: Math.round(COUNT_BOX.y0 * W), w: Math.round(COUNT_BOX.w * W), h: Math.round((COUNT_BOX.y1 - COUNT_BOX.y0) * W) };
	const count = parseCount(await engine.line(thresholdDarkText(crop(img, box), 170), '()0123456789/ ', '6'));
	const out = [];
	for (const r of rows) {
		const slots = [];
		for (let col = 0; col < 3; col++) {
			let b = r.slots[col];
			// a bar under a floating button: the tile's other parts may still show
			const state = b ? null : slotState(img, r.y, col);
			const hidden = state === 'covered';
			if (!b && !hidden) { slots.push('empty'); continue; }
			if (!b) b = { x: Math.round(COLS[col] * W), y: r.y, col };
			const vis = part => { const x = partBox(img, b, part); return x && !underButton(img, x) ? x : null; };
			// a text whose glyphs reach above the header's edge is half hidden: the CP's digits
			// start 0.014 W below its box's top, the name's 0.006 W
			const below = (x, dy) => x && (top == null || x.y + dy * W >= top) ? x : null;
			const nv = below(vis('name'), 0.005), cv = below(vis('cp'), 0.012), sb = vis('sprite');
			const ni = nv && cropBesidePill(img, nv, pill, 'name'), ci = cv && cropBesidePill(img, cv, pill, 'cp');
			const nb = ni ? nv : null, cb = ci ? cv : null;
			const nbox = partBox(img, b, 'name'), under = (!!nbox && underButton(img, nbox)) || (!!nv && !nb);
			if (hidden && !cb && !sb) { slots.push('covered'); continue; }
			// the pill's glass halo, 0.02 W round it, in the name's pixels
			const halo = pill && nv && { x0: pill.x0 - HALO * W - nv.x, y0: pill.y0 - HALO * W - nv.y, y1: pill.y1 + HALO * W - nv.y };
			const p = nb ? parseName(await readNameTokens(ni, engine, { pill: halo })) : null;
			const cp = cb ? parseTileCp(await engine.line(thresholdDarkText(ci, 150), 'CP0123456789', '7')) : null;
			// no CP read: the tile is scrolled under the header (or the CP is covered)
			const cut = !cb || !sb || cp == null;
			// a place under a button with nothing read on it: no Pokémon seen
			if (hidden && cp == null && !(p && p.raw)) { slots.push('covered'); continue; }
			const tile = { col, name: p ? p.raw : null, p, cp, cut };
			if (hidden || !nb) tile.partial = true;
			if (under) tile.under = true;
			slots.push(tile);
		}
		out.push({ y: r.y, slots });
	}
	const field = await readSearchField(img, engine);
	return { count, field, rows: out, pill: pill ? pill.y0 : null, num: sortedByNumber(img) };
}

// ---------- the floating buttons; the sort ----------

/**
 * The floating buttons over the list (close, tags and the tag button's arrow badge), in W from the
 * bottom and the left: the close button 0.057 W in radius, the tag button 0.083 W, its badge to
 * the right at its centre's height; each with about 0.01 W to spare (both phones measured).
 */
const BUTTONS = [{ x: 0.5, dy: 0.131, r: 0.068 }, { x: 0.862, dy: 0.131, r: 0.093 }, { x: 0.937, dy: 0.131, r: 0.035 }];

/**
 * Is the list sorted by number? The sort button (the tag button's place) shows "#" then: two
 * horizontal strokes 0.012-0.026 W apart, and every other row of the glyph two narrow slanted
 * ones. Read within 0.04 W of the button's centre (its ring lies further out).
 * → true ("#"), false (another icon), null (no icon seen there).
 */
export function sortedByNumber(img) {
	const { width: W, height: H, data } = img;
	const cx = Math.round(BUTTONS[1].x * W), cy = Math.round(H - BUTTONS[1].dy * W), R = Math.round(0.04 * W);
	if (cy + R >= H || cy - R < 0) return null;
	const light = (x, y) => { const i = (y * W + x) * 4; return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] > 150; };
	const rows = [];
	for (let y = cy - R; y <= cy + R; y++) {
		const runs = [];
		let s = -1;
		for (let x = cx - R; x <= cx + R + 1; x++) {
			const on = x <= cx + R && light(x, y);
			if (on && s < 0) s = x;
			else if (!on && s >= 0) { runs.push(x - s); s = -1; }
		}
		if (runs.length) rows.push({ y, runs });
	}
	if (rows.length < 0.03 * W) return null;
	const band = r => r.runs.some(w => w >= 0.03 * W);
	const bands = [];
	for (const r of rows) if (band(r)) { const b = bands[bands.length - 1]; if (b && r.y - b.y1 <= 2) b.y1 = r.y; else bands.push({ y0: r.y, y1: r.y }); }
	if (bands.length !== 2 || bands.some(b => b.y1 - b.y0 > 0.012 * W)) return false;
	const gap = (bands[1].y0 + bands[1].y1 - bands[0].y0 - bands[0].y1) / 2;
	if (gap < 0.012 * W || gap > 0.026 * W) return false;
	const other = rows.filter(r => !band(r));
	const two = other.filter(r => r.runs.length === 2 && r.runs.every(w => w <= 0.014 * W)).length;
	return other.length >= 0.02 * W && two >= 0.85 * other.length;
}

/** Does a box overlap a floating button? */
function underButton(img, box) {
	const W = img.width;
	return BUTTONS.some(b => {
		const bx = b.x * W, by = img.height - b.dy * W, r = b.r * W;
		const nx = Math.max(box.x, Math.min(bx, box.x + box.w)), ny = Math.max(box.y, Math.min(by, box.y + box.h));
		return (nx - bx) ** 2 + (ny - by) ** 2 < r * r;
	});
}

/**
 * A missing tile in a row: under a floating button (covered: read it from another screenshot)
 * or none there (empty: the list ends).
 */
export function slotState(img, rowY, col) {
	const W = img.width, cx = (col + 0.5) * (W / 3);
	for (const b of BUTTONS) {
		const bx = b.x * W, by = img.height - b.dy * W, r = b.r * W;
		// the tile's name and bar: a box around the bar's place
		const nx = Math.max(cx - 0.15 * W, Math.min(bx, cx + 0.15 * W)), ny = Math.max(rowY - 0.07 * W, Math.min(by, rowY + 0.01 * W));
		if ((nx - bx) ** 2 + (ny - by) ** 2 < r * r) return 'covered';
	}
	return rowY > img.height - 0.06 * img.width ? 'covered' : 'empty';
}

// ---------- stitching screenshots ----------

/** A name read for sure: Attack in its disc, IV % and level. */
const complete = p => !!p && p.style === 'new' && p.atk != null && p.ivPct != null && p.level != null;
/** Complete, or without an IV % but with Attack and level. */
const usable = p => complete(p) || (!!p && p.style === 'new' && !!p.noPct && p.atk != null && p.level != null);

/**
 * Two complete names of one CP: the same Pokémon when at least two of Attack, IV % and level
 * agree. Not the text: the noise before the values differs from one reading to the next; two
 * agreeing values allow one misread digit. The game's count still checks the result.
 */
export function sameValues(p, q) {
	return (p.atk === q.atk) + (p.ivPct === q.ivPct) + (p.level === q.level) >= 2;
}

/**
 * A cut tile (its CP under the header) and another one, both with names read for sure: the same
 * Pokémon when IV %, Attack, level and the Max CP (where both read one) are all equal, so a
 * screenshot joins in front of the list through its last row, whatever order they come in.
 */
export function sameByName(a, b) {
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || !complete(a.p) || !complete(b.p)) return false;
	const p = a.p, q = b.p;
	return p.atk === q.atk && p.ivPct === q.ivPct && p.level === q.level && (p.maxCp == null || q.maxCp == null || p.maxCp === q.maxCp);
}

const normText = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Edit distance, small strings only. */
function lev(a, b) {
	const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
	for (let j = 1; j <= b.length; j++) d[0][j] = j;
	for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return d[a.length][b.length];
}

/** One plain name read twice: equal, or a stray mark at the end ("Pidove 7"), or one letter off. */
export function sameName(x, y) {
	const a = normText(x), b = normText(y);
	if (a === b) return true;
	if (!a || !b) return false;
	if ((a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2 && Math.min(a.length, b.length) >= 4) return true;
	return Math.min(a.length, b.length) >= 4 && lev(a, b) <= 1;
}

/**
 * Two slots of the same place in the list? A covered one fits anything. The same CP is the same
 * Pokémon when either name isn't read for sure; two names read for sure are compared by their
 * values, not their text (sameValues).
 */
function sameSlot(a, b) {
	if (a === 'covered' || b === 'covered') return true;
	if (a === 'empty' || b === 'empty') return a === b;
	// a cut tile's name is often half under the header: its place decides; two names read for
	// sure must agree
	if (a.cut || b.cut) return !(complete(a.p) && complete(b.p)) || sameValues(a.p, b.p);
	if (a.name == null || b.name == null) return a.cp === b.cp;	// the name under a button
	if (a.cp != null && a.cp === b.cp) return !complete(a.p) || !complete(b.p) || sameValues(a.p, b.p);
	return sameName(a.name, b.name) && a.cp === b.cp;
}

/** What the matching uses from a name differs (a rename, or a rescan's new values). */
const NAME_KEYS = ['atk', 'ivPct', 'level', 'prefix', 'shadow', 'purified', 'maxCp', 'pvp', 'noPct', 'halfMaybe'];
const renamed = (p, q, keys = NAME_KEYS) => keys.some(k => p[k] !== q[k]);
/**
 * A max CP misread ("2846" read "284¢" on one screenshot): three or more digits after the level
 * that didn't parse. Noise, not a rename: the reading that has the max CP wins.
 */
const junkMax = p => p.maxCp == null && /\[\d{1,2}\][^[\]()^]*\d{3}/.test(p.raw || '');
const onlyMaxCp = (p, q) => p.maxCp !== q.maxCp && (junkMax(p) || junkMax(q)) && !renamed(p, q, NAME_KEYS.filter(k => k !== 'maxCp'));

/**
 * The better of two readings of one tile: the complete one, else whatever is known. b is the
 * later screenshot; its name wins when read for sure and a's isn't, or when both are and what
 * the matching uses differs (the later one is the newer name); text noise alone keeps a's.
 */
function mergeSlot(a, b) {
	// the later screenshot is the one taken later (si: its place in the input), whatever order
	// the stitch laid them in
	if (typeof a === 'object' && typeof b === 'object' && a.si != null && b.si != null && b.si < a.si) return { ...mergeSlot(b, a), si: a.si };
	if (a === 'covered') return b;
	if (b === 'covered' || a === 'empty') return a;
	if (b === 'empty') return a;
	// a cut tile's name is half under the header: never taken over
	if (a.cut && !b.cut) return { ...b, seen: (a.seen || 1) + 1 };
	if (b.cut && !a.cut) return { ...a, seen: (a.seen || 1) + 1 };
	if (usable(a.p) && usable(b.p) && onlyMaxCp(a.p, b.p)) {
		const w = junkMax(a.p) ? b : a;
		return { ...a, name: w.name, p: w.p, cp: a.cp ?? b.cp, cut: false, under: undefined, seen: (a.seen || 1) + 1 };
	}
	if (usable(b.p) && (!usable(a.p) || renamed(a.p, b.p))) return { ...a, name: b.name, p: b.p, cp: a.cp ?? b.cp, cut: false, under: undefined, seen: (a.seen || 1) + 1 };
	const name = a.name ?? b.name;
	return { ...a, name, p: a.p ?? b.p, cp: a.cp ?? b.cp, cut: a.cut && b.cut, under: name == null && (a.under || b.under) ? true : undefined, seen: (a.seen || 1) + 1 };
}

/** A tile with nothing read on it (no CP, no name): no evidence of a Pokémon. */
const blank = t => typeof t === 'object' && t.cp == null && (t.name == null || t.name === '');

/**
 * How one screenshot (b) lies over another (a) with b's row 0 at a's row d: null when they
 * contradict, else {same, k, soft, clash}: tiles seen alike (a CP match, or a cut tile matched by
 * its name's values), rows overlapping, and CPs that differ where nothing else does (a misread
 * CP, "4182" for 418, doesn't veto an overlap the other tiles prove; at most one, with two tiles
 * seen alike when the names agree in every value, three when they can't tell).
 */
function overlap(a, b, d) {
	let same = 0, k = 0, soft = 0, full = true, clash = 0;
	for (let i = 0; i < b.length; i++) {
		const at = d + i;
		if (at < 0 || at >= a.length) continue;
		k++;
		for (let c = 0; c < 3; c++) {
			const x = a[at][c], y = b[i][c];
			if (sameSlot(x, y)) { if (exact(x, y)) same++; else if (clashes(x, y)) clash++; continue; }
			if ((blank(x) && y === 'empty') || (x === 'empty' && blank(y))) continue;
			// the same tile with a misread CP: names that don't contradict
			if (typeof x === 'object' && typeof y === 'object' && !x.cut && !y.cut && x.cp != null && y.cp != null && x.cp !== y.cp) {
				const both = complete(x.p) && complete(y.p);
				if (!both || sameByName(x, y)) { soft++; if (!both) full = false; continue; }
			}
			return null;
		}
	}
	if (soft > 1 || (soft === 1 && same < (full ? 2 : 3))) return null;
	return { same, k, soft, clash };
}

/**
 * Two names on one place that a cut tile lets pass (sameSlot) but whose values say otherwise:
 * two of Attack, IV % and level read on both, and two of them differ. A join without proof is
 * refused on it.
 */
function clashes(x, y) {
	if (typeof x !== 'object' || typeof y !== 'object' || !x.p || !y.p) return false;
	const keys = ['atk', 'ivPct', 'level'].filter(k => x.p[k] != null && y.p[k] != null);
	return keys.length >= 2 && keys.filter(k => x.p[k] !== y.p[k]).length >= 2;
}

/** Two readings of one tile that prove an overlap: one CP, or a cut one's values (sameByName). */
function exact(x, y) {
	return typeof x === 'object' && typeof y === 'object' && ((!x.cut && !y.cut && x.cp != null && x.cp === y.cp) || ((x.cut || y.cut) && sameByName(x, y)));
}

/** The most frequent of a list; a tie goes to the later one. */
function vote(xs, key = x => x) {
	const n = new Map();
	for (const x of xs) n.set(key(x), (n.get(key(x)) || 0) + 1);
	let best = null;
	for (const x of xs) if (best === null || n.get(key(x)) >= n.get(key(best))) best = x;
	return best;
}

/** What the matching uses from a name, as one key (the votes on names). */
const nameKey = p => JSON.stringify(NAME_KEYS.map(k => p[k]));

/**
 * One place in the list, from every screenshot that shows it: the readings folded (mergeSlot),
 * then the CP by vote of the screenshots that read one, and the name by vote among those read
 * for sure (one misread among many doesn't win by coming last).
 */
function mergeCell(list) {
	const objs = list.filter(t => typeof t === 'object'), real = objs.filter(t => !blank(t));
	if (!real.length) return list.includes('empty') ? 'empty' : objs.length ? objs[objs.length - 1] : 'covered';
	let m = real.reduce((a, b) => mergeSlot(a, b));
	if (real.length === 1) return m;
	const cps = real.filter(t => !t.cut && t.cp != null);
	if (cps.length) m = { ...m, cp: vote(cps, t => t.cp).cp };
	// a reading with its max CP misread doesn't vote while another reading is clean
	const us0 = real.filter(t => usable(t.p)), us = us0.some(t => !junkMax(t.p)) ? us0.filter(t => !junkMax(t.p)) : us0;
	if (us.length) {
		const pick = vote(us, t => nameKey(t.p));
		if (nameKey(pick.p) !== nameKey(m.p || {})) m = { ...m, name: pick.name, p: pick.p };
	}
	return m;
}

/**
 * Screenshots of one search → the list in order. Each screenshot: {rows: [{slots: [tile |
 * 'covered' | 'empty' ×3]}]} (readListShot).
 * - Every two screenshots are compared at every offset (overlap()); the best offset, when it
 *   proves itself and no other offset proves as much, joins them; without proof, two that meet
 *   end to end where nothing contradicts join last. Joins go strongest first, and one that
 *   contradicts screenshots already joined is left out. So no screenshot blocks another by the
 *   order it comes in, and a group without an overlap stays a group of its own.
 * - Nothing depends on the order the screenshots come in: they are taken in an order of their
 *   own content first (the Pokédex numbers at() gives their tiles, then what was read).
 * - Groups follow each other by content: the one reaching the list's end (an empty place) last,
 *   the others by the Pokédex numbers at(tile) gives their tiles; groups without numbers before
 *   the end one. An edge between two groups is proven when their numbers can only lie that way
 *   or the later one holds the list's end; else the first tile after it has brk.
 * - Each place takes all its readings (mergeCell): CP and name by vote.
 * at(tile): the Pokédex number a tile's reading gives for sure, else null.
 * @returns {{tiles: Array, covered: number, trailing: number, gaps: number, groups: [{lo, hi,
 *   end, n}], proven: [boolean]}} groups in list order (lo, hi: the numbers their tiles give;
 *   n: tiles), proven[k]: the edge between groups k and k + 1
 */
export function stitch(shots, { at = null } = {}) {
	const S = canonical(shots, at);
	const n = S.length;
	// each pair's offset that proves itself; an equal second one: no join (can't tell). Else one
	// where only places nothing contradicts overlap, and only end to end: the longest such
	const edges = [];
	for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
		let best = null, tie = false, weak = null, wtie = false;
		for (let d = -(S[j].length - 1); d <= S[i].length - 1; d++) {
			const o = overlap(S[i], S[j], d);
			if (!o) continue;
			if (o.same === 0) {
				const ends = (d > 0 && d + S[j].length > S[i].length) || (d < 0 && d + S[j].length < S[i].length);
				if (ends && o.soft === 0 && o.clash === 0) { if (!weak || o.k > weak.k) { wtie = false; weak = { ...o, d }; } else if (o.k === weak.k) wtie = true; }
				continue;
			}
			const better = !best || o.same > best.same || (o.same === best.same && (o.soft < best.soft || (o.soft === best.soft && o.k > best.k)));
			if (better) { tie = !!best && o.same === best.same && o.soft === best.soft && o.k === best.k; best = { ...o, d }; }
			else if (o.same === best.same && o.soft === best.soft && o.k === best.k) tie = true;
		}
		if (best && !tie) edges.push({ i, j, ...best });
		else if (!best && weak && !wtie) edges.push({ i, j, ...weak });
	}
	// strongest first; joins without proof: screenshots next to each other first, the later one
	// continuing the earlier one's end
	edges.sort((x, y) => y.same - x.same || x.soft - y.soft || (x.same === 0 ? (x.j - x.i) - (y.j - y.i) || (y.d > 0) - (x.d > 0) : 0) || y.k - x.k || x.i - y.i || x.j - y.j);
	// groups: a screenshot's group and its row 0's place there
	const group = S.map((_, i) => i), pos = S.map(() => 0);
	const members = g => group.map((x, i) => (x === g ? i : -1)).filter(i => i >= 0);
	for (const e of edges) {
		const gi = group[e.i], gj = group[e.j];
		if (gi === gj) continue;
		const shift = pos[e.i] + e.d - pos[e.j];
		const A = members(gi), B = members(gj);
		// the whole of both groups must agree at that shift (soft CPs as in overlap(); a join
		// without proof tolerates no more)
		let ok = true;
		for (const a of A) for (const b of B) {
			const d = pos[b] + shift - pos[a];
			if (d > S[a].length - 1 || d < -(S[b].length - 1)) continue;
			if (!overlap(S[a], S[b], d) && !looseOverlap(S[a], S[b], d, e.same ? Infinity : 1)) ok = false;
		}
		if (!ok) continue;
		for (const b of B) { group[b] = gi; pos[b] += shift; }
	}
	// the groups, each place read by every screenshot over it, and the numbers its tiles give
	const built = [...new Set(group)].map(g => {
		const m = members(g).sort((a, b) => S[a].late - S[b].late), lo = Math.min(...m.map(i => pos[i]));
		const len = Math.max(...m.map(i => pos[i] - lo + S[i].length));
		const cells = Array.from({ length: len }, () => [[], [], []]);
		for (const i of m) S[i].forEach((r, ri) => r.forEach((t, c) => cells[pos[i] - lo + ri][c].push(t)));
		const rows = cells.map(r => r.map(list => mergeCell(list)));
		const run = at ? numberRun(rows.flat().filter(t => typeof t === 'object').map(t => at(t)).filter(x => x != null)) : [];
		return { rows, first: Math.min(...m), end: m.some(i => S[i].some(r => r.includes('empty'))), lo: run.length ? run[0] : null, hi: run.length ? run[run.length - 1] : null };
	});
	// the groups in order: by their numbers, those without before the one with the list's end,
	// which is last; equal numbers by the canonical order (content, never the import's)
	const byNum = (x, y) => (x.lo == null) - (y.lo == null) || (x.lo ?? 0) - (y.lo ?? 0) || (x.hi ?? 0) - (y.hi ?? 0) || x.first - y.first;
	const ordered = [...built.filter(x => !x.end).sort(byNum), ...built.filter(x => x.end).sort(byNum)];
	const proven = ordered.slice(1).map((y, k) => provenEdge(ordered[k], y));
	const rows = [], starts = new Set();
	for (const x of ordered) { starts.add(rows.length); rows.push(...x.rows); }
	// trailing: the covered places after the list's last tile (a short list's empty bottom-right
	// place beside the # button), only where the last group is proven last
	const lastProven = ordered.length === 1 || ordered[ordered.length - 1].end || proven[proven.length - 1];
	const tiles = [];
	let covered = 0, trailing = 0, g = -1, brk = false;
	rows.forEach((r, i) => {
		if (starts.has(i)) { g++; if (g > 0 && !proven[g - 1]) brk = true; }
		r.forEach((t, c) => {
			if (t === 'covered') { covered++; trailing++; }
			else if (t !== 'empty') { const { si, late, ...rest } = t; tiles.push({ ...rest, row: i, col: c, ...(brk ? { brk: true } : {}) }); brk = false; trailing = 0; }
		});
	});
	const sizes = ordered.map(x => x.rows.flat().filter(t => typeof t === 'object' && t !== null).length);
	return { tiles, covered, trailing: lastProven ? trailing : 0, gaps: ordered.length - 1, groups: ordered.map((x, k) => ({ lo: x.lo, hi: x.hi, end: x.end, n: sizes[k] })), proven };
}

/**
 * The screenshots in an order of their own content: by the middle Pokédex number at() gives
 * their tiles (none: last), then by what was read. Each tile keeps late, its screenshot's place
 * in that order: mergeSlot's "the later reading", so a shuffle changes nothing.
 */
function canonical(shots, at) {
	const plain = t => (t && typeof t === 'object' ? (({ si, late, ...r }) => r)(t) : t);
	const keyed = shots.map(s => {
		const nums = at ? s.rows.flatMap(r => r.slots).filter(t => t && typeof t === 'object').map(t => at(t)).filter(x => x != null).sort((a, b) => a - b) : [];
		return { s, mid: nums.length ? nums[nums.length >> 1] : null, text: JSON.stringify(s.rows.map(r => r.slots.map(plain))) };
	});
	keyed.sort((x, y) => (x.mid == null) - (y.mid == null) || (x.mid ?? 0) - (y.mid ?? 0) || (x.text < y.text ? -1 : x.text > y.text ? 1 : 0));
	return keyed.map(({ s }, i) => Object.assign(s.rows.map(r => r.slots.map(t => (t && typeof t === 'object' ? { ...t, si: i } : t))), { late: i }));
}

/** The longest run of numbers in list order that never goes down (a stray one left out). */
function numberRun(xs) {
	const len = xs.map(() => 1), prev = xs.map(() => -1);
	for (let i = 0; i < xs.length; i++) for (let j = 0; j < i; j++) if (xs[j] <= xs[i] && len[j] + 1 > len[i]) { len[i] = len[j] + 1; prev[i] = j; }
	let b = 0;
	for (let i = 1; i < xs.length; i++) if (len[i] > len[b]) b = i;
	const out = [];
	for (let i = xs.length ? b : -1; i >= 0; i = prev[i]) out.unshift(xs[i]);
	return out;
}

/**
 * Group x before group y, proven: y holds the list's end, or their numbers allow only this way
 * (x's last <= y's first, and not one species filling both); never when the numbers say the
 * other way.
 */
function provenEdge(x, y) {
	const nums = x.hi != null && y.lo != null;
	if (nums && y.hi < x.lo) return false;
	if (y.end && !x.end) return true;
	return nums && x.hi <= y.lo && !(y.hi <= x.lo);
}

/**
 * Two screenshots in one group that overlap without a tile seen alike: no contradiction only.
 * CPs that differ where the names can't tell pass as misreads: any number for a join an overlap
 * proves (a row read half under the header), at most one (maxSoft) for a join without proof.
 */
function looseOverlap(a, b, d, maxSoft = Infinity) {
	let soft = 0;
	for (let i = 0; i < b.length; i++) {
		const at = d + i;
		if (at < 0 || at >= a.length) continue;
		for (let c = 0; c < 3; c++) {
			const x = a[at][c], y = b[i][c];
			if (sameSlot(x, y) || (blank(x) && y === 'empty') || (x === 'empty' && blank(y))) continue;
			if (typeof x === 'object' && typeof y === 'object' && !x.cut && !y.cut && x.cp != null && y.cp != null && (!(complete(x.p) && complete(y.p)) || sameByName(x, y))) { if (++soft > maxSoft) return null; continue; }
			return null;
		}
	}
	return true;
}
