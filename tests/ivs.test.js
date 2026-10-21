import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelTable, cpOf, hpOf, solveIVs, rankByBars, roundBars, levelsForHp } from '../src/core/ivs.js';
import { CPM } from './synthetic.js';

const row = [1.0, 20.0, 2.5, 1.75, 150, 120, 140, 'NORMAL', 1.5];

test('level table has half levels', () => {
	const t = levelTable([0.1, 0.2, 0.3]);
	assert.deepEqual(t.map(x => x.level), [1, 1.5, 2, 2.5, 3]);
	assert.ok(Math.abs(t[1].m - Math.sqrt((0.01 + 0.04) / 2)) < 1e-12);
});

test('solver finds the IVs that produced CP and HP', () => {
	const lv = levelTable(CPM).find(x => x.level === 20);
	const ivs = { a: 13, d: 4, s: 9 };
	const cp = cpOf(row, ivs.a, ivs.d, ivs.s, lv.m), hp = hpOf(row, ivs.s, lv.m);
	const hits = solveIVs(row, cp, hp, CPM);
	assert.ok(hits.some(h => h.a === 13 && h.d === 4 && h.s === 9 && h.level === 20));
	const ranked = rankByBars(hits, { a: 12.9, d: 4.1, s: 9.05 });
	assert.deepEqual([ranked[0].a, ranked[0].d, ranked[0].s, ranked[0].level], [13, 4, 9, 20]);
});

test('CP and HP floors at 10', () => {
	assert.equal(cpOf(row, 0, 0, 0, 0.01), 10);
	assert.equal(hpOf(row, 0, 0.01), 10);
});

test('bars rounding and level from HP', () => {
	assert.deepEqual(roundBars({ a: 14.85, d: 2.01, s: -0.2 }), { a: 15, d: 2, s: 0 });
	assert.equal(roundBars(null), null);
	const lv = levelTable(CPM).find(x => x.level === 15);
	const hp = hpOf(row, 7, lv.m);
	const found = levelsForHp(row, { a: 1, d: 2, s: 7 }, hp, CPM);
	assert.ok(found.some(f => f.level === 15 && f.cp === cpOf(row, 1, 2, 7, lv.m)));
});
