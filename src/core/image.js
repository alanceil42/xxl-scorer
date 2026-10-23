// Pixel helpers on ImageData-like objects {width, height, data: Uint8ClampedArray RGBA}.
// Pure: used in the browser (canvas ImageData) and in Node tests (decoded PNG).

/**
 * Regions in units of the card column's width (cardColumn; on a phone, the screenshot's width).
 * The game lays out the top of the screen (CP, sprite, info card down to the stats row) from that
 * width: the HP bar sits at 0.98 W on a 750 × 1334 iPhone 8 and on a 1206 × 2622 iPhone 17 Pro
 * alike. What sits at the bottom (the appraisal, the "was caught" line) is laid out from the
 * bottom edge, so on a shorter screen it covers more of the card.
 */
export const REGIONS = Object.freeze({
	cp: { x: 0.30, y: 0.10, w: 0.40, h: 0.11 },
	sprite: { x: 0.14, y: 0.152, w: 0.72, h: 0.577 },
	// the name or nickname, above the HP bar; with "LUCKY POKÉMON" the bar moves, the name doesn't
	name: { x: 0.12, y: 0.878, w: 0.66, h: 0.074 },
	// the catch year pill at the card's top right corner (only for Pokémon caught in an earlier
	// year): "2024" over "04/04"
	year: { x: 0.74, y: 0.76, w: 0.26, h: 0.19 },
});

/**
 * The column the game lays the card out in. A phone screen is 9:16 or taller, and the game sizes
 * everything by its width. A wider screen (an iPad's 1640 × 2360) gets the layout of a 9:16 phone
 * as tall as the screen, centred: the card's contents, CP and sprite sit in that column, and only
 * backgrounds and the "was caught" line reach beyond it. Measured on an iPad: the HP bar's ends at
 * 0.300 and 0.699 of the screen's width are 0.25 and 0.74 of the column's, as on the iPhones.
 * @returns {{x: number, w: number}}  left edge and width in px; the whole width on a phone
 */
export function cardColumn(width, height) {
	const w = Math.round(height * 9 / 16);
	// 16:9 screens are a pixel or so off it (an iPhone SE's 640 × 1136): the whole width
	if (width <= w * 1.02) return { x: 0, w: width };
	return { x: Math.floor((width - w) / 2), w };
}

/** The screenshot cut to its card column (cardColumn); the screenshot itself on a phone. */
export function columnOf(img) {
	const c = cardColumn(img.width, img.height);
	return c.w === img.width ? img : crop(img, { x: c.x, y: 0, w: c.w, h: img.height });
}

/**
 * The HP bar under the name: a thin horizontal bar, green (yellow or red when hurt), centred on
 * the info card. Everything in the stats row sits at a fixed distance below it, whatever lines
 * come between name and bar ("LUCKY POKÉMON" pushes the bar down), so it anchors the crops of
 * statsBoxes.
 * @returns {{y: number, x0: number, x1: number} | null}  y = centre row, x0/x1 = ends of the fill
 */
export function findHpBar(img) {
	const { width: W, height: H, data } = img;
	// green on a white card; under the appraisal the card is tinted, and Mystic's blue tint turns
	// the bar teal (90, 179, 172), with the card itself (136, 178, 196) not much less green
	const green = i => { const r = data[i], g = data[i + 1], b = data[i + 2]; return g > 120 && g - r > 40 && g > b; };
	const hurt = i => {
		const r = data[i], g = data[i + 1], b = data[i + 2];
		return (r > 200 && g > 170 && b < 120) || (r > 180 && g < 110 && b < 110);	// yellow, red
	};
	// Green first. A yellow or red run must cross the middle: the year badge on the card's
	// right edge is the same orange.
	const mid = (x0, x1) => x0 < W / 2 && x1 > W / 2;
	// At 0.98 W, 1.03 W with "LUCKY POKÉMON" (REGIONS); 0.93-1.05 W on other phones, or with the
	// card pushed up a little.
	const usual = [Math.floor(W * 0.78), Math.min(H, W * 1.17)];
	// A screenshot cut off at the top by 0.11 W (players crop the status bar away before
	// posting) still has it at 0.875 W.
	return scanBar(img, green, () => true, usual) || scanBar(img, hurt, mid, usual);
}

