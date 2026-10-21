// The stats-row close-up: HP bar anchor, crops, badge, crop text rules. No game art:
// the images are drawn here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findHpBar, statsBoxes, badgeText, HP_BAR_X0 } from '../src/core/image.js';
import { makeRules, parseCrops, parseTypes } from '../src/core/read.js';
import { compactText } from '../src/core/text.js';
import { syntheticText } from './synthetic.js';

const en = makeRules(compactText(syntheticText('en')));

function canvas(W, H, rgb = [250, 250, 250]) {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let i = 0; i < data.length; i += 4) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
	const rect = (x0, y0, w, h, c) => {
		for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; }
	};
	return { img: { width: W, height: H, data }, rect };
}

test('HP bar: found under the name, also when hurt; a shifted card is a mid-swipe screenshot', () => {
	const W = 600, H = 1300;
	const { img, rect } = canvas(W, H);
	rect(Math.round(W * HP_BAR_X0), 590, 300, 8, [140, 225, 178]);	// green bar
	rect(470, 560, 120, 10, [240, 180, 60]);	// the orange year badge to the right: not the bar
	const bar = findHpBar(img);
	assert.ok(bar && Math.abs(bar.y - 594) <= 1 && bar.x0 === Math.round(W * HP_BAR_X0), JSON.stringify(bar));
	const boxes = statsBoxes(img, bar);
	assert.ok(boxes.weight.y > bar.y && boxes.weight.x < W * 0.1 && boxes.height.x > W * 0.6);

	const hurt = canvas(W, H);
	hurt.rect(Math.round(W * HP_BAR_X0), 590, 90, 8, [235, 70, 60]);	// red, a third full
	hurt.rect(Math.round(W * HP_BAR_X0) + 90, 590, 210, 8, [215, 215, 215]);
	assert.equal(findHpBar(hurt.img), null, 'a red run must cross the middle');
	hurt.rect(Math.round(W * HP_BAR_X0), 590, 200, 8, [235, 70, 60]);
	assert.ok(findHpBar(hurt.img), 'red, two thirds');

	const slid = canvas(W, H);
	slid.rect(Math.round(W * 0.47), 590, 300, 8, [140, 225, 178]);
	assert.ok(Math.abs(findHpBar(slid.img).x0 / W - HP_BAR_X0) > 0.03);

	assert.equal(findHpBar(canvas(W, H).img), null, 'no bar');
	const big = canvas(W, H);
	big.rect(100, 500, 400, 200, [140, 225, 178]);	// a green background, not a thin bar
	assert.equal(findHpBar(big.img), null);
});

test('badge: white text kept, the pill and the card dropped', () => {
	for (const [card, pill] of [[[250, 250, 250], [210, 180, 80]], [[225, 185, 185], [130, 150, 150]]]) {
		const { img, rect } = canvas(80, 30, card);
		rect(10, 5, 60, 20, pill);
		rect(25, 10, 4, 10, card.map(c => Math.min(255, c + 20)));	// a stroke of the text
		const out = badgeText(img);
		const at = (x, y) => out.data[(y * 80 + x) * 4];
		assert.equal(at(26, 15), 0, 'text → black');
		assert.equal(at(15, 15), 255, 'pill → white');
		assert.equal(at(2, 2), 255, 'card → white');
	}
});

test('crop texts: exact shapes only, at most two decimals', () => {
	assert.deepEqual(parseCrops({ hp: '60/60 HP', weight: '22.38kg', height: '0.79m', badge: 'XXL' }, en),
		{ hp: 60, weight_kg: 22.38, height_m: 0.79, badge: 'XXL' });
	assert.deepEqual(parseCrops({ hp: '97 /97HP', weight: '1kg', height: '92m', badge: 'XL' }, en),
		{ hp: 97, weight_kg: 1, height_m: 92, badge: 'XL' });
	const bad = parseCrops({ hp: '53/', weight: '259.671kg', height: '0.79', badge: 'XXLX' }, en);
	assert.deepEqual(bad, { hp: null, weight_kg: null, height_m: null, badge: null });
	assert.equal(parseCrops({ hp: '60 / 61 HP' }, en).hp, 61, 'hurt: the maximum');
	assert.equal(parseCrops({ hp: '61 / 60 HP' }, en).hp, null, 'current above maximum: misread');
});

test('type labels', () => {
	assert.deepEqual(parseTypes('DARK / NORMAL'), ['DARK', 'NORMAL']);
	assert.deepEqual(parseTypes('NORMAL FLY IMG'), ['NORMAL'], 'cut-off words do not count');
	assert.deepEqual(parseTypes('STEE'), []);
});

test('full-image weight: two decimals at most', () => {
	assert.equal(en.weight.exec('259.671'), null);
	assert.equal(Number(en.weight.exec('259.67kg')[1]), 259.67);
});
