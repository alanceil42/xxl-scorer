// Mega evolved Pokémon: recognised by the "was caught" line's mega name or by a CP only a mega's
// stats give; such a row gets the species and a note, never a score.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactGameMaster, ROW } from '../src/core/gm.js';
import { compactText, nameIndex, findMegaDex } from '../src/core/text.js';
import { makeContext, evaluate, canMerge } from '../src/core/evaluate.js';
import { levelTable, cpOf, hpOf } from '../src/core/ivs.js';
import { syntheticGameMaster, syntheticText, CPM } from './synthetic.js';

const base = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
const en = compactText(syntheticText('en'));
const BASE = base.species.FAKEON.f[''];	// [0.5 m, 8 kg, ..., 100/100/100, WATER]

/** The synthetic game data with megas for Fakeon (stats as the rows' ATK, DEF, STA). */
function withMegas(megaStats) {
	const gm = structuredClone(base);
	gm.species.FAKEON.mega = Object.keys(megaStats).sort();
	gm.species.FAKEON.megaStats = megaStats;
	return gm;
}

const megaRow = ([a, d, s]) => { const r = [...BASE]; r[ROW.ATK] = a; r[ROW.DEF] = d; r[ROW.STA] = s; return r; };
const at = level => levelTable(CPM).find(x => x.level === level).m;
const shown = (row, ivs, level) => ({ cp: cpOf(row, ivs.a, ivs.d, ivs.s, at(level)), hp: hpOf(row, ivs.s, at(level)) });
const bars = ivs => ({ a: ivs.a - 0.05, d: ivs.d - 0.05, s: ivs.s - 0.05 });
const IVS = { a: 14, d: 15, s: 13 };

test('text table: mega and primal names by Pokédex number; a table without them finds none', () => {
	assert.deepEqual(en.temp, { 9002: ['Mega Fakeon', 'Primal Fakeon'] });
	assert.equal(en.names['9002'], 'Fakeon', 'the species name stays the species name');
	const idx = nameIndex(en);
	assert.equal(findMegaDex('Mega Fakeon', idx), 9002);
	assert.equal(findMegaDex('Primal Fakeon', idx), 9002);
	assert.equal(findMegaDex('Mega Fakcon', idx), 9002, 'one letter misread');
	assert.equal(findMegaDex('Fakeon', idx), null, 'the normal form is no mega');
	assert.equal(findMegaDex('Testmon', idx), null);
	assert.equal(findMegaDex('', idx), null);
	const old = { ...en };
	delete old.temp;
	assert.equal(findMegaDex('Mega Fakeon', nameIndex(old)), null, 'a stored table from before');
});

test('the "was caught" line names a mega: the species, a note, no IVs, sizes or score', () => {
	const ctx = makeContext(withMegas({ MEGA: [180, 130, 100] }), en);
	const r = evaluate({ species: 'Mega Fakeon', caught: '7/28/2024', hp: 40, cp: null, height_m: 0.71, weight_kg: 12.5,
		bars: bars(IVS), types: [] }, ctx);
	assert.equal(r.mega, true);
	assert.equal(r.id, 'FAKEON');
	assert.equal(r.name, 'Fakeon');
	assert.equal(r.types, 'WATER', 'the normal form\'s types');
	assert.equal(r.score, null);
	assert.equal(r.ivs, null);
	assert.equal(r.height_m, null, 'the mega\'s size is no size of the Pokémon');
	assert.equal(r.weight_kg, null);
	assert.equal(r.key, null);
	assert.deepEqual(r.issues.map(i => i.code), ['mega']);
	assert.match(r.issues[0].msg, /Mega evolved.*back to normal/);
	// game data without megaStats (an older stored copy): the line alone still says it
	assert.equal(evaluate({ species: 'Mega Fakeon', hp: 40 }, makeContext(base, en)).mega, true);
});

for (const [label, stats] of [
	['two megas (X and Y), the first', { MEGA_X: [180, 130, 100], MEGA_Y: [210, 110, 100] }],
	['two megas (X and Y), the second', { MEGA_Y: [210, 110, 100], MEGA_X: [180, 130, 100] }],
	['a primal', { PRIMAL: [190, 140, 100] }],
	['a mega whose stamina differs (its HP)', { MEGA: [180, 130, 125] }],
]) {
	test(`a CP only a mega's stats give: ${label}`, () => {
		const ctx = makeContext(withMegas(stats), en);
		const want = Object.values(stats)[0];
		const { cp, hp } = shown(megaRow(want), IVS, 30);
		const normal = shown(BASE, IVS, 30);
		assert.notEqual(cp, normal.cp);
		// a normal-looking size: what the card shows doesn't decide
		for (const b of [bars(IVS), null]) {
			const r = evaluate({ species: 'Fakeon', hp, cp, height_m: 0.5, weight_kg: 8, bars: b, types: ['WATER'] }, ctx);
			assert.equal(r.mega, true, b ? 'with the bars' : 'without');
			assert.equal(r.score, null);
		}
		const n = evaluate({ species: 'Fakeon', hp: normal.hp, cp: normal.cp, height_m: 0.5, weight_kg: 8, bars: bars(IVS) }, ctx);
		assert.equal(n.mega, false, 'the same Pokémon back to normal');
		assert.deepEqual(n.ivs, IVS);
		assert.ok(n.score);
	});
}