function scanBar(img, fill, accept, [ya, yb]) {
	const { width: W } = img;
	const minRun = W * 0.12;
	let band = null;
	for (let y = ya; y < yb; y++) {
		let best = null, s = -1;
		for (let x = 0; x <= W; x++) {
			const on = x < W && fill((y * W + x) * 4);
			if (on && s < 0) s = x;
			else if (!on && s >= 0) {
				if (x - s >= minRun && accept(s, x) && (!best || x - s > best[1] - best[0])) best = [s, x];
				s = -1;
			}
		}
		if (best) {
			if (!band) band = { y0: y, y1: y, x0: best[0], x1: best[1] };
			else if (y === band.y1 + 1) { band.y1 = y; band.x0 = Math.min(band.x0, best[0]); band.x1 = Math.max(band.x1, best[1]); }
		} else if (band) {
			if (band.y1 - band.y0 + 1 <= W * 0.03) break;	// thin enough: the bar
			band = null;	// something bigger (sprite, background): keep looking
		}
	}
	if (!band || band.y1 - band.y0 + 1 > W * 0.03) return null;
	return { y: Math.round((band.y0 + band.y1) / 2), x0: band.x0, x1: band.x1 - 1 };
}

/** Ends of the full HP bar, as fractions of the column's width (drawn test screens use them). */
export const HP_BAR_X0 = 0.249;
export const HP_BAR_X1 = 0.742;

/** Where the HP bar sits on a 1206 px wide iPhone, in widths: 0.986, 1.036 with "LUCKY POKÉMON". */
export const HP_BAR_Y = 0.986;
export const LUCKY_DY = 0.05;

/**
 * "LUCKY POKÉMON": a line of green text between the name and the HP bar, which pushes the bar
 * down by 0.05 W. Told by that text's colour, not by where the bar is: the bar sits higher or
 * lower on other phones (0.93-1.05 W without the line) and in screenshots cut off at the top.
 * Measured: 88-206 ‰ of the band green on lucky cards, at most 4 ‰ otherwise (Mystic's teal
 * tint is bluer than green: G must beat B).
 */
export function isLucky(img, bar) {
	const { width: W, data } = img;
	let n = 0, g = 0;
	for (let y = Math.max(0, Math.round(bar.y - 0.06 * W)); y < bar.y - 0.02 * W; y++) {
		for (let x = Math.round(0.3 * W); x < 0.7 * W; x++) {
			const i = (y * W + x) * 4, r = data[i], gr = data[i + 1], b = data[i + 2];
			n++;
			if (gr - r > 40 && gr > 110 && gr - b > 10) g++;
		}
	}
	return n > 0 && g / n > 0.04;
}

/**
 * How far the info card sits from where it sits on a 1206 px wide iPhone, in px (negative: higher
 * up). The card moves as a whole: it scrolls up over the sprite, sits lower on some Android phones
 * (+0.03 W), and everything moves up when the top of the screenshot is cut off. The name and the
 * year pill move with it; the HP bar tells by how much. 0 for a pixel or two.
 */
export function cardOffset(img, bar, lucky) {
	const dy = bar.y - (HP_BAR_Y + (lucky ? LUCKY_DY : 0)) * img.width;
	// a pixel or two is the same layout (the iPhone 8 and the iPad: -0.002 W), and moving the
	// crops by that much only changes how nicknames full of symbols come out
	return Math.abs(dy) < 0.01 * img.width ? 0 : Math.round(dy);
}

/**
 * Tags (the player's own labels, coloured pills under the HP line) and a Dynamax level push the
 * stats row down, by 0.089 W per row of them. Found by the weight's dark text in the row's left
 * part: its top sits 0.177-0.180 W below the HP bar without tags, 0.265-0.269 W with one row.
 * When the weight can't be seen (the appraisal's medallion covers it), the pill rows are counted
 * in the middle instead. Returns the shift in px.
 */
export function statsShift(img, bar) {
	const W = img.width;
	const rows = textRows(img, bar.y + 0.12 * W, bar.y + 0.40 * W, 0.06, 0.30);
	for (let k = 0; k <= 2; k++) {
		const top = bar.y + (STATS_TOP + k * TAG_ROW) * W;
		if (rows.some(r => Math.abs(r.y0 - top) <= 0.015 * W && r.y1 - r.y0 >= 0.015 * W)) return Math.round(k * TAG_ROW * W);
	}
	let k = 0;
	while (k < 2 && pillRow(img, bar.y + (0.09 + k * TAG_ROW) * W)) k++;
	return Math.round(k * TAG_ROW * W);
}
const STATS_TOP = 0.178, TAG_ROW = 0.089;

