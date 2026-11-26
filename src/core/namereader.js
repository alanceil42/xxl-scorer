// Nicknames on the game's list tiles: XX1063¹⁸⓿㉚ ("Name to copy"), another app's ⁸⁰⓫㉑2650 and
// the like. Tesseract reads letters and plain digits, but not digits in circles or tiny
// superscripts, so the name is first cut into parts by shape, and each part's digits are read on
// their own, scaled up:
//
//   disc   a filled circle, white digits inside             Attack IV (⓯)
//   ring   an outlined circle: digits, a letter or nothing  level (㉓), PvP league (Ⓖ), or ◯
//   dot    a small filled round in the middle of the line   shadow (●)
//   sup    small glyphs ending above the circles' middle    IV % (⁸⁰)
//   text   everything else                                  prefix (XX1063, MM), Max CP (2650)
//
// Measured on list screenshots of the iPhone 17 (2026-11). Pure image work plus an OCR engine
// with line(img, whitelist, psm), as listview.js.

import { glyphVector, readGlyphs, templates } from './digits.js';

/** Templates for superscripts learned? Without them the reader is Tesseract's alone. */
const hasSup = () => !!templates().sup;

/** 1 where the pixel is darker than t (mean of r, g, b). */
export function darkMask(img, t) {
	const { width: w, height: h, data } = img;
	const m = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) if ((data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3 < t) m[i] = 1;
	return m;
}

/** Connected components (8 neighbours) of the 1s of a mask: [{x0, y0, x1, y1, n, px}]. */
export function components(m, w, h) {
	const lab = new Int32Array(w * h).fill(-1), out = [], st = [];
	for (let i = 0; i < w * h; i++) {
		if (!m[i] || lab[i] >= 0) continue;
		const c = { x0: w, y0: h, x1: -1, y1: -1, n: 0, px: [] };
		lab[i] = out.length; st.push(i);
		while (st.length) {
			const j = st.pop(), x = j % w, y = (j - x) / w;
			c.n++; c.px.push(j);
			if (x < c.x0) c.x0 = x;
			if (x > c.x1) c.x1 = x;
			if (y < c.y0) c.y0 = y;
			if (y > c.y1) c.y1 = y;
			for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
				const xx = x + dx, yy = y + dy;
				if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
				const k = yy * w + xx;
				if (m[k] && lab[k] < 0) { lab[k] = out.length; st.push(k); }
			}
		}
		out.push(c);
	}
	return out;
}

