import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score, isXXLByHeight } from '../src/core/score.js';

const coef = { h: 800, w: 150, iv: 50, xxlAdj: 1, xxlBonus: 178 };
// made-up species: 1.0 m, 20 kg, σ 2.5 kg, XXL max 1.75 m (K = 1.75), XL max 1.5 m
const row = [1.0, 20.0, 2.5, 1.75, 150, 120, 140, 'NORMAL', 1.5];

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

test('score parts and total', () => {
	const s = score(row, coef, 1.80, 30.0, 45, true);
	near(s.K, 1.75);
	near(s.hPart, 800 * 1.8 / 1.75);	// 822.857…
	near(s.wPart, 150 * 1.5 / 2.25);	// weight denominator K + 4σ/w̄ = 2.25
	near(s.ivPart, 50);
	assert.equal(s.bonus, 178);
	near(s.total, 800 * 1.8 / 1.75 + 100 + 50 + 178);
	near(s.band, 800 * 0.005 / 1.75 + 150 * 0.005 / 20 / 2.25);
});

test('no bonus without XXL; IV part scales', () => {
	const s = score(row, coef, 1.2, 20, 0, false);
	assert.equal(s.bonus, 0);
	near(s.ivPart, 0);
	near(s.total, 800 * 1.2 / 1.75 + 150 / 2.25);
});

test('XXL from height, with the display-rounding boundary', () => {
	assert.equal(isXXLByHeight(row, 1.80), true);
	assert.equal(isXXLByHeight(row, 1.40), false);
	assert.equal(isXXLByHeight(row, 1.50), null, '1.50 shown could be 1.495..1.505');
	assert.equal(isXXLByHeight(row, 1.51), true);
	assert.equal(isXXLByHeight(row, 1.49), false);
});