/** Runs of rows with dark text between x0 and x1 (fractions of the width), each row against its own median. */
function textRows(img, ya, yb, x0, x1) {
	const { width: W, data } = img;
	const runs = [];
	let cur = null;
	for (let y = Math.max(0, Math.round(ya)); y < Math.min(img.height, yb); y++) {
		const lums = [], sats = [];
		for (let x = Math.round(x0 * W); x < x1 * W; x++) {
			const i = (y * W + x) * 4;
			lums.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
			sats.push(Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]));
		}
		const ref = [...lums].sort((a, b) => a - b)[lums.length >> 1];
		// dark grey text on the card; a "NEW RECORD" ribbon is saturated
		let ink = 0;
		lums.forEach((l, k) => { if (l < ref - 45 && sats[k] < 90) ink++; });
		if (ink / lums.length <= 0.02) continue;
		if (cur && y - cur.y1 <= W * 0.006) cur.y1 = y;
		else runs.push(cur = { y0: y, y1: y });
	}
	return runs;
}

/** A row of tag pills from y on: 0.07 W of rows where the middle differs from the card's edge. */
function pillRow(img, y0) {
	const { width: W, data } = img;
	let hits = 0;
	for (let k = 0; k < 7; k++) {
		let ink = 0, n = 0;
		for (let y = Math.round(y0 + k * 0.01 * W); y < y0 + (k + 1) * 0.01 * W && y < img.height; y++) {
			const r = (y * W + Math.round(0.08 * W)) * 4;
			for (let x = Math.round(0.3 * W); x < 0.7 * W; x += 2) {
				const i = (y * W + x) * 4;
				n++;
				if (Math.abs(data[i] - data[r]) + Math.abs(data[i + 1] - data[r + 1]) + Math.abs(data[i + 2] - data[r + 2]) > 90) ink++;
			}
		}
		if (n && ink / n >= 0.1) hits++;
	}
	return hits >= 5;
}

/**
 * Crops for a second, closer reading of the stats row, positioned from the HP bar (findHpBar).
 * Offsets are fractions of the width, measured on 1206 px wide iPhone screenshots.
 */
export function statsBoxes(img, bar, shift = 0) {
	const W = img.width;
	const box = (x0, x1, dy0, dy1, s = shift) => {
		const y = Math.min(img.height - 1, Math.max(0, Math.round(bar.y + s + dy0 * W))), y1 = Math.min(img.height, Math.round(bar.y + s + dy1 * W));
		return { x: Math.round(x0 * W), y, w: Math.round((x1 - x0) * W), h: Math.max(1, y1 - y) };
	};
	return {
		hp: box(0.28, 0.72, 0.016, 0.062, 0),
		weight: box(0.03, 0.34, 0.165, 0.236),
		height: box(0.70, 0.97, 0.172, 0.236),
		badge: box(0.75, 0.93, 0.125, 0.172),
		types: box(0.33, 0.67, 0.226, 0.271),
	};
}

/**
 * The size badge ("XXL") is white text on a coloured or grey pill, on a white or tinted card.
 * Find the pill (pixels clearly darker or more saturated than the card) and keep only the
 * bright text inside it, as black on white.
 */
export function badgeText(img) {
	const { width: W, height: H, data } = img;
	const lum = i => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
	const sat = i => Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
	// the card's own colour: the crop's top-left corner
	const ref = lum(0);
	const pill = i => lum(i) < ref - 35 || sat(i) > 70;
	let x0 = W, x1 = -1, y0 = H, y1 = -1, sum = 0, n = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			if (pill(i)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sum += lum(i); n++; }
		}
	}
	const out = new Uint8ClampedArray(data.length).fill(255);
	for (let i = 3; i < out.length; i += 4) out[i] = 255;
	if (x1 < 0 || n < 20) return { width: W, height: H, data: out };
	// text: brighter than the pill, halfway to the card's brightness (white on gold, pale pink
	// on grey when the appraisal darkens the card)
	const level = (sum / n + ref) / 2;
	// only between the pill's own edges on each row: its rounded ends and its anti-aliased
	// rim show the card
	const m = 3;
	for (let y = y0; y <= y1; y++) {
		let l = -1, r = -1;
		for (let x = x0; x <= x1; x++) if (pill((y * W + x) * 4)) { if (l < 0) l = x; r = x; }
		if (l < 0) continue;
		for (let x = l + m; x <= r - m; x++) {
			const i = (y * W + x) * 4;
			if (lum(i) > level && sat(i) < 70) out[i] = out[i + 1] = out[i + 2] = 0;
		}
	}
	return { width: W, height: H, data: out };
}

