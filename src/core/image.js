// Pixel helpers on ImageData-like objects {width, height, data: Uint8ClampedArray RGBA}.
// Pure: used in the browser (canvas ImageData) and in Node tests (decoded PNG).

/**
 * Regions in units of the screenshot's width. The game lays out the top of the screen
 * (CP, sprite, info card down to the stats row) from the width: the HP bar sits at 0.98 W on a
 * 750 × 1334 iPhone 8 and on a 1206 × 2622 iPhone 17 Pro alike. What sits at the bottom (the
 * appraisal, the "was caught" line) is laid out from the bottom edge, so on a shorter screen it
 * covers more of the card.
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
 * The HP bar under the name: a thin horizontal bar, green (yellow or red when hurt), centred on
 * the info card. Everything in the stats row sits at a fixed distance below it, whatever lines
 * come between name and bar ("LUCKY POKÉMON" pushes the bar down), so it anchors the crops of
 * statsBoxes. Its left end also tells a screenshot taken mid-swipe, between two Pokémon: the
 * card is shifted sideways.
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
	return scanBar(img, green, () => true) || scanBar(img, hurt, (x0, x1) => x0 < W / 2 && x1 > W / 2);
}

function scanBar(img, fill, accept) {
	const { width: W, height: H } = img;
	const minRun = W * 0.12;
	let band = null;
	// at 0.98 W, 1.03 W with "LUCKY POKÉMON" (REGIONS)
	for (let y = Math.floor(W * 0.78); y < Math.min(H, W * 1.17); y++) {
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

/** Ends of the full HP bar on an unshifted card, as fractions of the width. */
export const HP_BAR_X0 = 0.249;
export const HP_BAR_X1 = 0.742;

/**
 * A screenshot taken mid-swipe, between two Pokémon: the card is shifted sideways, so the HP bar
 * is too. The bar can also be shortened, from the left by the appraisal's star medallion and from
 * the right by the trainer (on 16:9 screens, where the appraisal reaches up to the bar), or from
 * the right when the Pokémon is hurt. So: an end beyond where the bar can reach, or, when nothing
 * can cover it (no appraisal), a left end away from its place.
 */
export function isSlid(bar, width, appraisal) {
	const x0 = bar.x0 / width, x1 = bar.x1 / width;
	if (x0 < HP_BAR_X0 - 0.03 || x1 > HP_BAR_X1 + 0.03) return true;
	return !appraisal && x0 > HP_BAR_X0 + 0.03;
}

/** "LUCKY POKÉMON" under the name pushes the HP bar down, from 0.98 W to 1.03 W. */
export const isLucky = (bar, width) => bar.y / width > 1.005;

/**
 * Crops for a second, closer reading of the stats row, positioned from the HP bar (findHpBar).
 * Offsets are fractions of the width, measured on 1206 px wide iPhone screenshots.
 */
export function statsBoxes(img, bar) {
	const W = img.width;
	const box = (x0, x1, dy0, dy1) => {
		const y = Math.max(0, Math.round(bar.y + dy0 * W)), y1 = Math.min(img.height, Math.round(bar.y + dy1 * W));
		return { x: Math.round(x0 * W), y, w: Math.round((x1 - x0) * W), h: Math.max(1, y1 - y) };
	};
	return {
		hp: box(0.28, 0.72, 0.016, 0.062),
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

/** A REGIONS entry in pixels (all four numbers are fractions of the width), clipped to the image. */
export function boxOf(img, r) {
	const W = img.width;
	const x = Math.round(W * r.x), y = Math.min(img.height - 1, Math.round(W * r.y));
	return { x, y, w: Math.min(W - x, Math.round(W * r.w)), h: Math.max(1, Math.min(img.height - y, Math.round(W * r.h))) };
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
