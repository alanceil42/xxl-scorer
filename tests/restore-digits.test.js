// restoreDigits (src/core/evaluate.js) builds its candidates from the read text. Until it did, it
// tried every hundredth between the bounds; that loop is kept here, unchanged, as the reference:
// both must give the same values, in the same order, for every reading and every range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restoreDigits } from '../src/core/evaluate.js';

const shown = v => v.toFixed(2).replace(/\.?0+$/, '');

/** The function as it was: every hundredth in [lo, hi] whose shown text could be the reading. */
function reference(x, lo, hi) {
	const s = shown(x);
	const bare = s.includes('.') ? null : s;
	const out = [];
	for (let c = Math.max(1, Math.ceil(lo * 100)); c <= Math.floor(hi * 100); c++) {
		const d = shown(c / 100);
		if (d === s) continue;
		if (d.endsWith(s) || (bare && d.replace('.', '') === bare)) out.push(c / 100);
	}
	return out;
}

// Bounds shaped like fixSizes' (made-up species): heights 0.2 h̄ .. XXL max, weights 5 % or
// 1 % of w̄ .. the loose ceiling; small and large species, bounds that aren't whole hundredths,
// a range inside one whole number, and ranges that start at or below a hundredth.
const SMALL = [[0.04, 0.35], [0.06, 0.525], [0.2, 1.75], [0.123, 2.345], [0.4, 3.5], [1.02, 1.09], [0, 0.5],
	[0.001, 0.2], [0.08, 3], [0.016, 4.2]];
const MEDIUM = [[1.5, 101.25], [2.75, 96.09], [4, 40.6], [11.5, 450.4]];
const LARGE = [[10, 3374.66], [460, 2000.005]];

// Readings: everything the game shows up to 25 (every hundredth), larger whole and decimal
// numbers, what the trainer or the sprite leave of them, and values no reading should be.
const upTo25 = Array.from({ length: 2501 }, (_, c) => c / 100);
const larger = [25.5, 30.12, 62, 99.9, 100, 109.32, 205, 211, 250, 259.67, 685, 682.37, 999.9, 1000,
	1200, 2050, 3374.7, 9999, 100000];
const odd = [-1, -0, -0.004, 0.004, 0.005, 1 / 3, 2.675, 1e21, NaN, 0.1 + 0.2];

test('the same values as the loop it replaces: small ranges, every reading', () => {
	for (const [lo, hi] of SMALL) {
		for (const x of [...upTo25, ...larger, ...odd]) {
			assert.deepEqual(restoreDigits(x, lo, hi), reference(x, lo, hi), `x ${x}, [${lo}, ${hi}]`);
		}
	}
});

// The loop is slow on wide ranges (that is the point), so fewer readings there: one hundredth in
// 13 for ranges up to hundreds, a few for ranges up to a tonne.
test('the same values as the loop it replaces: ranges up to hundreds', () => {
	const xs = [...upTo25.filter((_, i) => i % 13 === 0), ...larger, ...odd];
	for (const [lo, hi] of MEDIUM) {
		for (const x of xs) assert.deepEqual(restoreDigits(x, lo, hi), reference(x, lo, hi), `x ${x}, [${lo}, ${hi}]`);
	}
});

test('the same values as the loop it replaces: species of up to a tonne', () => {
	const xs = [0, 0.01, 0.5, 0.62, 0.92, 5, 6.85, 9.32, 9.9, 10, 12.05, 20, ...larger, NaN];
	for (const [lo, hi] of LARGE) {
		for (const x of xs) assert.deepEqual(restoreDigits(x, lo, hi), reference(x, lo, hi), `x ${x}, [${lo}, ${hi}]`);
	}
});

test('examples from reading: a hidden leading digit, a lost point', () => {
	assert.deepEqual(restoreDigits(62, 0.2, 2), [0.62, 1.62]);
	assert.deepEqual(restoreDigits(211, 0.4, 3.5), [2.11]);
	assert.ok(restoreDigits(9.32, 50, 200).includes(109.32));
	assert.deepEqual(restoreDigits(5, 2, 1), [], 'an empty range');
});

test('a reading far outside a large range is quick (it used to take a third of a million tries)', () => {
	const t0 = performance.now();
	for (const x of [0, 100000, 0.01, 7]) restoreDigits(x, 10, 3374.7);
	// generous: the loop took about 100 ms per call here, the candidates a fraction of one
	assert.ok(performance.now() - t0 < 200, `${(performance.now() - t0).toFixed(0)} ms`);
});