/** Dark text on a light card (stats row): dark → black, everything else → white. */
export function thresholdDarkText(img, level = 140) {
	const out = new Uint8ClampedArray(img.data.length);
	for (let i = 0; i < img.data.length; i += 4) {
		const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
		const v = g < level ? 0 : 255;
		out[i] = out[i + 1] = out[i + 2] = v;
		out[i + 3] = 255;
	}
	return { width: img.width, height: img.height, data: out };
}

/**
 * Black regions that touch the top or bottom edge turned white: in a thresholded text crop that is
 * whatever is drawn over the card (the trainer's hair under the appraisal), not text, which keeps
 * clear of the crop's edges. Tesseract reads "131 / 131 HP" next to a black blob as nothing.
 */
export function dropEdgeBlobs(img) {
	const { width: W, height: H } = img;
	const data = new Uint8ClampedArray(img.data);
	const black = p => data[p * 4] === 0;
	const stack = [];
	for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
	while (stack.length) {
		const p = stack.pop();
		if (!black(p)) continue;
		data[p * 4] = data[p * 4 + 1] = data[p * 4 + 2] = 255;
		const x = p % W;
		if (x > 0) stack.push(p - 1);
		if (x < W - 1) stack.push(p + 1);
		if (p >= W) stack.push(p - W);
		if (p < (H - 1) * W) stack.push(p + W);
	}
	return { width: W, height: H, data };
}

/**
 * A REGIONS entry in pixels (all four numbers are fractions of the width), clipped to the image;
 * moved down by dy px (up when negative).
 */
export function boxOf(img, r, dy = 0) {
	const W = img.width;
	let y = Math.round(W * r.y + dy), h = Math.round(W * r.h);
	if (y < 0) { h += y; y = 0; }
	y = Math.min(img.height - 1, y);
	const x = Math.round(W * r.x);
	return { x, y, w: Math.min(W - x, Math.round(W * r.w)), h: Math.max(1, Math.min(img.height - y, h)) };
}

/**
 * The catch year pill (REGIONS.year) as black text on white, or null when there is no pill: the
 * game shows it only for Pokémon caught in an earlier year. Orange pill, white text, a Poké Ball
 * icon on its left that is cut off.
 */
export function yearPillText(img) {
	const { width: W, height: H, data } = img;
	const orange = i => { const r = data[i], g = data[i + 1], b = data[i + 2]; return r > 200 && g > 140 && g < 215 && b < 150 && r - b > 90; };
	let x0 = W, x1 = -1, y0 = H, y1 = -1, n = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (orange((y * W + x) * 4)) { n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
		}
	}
	// a real pill fills a good part of the region
	if (n < W * H * 0.12 || x1 - x0 < W * 0.5 || y1 - y0 < H * 0.4) return null;
	// the text: right of the ball icon (which takes the pill's left 40 %), inside the pill's
	// rows; with a white margin, which Tesseract reads better than text touching the edge
	const tx = Math.round(x0 + (x1 - x0) * 0.40), pad = 8;
	const tw = x1 - tx + 1, th = y1 - y0 + 1;
	const w = tw + 2 * pad, h = th + 2 * pad;
	const out = new Uint8ClampedArray(w * h * 4).fill(255);
	for (let y = 0; y < th; y++) {
		for (let x = 0; x < tw; x++) {
			const i = ((y0 + y) * W + tx + x) * 4, o = ((y + pad) * w + x + pad) * 4;
			const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
			const sat = Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
			if (lum > 215 && sat < 70 && orangeAround(x, y)) out[o] = out[o + 1] = out[o + 2] = 0;
		}
	}
	return { width: w, height: h, data: out };
	// white inside the pill, not the card beside or below it: orange somewhere to the left and
	// to the right on the same row
	function orangeAround(x, y) {
		let l = false, r = false;
		for (let k = tx + x; k >= x0 && !l; k--) l = orange(((y0 + y) * W + k) * 4);
		for (let k = tx + x; k <= x1 && !r; k++) r = orange(((y0 + y) * W + k) * 4);
		return l && r;
	}
}

/**
 * Pixels as they are, in a file the text recognition engine reads without decoding: a PAM
 * (netpbm's P7) with all four channels, so the engine gets exactly what a PNG of the same pixels
 * would give it, without a PNG encoder on one side and a decoder on the other. The comment pads
 * the header past 500 bytes: tesseract.js takes an EXIF orientation from the first 500 bytes of
 * an image, and raw pixel values could look like one.
 * @returns {Uint8Array}
 */