const bw = c => c.x1 - c.x0 + 1, bh = c => c.y1 - c.y0 + 1;
const union = (a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Grey levels: the structure (thin rings of levels 21-50 are light grey) and the ink of digits. */
const STRUCT = 205, INK = [140, 165];
/**
 * By the scroll pill: its glass halo fades what lies just above and left of it, the digits to
 * grey 165-190 (a ⑱ was read "8" from the dark half of its glyphs). A circle there is read by
 * the templates at these lighter levels first.
 */
const HALO_INK = [175, 200];

/** A component from some of another's pixels. */
function compOf(px, w) {
	const c = { x0: Infinity, y0: Infinity, x1: -1, y1: -1, n: px.length, px };
	for (const j of px) {
		const x = j % w, y = (j - x) / w;
		if (x < c.x0) c.x0 = x;
		if (x > c.x1) c.x1 = x;
		if (y < c.y0) c.y0 = y;
		if (y > c.y1) c.y1 = y;
	}
	return c;
}
/** A component cut after column x: [left, right]. */
const cutAt = (c, x, w) => [compOf(c.px.filter(j => j % w <= x), w), compOf(c.px.filter(j => j % w > x), w)];
/** Pixels per column of a component, from its x0. */
function columns(c, w) {
	const n = new Int32Array(bw(c));
	for (const j of c.px) n[j % w - c.x0]++;
	return n;
}
const isRound = c => Math.abs(bw(c) / bh(c) - 1) < 0.25;

/**
 * Circles that touch: a name of 12 characters is set tighter, and the Attack disc then touches
 * the level ring, or a superscript digit the disc.
 * A component as tall as a circle and wider than one is cut at its neck, one circle's width from
 * an end, when the piece cut off is round. Not by a darker threshold: the light rings of levels
 * 21-50 would break.
 */
function splitCircles(c, w, h, depth = 0) {
	const Hc = bh(c);
	if (depth > 3 || Hc < 0.35 * h || bw(c) < 1.3 * Hc) return [c];
	const n = columns(c, w);
	const neck = (from, to) => {
		let best = -1;
		for (let i = Math.max(1, Math.round(from)); i <= Math.min(n.length - 2, Math.round(to)); i++) if (best < 0 || n[i] < n[best]) best = i;
		return best >= 0 && n[best] <= 0.3 * Hc ? best : -1;
	};
	const ok = d => d.n >= 12 && bh(d) >= 0.8 * Hc && isRound(d);
	// a circle at the left end: the cut is its last column
	let i = neck(0.8 * Hc, 1.15 * Hc);
	if (i >= 0) {
		const [a, b] = cutAt(c, c.x0 + i, w);
		if (ok(a) && b.n >= 12) return [a, ...splitCircles(b, w, h, depth + 1)];
	}
	// a circle at the right end
	i = neck(n.length - 1.15 * Hc, n.length - 0.8 * Hc);
	if (i >= 0) {
		const [a, b] = cutAt(c, c.x0 + i - 1, w);
		if (ok(b) && a.n >= 12) return [...splitCircles(a, w, h, depth + 1), b];
	}
	return [c];
}

/**
 * A superscript digit joined to the glyph before it: a move-type symbol's stroke runs into the
 * first digit of the IV % (ε⁷⁶). Cut at the thin stroke when
 * what is cut off sits where a superscript sits and a superscript or a circle follows it.
 */
function splitSup(c, others, w, { H, top, mid }) {
	if (c.y1 < mid || bw(c) < 0.3 * H) return [c];	// a superscript already, or too narrow to hold two
	const supLike = d => d.y1 < mid && bh(d) < 0.6 * H && d.y0 >= top - 0.2 * H;
	const next = others.filter(d => d !== c && d.x0 > c.x1 - 2 && d.x0 - c.x1 < 0.25 * H);
	if (!next.some(d => supLike(d) || (bh(d) >= 0.8 * H && isRound(d)))) return [c];
	const n = columns(c, w);
	for (let i = n.length - 2; i >= 1; i--) {
		if (n[i] > 0.14 * H) continue;
		const [a, b] = cutAt(c, c.x0 + i, w);
		if (b.n < 12 || bw(b) < 0.15 * H) continue;
		if (supLike(b) && bh(b) >= 0.25 * H && a.y1 >= mid && a.n >= 12) return [a, b];
		if (!supLike(b)) break;	// further left the piece only grows
	}
	return [c];
}

/** The name's parts, left to right: {kind, box, comps}. */
export function nameParts(img) {
	const { width: w, height: h } = img;
	const m = darkMask(img, STRUCT);
	let cs = components(m, w, h).filter(c => c.n >= 12).flatMap(c => splitCircles(c, w, h));
	if (!cs.length) return { parts: [], w, h, H: h };
	{
		// where the circles are, for the superscripts joined to a neighbour
		const r0 = cs.filter(c => bh(c) >= 0.35 * h && isRound(c));
		const H0 = r0.length ? Math.max(...r0.map(bh)) : 0;
		const circ = r0.filter(c => bh(c) >= 0.8 * H0);
		if (circ.length) {
			const g = { H: H0, top: Math.min(...circ.map(c => c.y0)), mid: circ.reduce((a, c) => a + (c.y0 + c.y1) / 2, 0) / circ.length };
			const inside = c => circ.some(d => d !== c && c.x0 > d.x0 && c.x1 < d.x1 && c.y0 > d.y0 && c.y1 < d.y1);
			cs = cs.flatMap(c => (circ.includes(c) || inside(c) ? [c] : splitSup(c, cs, w, g)));
		}
	}
	const round = cs.filter(c => bh(c) >= 0.35 * h && Math.abs(bw(c) / bh(c) - 1) < 0.25);
	const H = round.length ? Math.max(...round.map(bh)) : Math.max(...cs.map(bh));
	const used = new Set(), out = [];
	for (const c of round) {
		if (bh(c) < 0.8 * H) continue;
		const inner = cs.filter(d => d !== c && d.x0 > c.x0 && d.x1 < c.x1 && d.y0 > c.y0 && d.y1 < c.y1);
		out.push({ kind: c.n / (bw(c) * bh(c)) > 0.5 ? 'disc' : 'ring', box: c, comps: [c, ...inner] });
		used.add(c);
		inner.forEach(d => used.add(d));
	}
	const circles = out.slice();
	const top = circles.length ? Math.min(...circles.map(p => p.box.y0)) : 0;
	const mid = circles.length ? circles.reduce((a, p) => a + (p.box.y0 + p.box.y1) / 2, 0) / circles.length : h / 2;
	for (const c of cs.filter(c => !used.has(c))) {
		const fill = c.n / (bw(c) * bh(c)), cy = (c.y0 + c.y1) / 2;
		const dot = fill > 0.6 && Math.abs(bw(c) / bh(c) - 1) < 0.3 && bh(c) > 0.18 * H && bh(c) < 0.5 * H && Math.abs(cy - mid) < 0.2 * H;
		const sup = !dot && c.y1 < mid && bh(c) < 0.6 * H && c.y0 >= top - 0.2 * H;
		out.push({ kind: dot ? 'dot' : sup ? 'sup' : 'text', box: c, comps: [c] });
	}
	out.sort((a, b) => a.box.x0 - b.box.x0);
	const merged = [];
	for (const p of out) {
		const q = merged[merged.length - 1];
		if (q && q.kind === p.kind && (p.kind === 'sup' || p.kind === 'text') && p.box.x0 - q.box.x1 < 0.25 * H) {
			q.comps.push(...p.comps);
			q.box = union(q.box, p.box);
		} else merged.push({ ...p, box: { x0: p.box.x0, y0: p.box.y0, x1: p.box.x1, y1: p.box.y1 } });
	}
	return { parts: merged, w, h, H, img };
}

/** Chosen pixels, black on white, padded and scaled up: what Tesseract reads well. */
export function glyphImage(w, pick, box, scale = 2, pad = 10) {
	const W = (bw(box) + 2 * pad) * scale, Hh = (bh(box) + 2 * pad) * scale;
	const data = new Uint8ClampedArray(W * Hh * 4).fill(255);
	for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
		if (!pick(y * w + x)) continue;
		for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) {
			const i = (((y - box.y0 + pad) * scale + sy) * W + (x - box.x0 + pad) * scale + sx) * 4;
			data[i] = data[i + 1] = data[i + 2] = 0;
		}
	}
	return { width: W, height: Hh, data };
}

