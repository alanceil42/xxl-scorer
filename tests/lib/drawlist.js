// List screenshots drawn in code, for the tests that run everywhere (CI has no real screenshots):
// the header with its count and search field, tiles (green bar, CP, a name), the scroll pill and
// the floating buttons, at the places listview.js looks. Text is a 3 × 5 block font that
// fakeOcr() reads back from the pixels; the digits in a name's circles and superscripts are drawn
// from the learned templates (digit-templates.js). Shapes only: no game art.
import { TEMPLATES } from '../../src/core/digit-templates.js';
import { GW, GH } from '../../src/core/digits.js';
import { components } from '../../src/core/namereader.js';

export const BG = [244, 255, 240], HEADER = [250, 255, 248], FIELD = [231, 244, 224];
export const BAR = [110, 238, 184], INK = [60, 60, 60], WHITE = [255, 255, 255];

const FONT = {
	0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
	4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001',
	8: '111101111101111', 9: '111101111001111', C: '111100100100111', P: '111101111100100',
	X: '101101010101101', L: '100100100100111', '(': '0110101001', ')': '1001010110',
};
const width = ch => FONT[ch].length / 5;

/** A blank picture of one colour. */
export function blank(w, h, rgb = BG) {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
	return { width: w, height: h, data };
}

export function rect(img, x, y, w, h, rgb) {
	x = Math.round(x); y = Math.round(y);
	for (let j = Math.max(0, y); j < Math.min(img.height, y + Math.round(h)); j++)
		for (let i = Math.max(0, x); i < Math.min(img.width, x + Math.round(w)); i++) img.data.set(rgb, (j * img.width + i) * 4);
}

/** A filled circle, or a ring of thickness t. */
export function circle(img, cx, cy, r, rgb, t = 0) {
	for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
		const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
		if (d <= r && (!t || d >= r - t) && x >= 0 && y >= 0 && x < img.width && y < img.height) img.data.set(rgb, (y * img.width + x) * 4);
	}
}

/** Text in the block font, cells of s px, one cell between letters. → its width. */
export function text(img, str, x, y, s, rgb = INK) {
	let at = x;
	for (const ch of String(str)) {
		if (ch === ' ') { at += 2 * s; continue; }
		const f = FONT[ch], cw = width(ch);
		for (let j = 0; j < 5; j++) for (let i = 0; i < cw; i++) if (f[j * cw + i] === '1') rect(img, at + i * s, y + j * s, s, s, rgb);
		at += (cw + 1) * s;
	}
	return at - x - s;
}
export const textWidth = (str, s) => [...String(str)].reduce((a, ch) => a + (ch === ' ' ? 2 * s : (width(ch) + 1) * s), 0) - s;

const tmpl = (kind, d) => TEMPLATES.kinds[kind][d];
/** The columns a digit's template fills. */
function span(t) {
	let a = GW, b = -1;
	for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (t.charCodeAt(j * GW + i) - 48 >= 8) { a = Math.min(a, i); b = Math.max(b, i); }
	return [a, b];
}
/** One digit from its template, h px tall at (x, y). → its width. */
export function digit(img, kind, d, x, y, h, rgb) {
	const t = tmpl(kind, d), [a, b] = span(t), w = Math.round(((b - a + 1) * h) / GH);
	for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
		const cy = Math.floor((py * GH) / h), cx = a + Math.floor((px * GH) / h);
		if (cx <= b && t.charCodeAt(cy * GW + cx) - 48 >= 8) rect(img, x + px, y + py, 1, 1, rgb);
	}
	return w;
}
const digitsWidth = (kind, s, h, gap) => [...s].reduce((a, d) => { const [x, y] = span(tmpl(kind, d)); return a + Math.round(((y - x + 1) * h) / GH) + gap; }, -gap);
function digits(img, kind, s, cx, y, h, rgb, gap = 2) {
	let x = Math.round(cx - digitsWidth(kind, s, h, gap) / 2);
	for (const d of s) x += digit(img, kind, d, x, y, h, rgb) + gap;
}

/**
 * A nickname at (x, top), circles D px across: {prefix, sup, disc, ring, ringEmpty, dot,
 * suffix}, each optional, in the order "Name to copy" writes them. → its width.
 */
export function name(img, n, x, top, D) {
	const s = Math.max(2, Math.round((0.6 * D) / 5)), gap = Math.round(D / 8);
	let at = x;
	const word = str => { text(img, str, at, top + D - 5 * s, s); at += textWidth(str, s) + gap; };
	if (n.dot) { const r = Math.round(0.15 * D); circle(img, at + r, top + D / 2, r, INK); at += 2 * r + gap; }
	if (n.prefix) word(n.prefix);
	if (n.sup) {
		const h = Math.round(0.4 * D), w = digitsWidth('sup', n.sup, h, 2);
		digits(img, 'sup', n.sup, at + w / 2, top, h, INK);
		at += w + gap;
	}
	if (n.disc != null) {
		circle(img, at + D / 2, top + D / 2, D / 2, INK);
		digits(img, 'disc', n.disc, at + D / 2, top + D / 4, Math.round(D / 2), WHITE);
		at += D + gap;
	}
	if (n.ringEmpty) { circle(img, at + D / 2, top + D / 2, D / 2, INK, Math.max(2, D / 16)); at += D + gap; }
	if (n.ring != null) {
		circle(img, at + D / 2, top + D / 2, D / 2, INK, Math.max(2, D / 16));
		digits(img, 'ring', n.ring, at + D / 2, top + 0.3 * D, Math.round(0.4 * D), INK);
		at += D + gap;
	}
	if (n.suffix) word(n.suffix);
	return at - gap - x;
}
export const nameWidth = (n, D) => name(blank(4 * D * 8, 2 * D), n, 0, 0, D);