export function pam(img) {
	const head = new TextEncoder().encode(`P7\n# ${'-'.repeat(500)}\nWIDTH ${img.width}\nHEIGHT ${img.height}\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n`);
	const out = new Uint8Array(head.length + img.width * img.height * 4);
	out.set(head);
	out.set(img.data, head.length);
	return out;
}

export function crop(img, { x, y, w, h }) {
	const out = new Uint8ClampedArray(w * h * 4);
	for (let j = 0; j < h; j++) {
		const src = ((y + j) * img.width + x) * 4;
		out.set(img.data.subarray(src, src + w * 4), j * w * 4);
	}
	return { width: w, height: h, data: out };
}

/** CP is white text over the photo: near-white → black, everything else → white. */
export function thresholdWhiteText(img, level = 235) {
	const out = new Uint8ClampedArray(img.data.length);
	for (let i = 0; i < img.data.length; i += 4) {
		const g = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
		const v = g > level ? 0 : 255;
		out[i] = out[i + 1] = out[i + 2] = v;
		out[i + 3] = 255;
	}
	return { width: img.width, height: img.height, data: out };
}

/**
 * The CP's digits alone, black on white: from the thresholded CP crop keep the tallest glyphs on
 * one baseline. Drops the smaller "CP" in front (Tesseract reads "CP627" as 27 at times), bokeh
 * dots of the background and anything touching the crop's top or bottom (a planet's rim).
 * Returns null when nothing digit-like is left.
 */
export function cpDigits(img) {
	const { width: W, height: H } = img;
	const black = new Uint8Array(W * H);
	for (let p = 0; p < W * H; p++) black[p] = img.data[p * 4] === 0 ? 1 : 0;
	const label = new Int32Array(W * H).fill(-1);
	const comps = [];
	for (let p0 = 0; p0 < W * H; p0++) {
		if (!black[p0] || label[p0] >= 0) continue;
		const c = { x0: W, x1: -1, y0: H, y1: -1, n: 0, px: [] };
		const st = [p0];
		label[p0] = comps.length;
		while (st.length) {
			const p = st.pop(), x = p % W, y = (p - x) / W;
			c.n++; c.px.push(p);
			if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
			for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
				if (q >= 0 && black[q] && label[q] < 0) { label[q] = comps.length; st.push(q); }
			}
		}
		comps.push(c);
	}
	const ok = comps.filter(c => c.y0 > 0 && c.y1 < H - 1 && c.y1 - c.y0 + 1 >= H * 0.2);
	if (!ok.length) return null;
	const T = ok.reduce((a, b) => (b.y1 - b.y0 > a.y1 - a.y0 ? b : a));
	const th = T.y1 - T.y0 + 1;
	// the digits: as tall as the tallest glyph (±20 %), on its baseline, not much wider than tall
	// (a blob of the background is)
	const keep = ok.filter(c => c.y1 - c.y0 + 1 >= th * 0.8 && Math.abs(c.y1 - T.y1) <= th * 0.15 && c.x1 - c.x0 + 1 <= th * 1.1);
	if (!keep.length) return null;
	const x0 = Math.min(...keep.map(c => c.x0)), x1 = Math.max(...keep.map(c => c.x1));
	const y0 = Math.min(...keep.map(c => c.y0)), y1 = Math.max(...keep.map(c => c.y1));
	const pad = Math.max(4, Math.round(th * 0.3));
	const w = x1 - x0 + 1 + 2 * pad, h = y1 - y0 + 1 + 2 * pad;
	const out = new Uint8ClampedArray(w * h * 4).fill(255);
	for (const c of keep) {
		for (const p of c.px) {
			const x = p % W, y = (p - x) / W;
			const o = ((y - y0 + pad) * w + (x - x0 + pad)) * 4;
			out[o] = out[o + 1] = out[o + 2] = 0;
		}
	}
	return { width: w, height: h, data: out };
}

/**
 * Where the CP's digits are, searched for in the top 0.35 W of the column: a row of at least
 * two near-white glyphs of the same height (0.035-0.075 W; the status bar's are smaller) on
 * one baseline, in the middle of the width. For screenshots where the CP is not where an
 * uncut iPhone screenshot has it (cut off at the top, a taller status bar, a black band drawn
 * over it). Returns a REGIONS.cp-sized box around it, in px, or null.
 */