/** The digits inside a circle at one grey level: light inside a disc, dark well inside a ring. */
export function circleDigits(P, p, ink) {
	const { w } = P, b = p.box, s = new Set();
	if (p.kind === 'disc') {
		for (let y = b.y0; y <= b.y1; y++) {
			let a = -1, z = -1;
			for (let x = b.x0; x <= b.x1; x++) if (ink[y * w + x]) { if (a < 0) a = x; z = x; }
			for (let x = a; a >= 0 && x <= z; x++) if (!ink[y * w + x]) s.add(y * w + x);
		}
	} else {
		const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, r = 0.75 * Math.min(bw(b), bh(b)) / 2;
		for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (ink[y * w + x] && (x - cx) ** 2 + (y - cy) ** 2 < r * r) s.add(y * w + x);
	}
	return s;
}

/** How many glyphs a pixel set holds: its components of a fair size. */
function glyphCount(s, w, h) {
	if (!s.size) return 0;
	const m = new Uint8Array(w * h);
	for (const i of s) m[i] = 1;
	const cs = components(m, w, h);
	const big = Math.max(...cs.map(c => c.n));
	return cs.filter(c => c.n >= 0.15 * big).length;
}

/**
 * A circle's digit glyphs at one grey level, left to right, each as digits.js samples it (null
 * for one too small or too wide to be one digit).
 */
export function circleGlyphs(P, p, ink) {
	const s = circleDigits(P, p, ink);
	if (s.size < 10) return [];
	const m = new Uint8Array(P.w * P.h);
	for (const i of s) m[i] = 1;
	const cs = components(m, P.w, P.h);
	const big = Math.max(...cs.map(c => c.n));
	return cs.filter(c => c.n >= 0.15 * big).sort((a, b) => a.x0 - b.x0).map(c => glyphVector(new Set(c.px), P.w, c));
}

/**
 * A superscript's digit glyphs at one grey level, left to right, each as digits.js samples
 * it: the part's dark pixels, split into components of a fair size. A glyph too wide for one digit
 * (two digits run together) is null, so the caller can tell the count doesn't hold.
 */
export function supGlyphs(P, p, ink) {
	const px = p.comps.flatMap(d => d.px).filter(i => ink[i]);
	if (px.length < 10) return [];
	const m = new Uint8Array(P.w * P.h);
	for (const i of px) m[i] = 1;
	const cs = components(m, P.w, P.h);
	const big = Math.max(...cs.map(c => c.n));
	return cs.filter(c => c.n >= 0.15 * big).sort((a, b) => a.x0 - b.x0).map(c => glyphVector(new Set(c.px), P.w, c));
}

/**
 * The digits in a circle: read at two grey levels; "11" fixed where Tesseract sees one "1" in two
 * glyphs; the two readings must agree (or one be empty), else '' (not sure: the name is "check").
 * Where Tesseract gives nothing or disagrees, the learned templates (digits.js): both grey
 * levels must read the same digits (tmpl: true). By the scroll pill (halo: its two masks) the
 * templates at HALO_INK come first, on the same terms.
 */