/**
 * A list screenshot, W × H: {count, field (the search, '' for an empty field), header (its edge,
 * in W), rows: [{y: the bars' top in W, tiles: [tile | null × 3]}], pill: {y0, y1} in W,
 * sort: '#' or 'other' on the tag button, buttons: false for none}. tile: {cp, name, noBar}.
 */
export function drawShot({ W = 1206, H = 2622, count = null, field = 'XXL', header = 0.5, rows = [], pill = null, sort = '#', buttons = true }) {
	const img = blank(W, H);
	rect(img, 0, 0, W, header * W, HEADER);
	if (count != null) { const s = Math.round(0.012 * W), str = `(${count})`; text(img, str, (W - textWidth(str, s)) / 2, 0.15 * W, s); }
	if (field != null) {
		const y0 = 0.32 * W, h = 0.08 * W, x0 = 0.12 * W, x1 = 0.95 * W;
		rect(img, x0, y0, x1 - x0, h, FIELD);
		circle(img, x0 + 0.045 * W, y0 + h / 2, 0.02 * W, INK, 0.006 * W);
		rect(img, x1 - 0.08 * W, y0, 0.004 * W, h, [212, 226, 212]);
		if (field) text(img, field, x0 + 0.1 * W, y0 + 0.02 * W, Math.round(0.008 * W));
	}
	const cols = [0.183, 0.5, 0.815];
	for (const r of rows) r.tiles.forEach((t, c) => {
		if (!t) return;
		const bx = cols[c] * W, by = r.y * W;
		if (!t.noBar) rect(img, bx - 0.0675 * W, by, 0.135 * W, 0.008 * W, BAR);
		if (t.cp != null) {
			const s = Math.round(0.0066 * W), str = `CP${t.cp}`;
			text(img, str, bx - textWidth(str, s) / 2, by - 0.285 * W, s);
		}
		if (t.name) {
			const D = Math.round(0.04 * W), w = nameWidth(t.name, D);
			name(img, t.name, Math.round(bx - w / 2), Math.round(by - 0.052 * W), D);
		}
	});
	// drawn after the tiles: it lies over them
	if (pill) rect(img, 0.9 * W, pill.y0 * W, 0.055 * W, (pill.y1 - pill.y0) * W, WHITE);
	if (buttons) {
		const cy = H - 0.131 * W;
		circle(img, 0.5 * W, cy, 0.057 * W, [80, 80, 80]);
		circle(img, 0.862 * W, cy, 0.083 * W, [80, 80, 80]);
		const cx = 0.862 * W;
		if (sort === '#') {
			for (const dx of [-0.012, 0.012]) rect(img, cx + (dx - 0.004) * W, cy - 0.03 * W, 0.008 * W, 0.06 * W, WHITE);
			for (const dy of [-0.009, 0.009]) rect(img, cx - 0.025 * W, cy + (dy - 0.003) * W, 0.05 * W, 0.006 * W, WHITE);
		} else if (sort === 'other') {
			rect(img, cx - 0.025 * W, cy - 0.003 * W, 0.05 * W, 0.006 * W, WHITE);
			rect(img, cx - 0.003 * W, cy - 0.03 * W, 0.006 * W, 0.06 * W, WHITE);
		}
	}
	return img;
}

/** The block font read back: dark glyphs left to right; '' when any of them isn't a letter of it. */
export function fakeOcr(img) {
	const { width: w, height: h, data } = img, m = new Uint8Array(w * h);
	for (let i = 0; i < w * h; i++) if (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2] < 3 * 128) m[i] = 1;
	const cs = components(m, w, h).filter(c => c.n >= 4).sort((a, b) => a.x0 - b.x0);
	let out = '', last = null;
	for (const c of cs) {
		const ch = c.y1 - c.y0 + 1, s = ch / 5, cw = Math.round((c.x1 - c.x0 + 1) / s);
		let bits = '';
		for (let j = 0; j < 5; j++) for (let i = 0; i < cw; i++) bits += m[Math.floor(c.y0 + (j + 0.5) * s) * w + Math.floor(c.x0 + (i + 0.5) * s)] ? '1' : '0';
		const hit = Object.keys(FONT).find(k => FONT[k] === bits);
		if (hit == null) return '';
		if (last && c.x0 - last.x1 > 1.5 * s) out += ' ';
		out += hit;
		last = c;
	}
	return out;
}

/** An engine (pipeline.js's shape) that reads the block font; answers[whitelist] overrides. */
export function fakeEngine(answers = {}) {
	const calls = [];
	return {
		calls,
		async words() { return []; },
		async line(img, whitelist, psm) {
			calls.push({ whitelist, psm, w: img.width, h: img.height });
			const a = answers[whitelist];
			if (typeof a === 'function') return a(img);
			if (Array.isArray(a) && a.length) return a.shift();
			return fakeOcr(img);
		},
	};
}