export function findCpBox(img) {
	const W = img.width;
	const band = { x: Math.round(0.25 * W), y: 0, w: Math.round(0.5 * W), h: Math.min(img.height, Math.round(0.35 * W)) };
	const t = thresholdWhiteText(crop(img, band));
	const comps = components(t).filter(c => {
		const h = c.y1 - c.y0 + 1, w = c.x1 - c.x0 + 1;
		return h >= 0.035 * W && h <= 0.075 * W && w <= h * 1.1 && c.y0 > 0 && c.y1 < t.height - 1;
	});
	let best = null;
	for (const a of comps) {
		const h = a.y1 - a.y0 + 1;
		const row = comps.filter(c => Math.abs(c.y1 - a.y1) <= h * 0.15 && Math.abs(c.y1 - c.y0 + 1 - h) <= h * 0.2);
		if (row.length >= 2 && (!best || row.length > best.length)) best = row;
	}
	if (!best) return null;
	const y0 = Math.min(...best.map(c => c.y0)), y1 = Math.max(...best.map(c => c.y1));
	const r = REGIONS.cp, h = Math.round(r.h * W);
	const y = Math.max(0, Math.min(img.height - h, Math.round((y0 + y1) / 2 - h / 2)));
	return { x: Math.round(r.x * W), y, w: Math.round(r.w * W), h: Math.min(h, img.height - y) };
}

/** Connected black regions of a thresholded image: bounding boxes, pixel lists. */
function components(img) {
	const { width: W, height: H } = img;
	const label = new Int32Array(W * H).fill(-1);
	const out = [];
	for (let p0 = 0; p0 < W * H; p0++) {
		if (img.data[p0 * 4] !== 0 || label[p0] >= 0) continue;
		const c = { x0: W, x1: -1, y0: H, y1: -1, px: [] };
		const st = [p0];
		label[p0] = out.length;
		while (st.length) {
			const p = st.pop(), x = p % W, y = (p - x) / W;
			c.px.push(p);
			if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
			for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
				if (q >= 0 && img.data[q * 4] === 0 && label[q] < 0) { label[q] = out.length; st.push(q); }
			}
		}
		out.push(c);
	}
	return out;
}

/** Box-filter downscale so the longer side is at most maxSide. */
export function downscale(img, maxSide) {
	const f = Math.max(img.width, img.height) / maxSide;
	if (f <= 1) return img;
	const w = Math.max(1, Math.round(img.width / f)), h = Math.max(1, Math.round(img.height / f));
	const out = new Uint8ClampedArray(w * h * 4);
	for (let j = 0; j < h; j++) {
		const y0 = Math.floor(j * img.height / h), y1 = Math.max(y0 + 1, Math.floor((j + 1) * img.height / h));
		for (let i = 0; i < w; i++) {
			const x0 = Math.floor(i * img.width / w), x1 = Math.max(x0 + 1, Math.floor((i + 1) * img.width / w));
			let r = 0, g = 0, b = 0, a = 0, n = 0;
			for (let y = y0; y < y1; y++) {
				for (let x = x0; x < x1; x++) {
					const k = (y * img.width + x) * 4;
					r += img.data[k]; g += img.data[k + 1]; b += img.data[k + 2]; a += img.data[k + 3]; n++;
				}
			}
			const o = (j * w + i) * 4;
			out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = a / n;
		}
	}
	return { width: w, height: h, data: out };
}

/**
 * Width and height from a PNG's or JPEG's header, without decoding it; null for anything else,
 * or when the bytes end before the size (a JPEG's comes after its metadata segments).
 * @param {Uint8Array} b  the file's first bytes
 * @returns {{width: number, height: number} | null}
 */
export function imageSize(b) {
	const u16 = i => (b[i] << 8) | b[i + 1];
	const u32 = i => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
	// PNG: the signature, then IHDR first
	if (b.length >= 24 && u32(0) === 0x89504e47 && u32(4) === 0x0d0a1a0a && u32(12) === 0x49484452) return { width: u32(16), height: u32(20) };
	if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
	// JPEG: segment by segment to the frame header (SOF0-SOF15, but C4, C8 and CC are other
	// segments); an embedded thumbnail sits inside its segment and is skipped with it
	for (let i = 2; i + 9 <= b.length;) {
		if (b[i] !== 0xff) return null;
		const m = b[i + 1];
		if (m === 0xff) { i++; continue; }	// fill byte
		if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }	// no length
		if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16(i + 7), height: u16(i + 5) };
		if (m === 0xd9 || m === 0xda) return null;	// image end, or its data before any frame
		i += 2 + u16(i + 2);
	}
	return null;
}