async function readCircle(P, p, engine, inks, halo) {
	const kind = p.kind === 'disc' ? 'disc' : 'ring';
	if (halo) {
		const t = halo.map(ink => readGlyphs(circleGlyphs(P, p, ink), kind));
		if (t[0] && t[0] === t[1]) return { text: t[0], empty: false, tmpl: true };
	}
	const r = await readCircleTesseract(P, p, engine, inks);
	if (r.text || r.empty) return r;
	const t = inks.map(ink => readGlyphs(circleGlyphs(P, p, ink), kind));
	if (t[0] && t[0] === t[1]) return { text: t[0], empty: false, tmpl: true };
	return r;
}

/** Tesseract's reading of a circle alone. */
export async function readCircleTesseract(P, p, engine, inks) {
	const reads = [];
	let n = 0;
	for (const ink of inks) {
		const s = circleDigits(P, p, ink);
		if (s.size < 10) { reads.push(''); continue; }
		n = Math.max(n, glyphCount(s, P.w, P.h));
		let t = (await engine.line(glyphImage(P.w, i => s.has(i), p.box), '0123456789', '7')).replace(/\s+/g, '');
		if (t === '1' && n === 2) t = '11';
		reads.push(t);
	}
	const full = reads.filter(Boolean);
	if (!full.length) return { text: '', empty: n === 0 };
	if (full.every(t => t === full[0])) return { text: full[0], empty: false };
	const fit = full.filter(t => t.length === n);
	return { text: fit.length === 1 ? fit[0] : '', empty: false, unsure: true };
}

/**
 * One tile's name (the list view's name box, cropped) → tokens [{kind, text, ...}]:
 * ring/disc text '' with empty: true when nothing is inside (◯), letter for a ring with one (Ⓖ);
 * sup has reads (three readings, the parser votes; one, with tmpl: true, where the learned
 * templates read it for sure). pill: the scroll pill's halo in the picture's pixels ({x0, y0, y1},
 * to the picture's right edge; listview.js), for the circles in it (HALO_INK).
 */
export async function readNameTokens(img, engine, { supTemplates = true, pill = null } = {}) {
	const P = nameParts(img);
	// a blank picture reads as nothing, without Tesseract (which prints its statistics for one)
	const line = (px, box, chars, psm, scale) => (px.size ? engine.line(glyphImage(P.w, i => px.has(i), box, scale), chars, psm) : Promise.resolve(''));
	const inks = INK.map(t => darkMask(img, t));
	const halo = pill ? HALO_INK.map(t => darkMask(img, t)) : null;
	const near = b => !!pill && b.x1 >= pill.x0 && b.y1 >= pill.y0 && b.y0 <= pill.y1;
	const toks = [];
	for (const p of P.parts) {
		if (p.kind === 'dot') { toks.push({ kind: 'dot', text: '●' }); continue; }
		if (p.kind === 'disc' || p.kind === 'ring') {
			const r = await readCircle(P, p, engine, inks, near(p.box) ? halo : null);
			const tok = { kind: p.kind, text: /^\d{1,2}$/.test(r.text) ? r.text : '', empty: r.empty };
			if (r.unsure) tok.unsure = true;
			if (r.tmpl) tok.tmpl = true;
			if (p.kind === 'ring' && !r.empty && !tok.text && !r.unsure) {
				const s = circleDigits(P, p, inks[1]);
				const l = (await line(s, p.box, 'GUL', '10')).trim();
				if (/^[GUL]$/.test(l)) tok.letter = l;
			}
			toks.push(tok);
			continue;
		}
		const all = new Set(p.comps.flatMap(d => d.px));
		const ink = new Set([...all].filter(i => inks[1][i]));
		if (p.kind === 'text' && ink.size < 0.02 * P.H * P.H) continue;	// specks between circles
		if (p.kind === 'sup') {
			// the learned templates first (Tesseract once read a ⁸¹ as "21" three times); both grey
			// levels must give the same digits, every glyph clear
			if (supTemplates && hasSup()) {
				const tm = inks.map(k => readGlyphs(supGlyphs(P, p, k), 'sup', undefined, 3));
				if (tm[0] && tm[0] === tm[1] && Number(tm[0]) <= 100) { toks.push({ kind: 'sup', text: tm[0], reads: [tm[0]], tmpl: true }); continue; }
			}
			const reads = [
				await line(all, p.box, '0123456789', '8', 4),
				await line(ink, p.box, '0123456789', '7', 4),
				await line(all, p.box, '0123456789', '7', 4),
			].map(s => s.replace(/\s+/g, ''));
			toks.push({ kind: 'sup', text: reads[0], reads });
			continue;
		}
		const t = (await line(ink, p.box, '', '7')).trim();
		toks.push({ kind: 'text', text: t, h: +(bh(p.box) / P.H).toFixed(2), w: +(bw(p.box) / P.H).toFixed(2) });
	}
	return toks;
}