test('a CP that a normal form and a mega both give stays normal', () => {
	const stats = [130, 105, 100];
	const ctx = makeContext(withMegas({ MEGA: stats }), en);
	// look for a CP and HP both rows give, with other IVs or at another level
	const normal = new Set();
	for (let level = 10; level <= 40; level++) for (let a = 0; a <= 15; a++) for (let d = 0; d <= 15; d++) for (let s = 0; s <= 15; s++) {
		const n = shown(BASE, { a, d, s }, level);
		normal.add(`${n.cp}/${n.hp}`);
	}
	let both = null;
	for (let level = 10; level <= 40 && !both; level++) for (let a = 0; a <= 15 && !both; a++) for (let s = 0; s <= 15 && !both; s++) {
		const m = shown(megaRow(stats), { a, d: 0, s }, level);
		if (normal.has(`${m.cp}/${m.hp}`)) both = m;
	}
	assert.ok(both, 'the synthetic data has such a pair');
	const r = evaluate({ species: 'Fakeon', hp: both.hp, cp: both.cp, height_m: 0.5, weight_kg: 8 }, ctx);
	assert.equal(r.mega, false);
	assert.ok(!r.issues.some(i => i.code === 'mega'));
});

test('a misread CP fitting nothing stays a CP to check; values typed in the editor turn the CP check off', () => {
	const ctx = makeContext(withMegas({ MEGA: [180, 130, 100] }), en);
	const { hp } = shown(BASE, IVS, 30);
	const odd = evaluate({ species: 'Fakeon', hp, cp: 9999, height_m: 0.5, weight_kg: 8, bars: bars(IVS) }, ctx);
	assert.equal(odd.mega, false);
	const { cp } = shown(megaRow([180, 130, 100]), IVS, 30);
	for (const edits of [{ cp }, { height_m: 0.5 }, { ivs: IVS }, { form: '' }]) {
		const r = evaluate({ species: 'Fakeon', hp, cp, height_m: 0.5, weight_kg: 8, bars: bars(IVS) }, ctx, edits);
		assert.equal(r.mega, false, JSON.stringify(edits));
	}
	// the mega name: Save in the editor stores the species shown, which keeps it a mega row;
	// another species, or the normal height and weight typed in, make it an ordinary one
	const named = { species: 'Mega Fakeon', hp, height_m: 0.71, weight_kg: 12.5, bars: bars(IVS) };
	assert.equal(evaluate(named, ctx, { id: 'FAKEON' }).mega, true);
	assert.equal(evaluate(named, ctx, { height_m: 0.5 }).mega, true, 'one size alone');
	assert.equal(evaluate(named, ctx, { id: 'TESTMON' }).mega, false);
	const typed = evaluate(named, ctx, { id: 'FAKEON', height_m: 0.5, weight_kg: 8, cp: shown(BASE, IVS, 30).cp });
	assert.equal(typed.mega, false);
	assert.equal(typed.weight_kg, 8);
	assert.ok(typed.score);
	// no megaStats: nothing to compare with, the CP is flagged as before
	const old = evaluate({ species: 'Fakeon', hp, cp, height_m: 0.5, weight_kg: 8, bars: bars(IVS) }, makeContext(base, en));
	assert.equal(old.mega, false);
});

test('a mega screenshot never merges with one of the same Pokémon back to normal', () => {
	const ctx = makeContext(withMegas({ MEGA: [180, 130, 100] }), en);
	const common = { caught: '7/28/2024', caughtPill: '2024 07/28', hp: 40, name: 'MM', types: ['WATER'] };
	const mega = { ...common, species: 'Mega Fakeon', height_m: 0.71, weight_kg: 12.5, bars: bars(IVS) };
	const normal = { ...common, species: 'Fakeon', height_m: 0.5, weight_kg: 8, bars: bars(IVS) };
	assert.equal(canMerge(mega, normal, ctx), false);
	assert.equal(canMerge(mega, { ...mega, species: null, bars: null }, ctx), true, 'two mega screenshots do');
});
