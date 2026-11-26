// Digits in nickname circles and superscripts, by learned templates (digit-templates.js): used
// only where Tesseract gave nothing or two readings of a circle disagreed (namereader.js). Both
// grey levels must give the same digits, each with a clear lead over the next best, or it stays
// unread.
import { TEMPLATES } from './digit-templates.js';

/** A glyph is sampled into GW × GH cells: its height fills GH, its width keeps the aspect. */
export const GW = 20, GH = 24;

/**
 * One glyph's pixels (a set of indices into a w-wide picture, with its box) → GW × GH coverage
 * values, centred; null when it is too small or wider than any digit (two digits run together).
 */
export function glyphVector(px, w, box) {
	const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
	if (bh < 6 || bw > 1.2 * bh) return null;
	const s = GH / bh, ow = Math.min(GW, Math.max(1, Math.round(bw * s))), ox = Math.floor((GW - ow) / 2);
	const v = new Float32Array(GW * GH);
	// 3 × 3 samples per cell
	for (let j = 0; j < GH; j++) for (let i = 0; i < ow; i++) {
		let n = 0;
		for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
			const x = box.x0 + Math.floor(((i + (sx + 0.5) / 3) / ow) * bw), y = box.y0 + Math.floor(((j + (sy + 0.5) / 3) / GH) * bh);
			if (px.has(y * w + x)) n++;
		}
		v[j * GW + ox + i] = n / 9;
	}
	return v;
}

/** Zero mean, unit length: correlation becomes a dot product. */
export function normalize(v) {
	const n = v.length;
	let m = 0;
	for (let i = 0; i < n; i++) m += v[i];
	m /= n;
	const out = new Float32Array(n);
	let q = 0;
	for (let i = 0; i < n; i++) { out[i] = v[i] - m; q += out[i] * out[i]; }
	q = Math.sqrt(q) || 1;
	for (let i = 0; i < n; i++) out[i] /= q;
	return out;
}

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

/** The templates, decoded once: {disc|ring: [{d, v}]}. */
let decoded = null;
export function templates(t = TEMPLATES) {
	if (t === TEMPLATES && decoded) return decoded;
	const out = {};
	for (const kind of Object.keys(t.kinds)) out[kind] = Object.entries(t.kinds[kind]).map(([d, s]) => ({ d, v: normalize(Float32Array.from(s, c => (c.charCodeAt(0) - 48) / 15)) }));
	if (t === TEMPLATES) decoded = out;
	return out;
}

/**
 * One glyph vector → {d, score, lead}: the best digit, its correlation and its lead over the
 * next best digit; null when no template of that kind exists.
 */
export function classify(vec, kind, t = TEMPLATES) {
	const ts = templates(t)[kind];
	if (!ts || !ts.length) return null;
	const v = normalize(vec);
	const sc = ts.map(x => ({ d: x.d, s: dot(v, x.v) })).sort((a, b) => b.s - a.s);
	return { d: sc[0].d, score: sc[0].s, lead: sc[0].s - (sc[1] ? sc[1].s : -1) };
}

/** A kind's thresholds: its own (the superscripts' were learned apart), else the circles'. */
export const thresholdsOf = (kind, t = TEMPLATES) => (t.per && t.per[kind]) || { minScore: t.minScore, minLead: t.minLead };

/**
 * A reading of a circle's glyphs (left to right) when every one is clear, else null; max: the
 * most digits it may hold (2 in a circle, 3 in an IV % superscript: 100).
 */
export function readGlyphs(vecs, kind, t = TEMPLATES, max = 2) {
	if (!vecs.length || vecs.length > max || vecs.some(v => !v)) return null;
	const th = thresholdsOf(kind, t);
	let text = '';
	for (const v of vecs) {
		const c = classify(v, kind, t);
		if (!c || c.score < th.minScore || c.lead < th.minLead) return null;
		text += c.d;
	}
	return text;
}

/** Encode a vector (0..1) as one character per cell, '0'..'?' (16 levels), for the templates file. */
export const encode = v => Array.from(v, x => String.fromCharCode(48 + Math.round(Math.max(0, Math.min(1, x)) * 15))).join('');
