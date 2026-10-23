// Appraisal bars → IVs from pixels.

/**
 * Measure the three appraisal bars (Atk, Def, HP). Each bar = 3 segments × 5 IV points.
 * A pixel belongs to a bar if it isn't near-white; it is filled if saturated (orange or red).
 * @param {{width: number, height: number, data: Uint8ClampedArray}} img  RGBA
 * @returns {{a: number, d: number, s: number} | null}  fractional IVs 0..15
 */
export function readBars(img) {
	const b = findBars(img);
	return b ? b.ivs : null;
}

/**
 * readBars with the bars' rows: {ivs, y: [atk, def, hp] centre rows in px}. The appraisal is laid
 * out from the bottom edge, so where the bars are tells how much of the card it covers.
 * @param {number} [U]  what the bars' sizes scale with: the card column's width (cardColumn in
 *        image.js). The panel is laid out from the screen's left edge (its bars start 0.12 column
 *        widths from it on iPhones and on an iPad alike), left of the column on an iPad, so the
 *        whole screenshot is searched.
 */
export function findBars(img, U = img.width) {
	const { width: W, height: H, data } = img;
	const xmax = Math.floor(W * 0.62);
	const minC = (x, y) => { const i = (y * W + x) * 4; return Math.min(data[i], data[i + 1], data[i + 2]); };
	const satC = (x, y) => {
		const i = (y * W + x) * 4;
		return Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
	};
	const bands = [];
	let band = [], miss = 0;
	// a row or two inside a bar can miss (a recompressed screenshot's artefacts): one bar must
	// not count as two, or the last three bands are the wrong three
	const maxMiss = Math.max(2, Math.round(U * 0.003));
	for (let y = Math.floor(H * 0.5); y < H; y++) {
		const runs = [];
		let x = 0;
		while (x < xmax) {
			if (minC(x, y) < 240) {
				const s = x;
				while (x < xmax && minC(x, y) < 240) x++;
				if (x - s >= U * 0.05) runs.push([s, x - 1]);
			}
			x++;
		}
		let hit = null;
		for (let i = 0; i + 2 < runs.length && !hit; i++) {
			const seg = runs.slice(i, i + 3);
			const L = seg.map(r => r[1] - r[0] + 1);
			const g1 = seg[1][0] - seg[0][1], g2 = seg[2][0] - seg[1][1];
			if (L.every(l => l >= U * 0.07 && l <= U * 0.16) && Math.max(...L) - Math.min(...L) <= U * 0.02 &&
				g1 >= 2 && g1 <= U * 0.02 && g2 >= 2 && g2 <= U * 0.02) hit = seg;
		}
		if (hit) { band.push({ y, seg: hit }); miss = 0; }
		else if (band.length && ++miss <= maxMiss) continue;
		else {
			if (band.length >= U * 0.008) bands.push(band);
			band = [];
			miss = 0;
		}
	}
	if (band.length >= U * 0.008) bands.push(band);
	if (bands.length < 3) return null;
	const three = bands.slice(-3);
	const vals = three.map(b => {
		const { y, seg } = b[Math.floor(b.length / 2)];
		return seg.reduce((v, [s, e]) => {
			let f = 0;
			for (let x = s; x <= e; x++) if (satC(x, y) > 40) f++;
			return v + 5 * f / (e - s + 1);
		}, 0);
	});
	const r2 = v => Math.round(v * 100) / 100;
	return { ivs: { a: r2(vals[0]), d: r2(vals[1]), s: r2(vals[2]) }, y: three.map(b => b[Math.floor(b.length / 2)].y) };
}
