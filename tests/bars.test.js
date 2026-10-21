import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBars } from '../src/core/bars.js';
import { crop, thresholdWhiteText, downscale, boxOf, REGIONS } from '../src/core/image.js';

/** White image with three appraisal-style bars drawn in the lower half (no game art). */
function drawBars(W, H, ivs) {
	const data = new Uint8ClampedArray(W * H * 4).fill(255);
	const px = (x, y, [r, g, b]) => { const i = (y * W + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; };
	const segLen = Math.round(W * 0.1), gap = 4, x0 = Math.round(W * 0.08), barH = Math.round(W * 0.02);
	ivs.forEach((iv, b) => {
		const y0 = Math.round(H * 0.75) + b * Math.round(H * 0.04);
		for (let s = 0; s < 3; s++) {
			const sx = x0 + s * (segLen + gap);
			const filled = Math.round(segLen * Math.max(0, Math.min(5, iv - 5 * s)) / 5);
			for (let x = 0; x < segLen; x++) {
				for (let y = 0; y < barH; y++) px(sx + x, y0 + y, x < filled ? [240, 150, 40] : [215, 215, 215]);
			}
		}
	});
	return { width: W, height: H, data };
}

test('reads three bars', () => {
	const r = readBars(drawBars(600, 1300, [15, 7, 0]));
	assert.ok(Math.abs(r.a - 15) < 0.2 && Math.abs(r.d - 7) < 0.2 && Math.abs(r.s - 0) < 0.2, JSON.stringify(r));
});

test('no bars → null', () => {
	const W = 300, H = 600;
	assert.equal(readBars({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) }), null);
});

test('image helpers', () => {
	const img = drawBars(200, 400, [5, 5, 5]);
	const c = crop(img, { x: 10, y: 20, w: 30, h: 40 });
	assert.equal(c.data.length, 30 * 40 * 4);
	const t = thresholdWhiteText({ width: 2, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255, 10, 10, 10, 255]) });
	assert.deepEqual([...t.data], [0, 0, 0, 255, 255, 255, 255, 255]);
	const d = downscale(img, 100);
	assert.equal(Math.max(d.width, d.height), 100);
	// regions are in units of the width (the game lays the top of the screen out from it)
	assert.deepEqual(boxOf({ width: 1000, height: 2000 }, REGIONS.cp), { x: 300, y: 100, w: 400, h: 110 });
	assert.deepEqual(boxOf({ width: 1000, height: 1100 }, REGIONS.sprite).h, 577);
});
