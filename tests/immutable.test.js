// The page caches evaluated rows by their reading and edits objects (src/ui/evalcache.js), so
// those objects must never be changed in place: a changed reading would keep showing its old
// score. Here every function the page hands readings, edits or evaluated rows to runs on
// frozen ones (a write then throws, these modules being strict), and the page's own code is
// searched for writes into a row's reading or edits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactGameMaster } from '../src/core/gm.js';
import { compactText } from '../src/core/text.js';
import { makeContext, evaluate, evaluateSafely, mergeTarget, mergeReadings, matchScore, duplicateKey } from '../src/core/evaluate.js';
import { levelTable, cpOf, hpOf } from '../src/core/ivs.js';
import { cleanRow } from '../src/core/backup.js';
import { SORTS, sortList } from '../src/core/sort.js';
import { compileSearch, needsCheck } from '../src/core/search.js';
import { gameSearch } from '../src/core/gamesearch.js';
import { formatName, nameValues, DEFAULT_TEMPLATE } from '../src/core/nickname.js';
import { evaluateRow, NO_EDITS } from '../src/ui/evalcache.js';
import { syntheticGameMaster, syntheticText, CPM } from './synthetic.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
const text = compactText(syntheticText('en'));
const ctx = makeContext(gm, text);

function deepFreeze(x) {
	if (x && typeof x === 'object' && !Object.isFrozen(x)) {
		Object.freeze(x);
		for (const v of Object.values(x)) deepFreeze(v);
	}
	return x;
}

const shown = (row, ivs, level) => {
	const m = levelTable(CPM).find(x => x.level === level).m;
	return { cp: cpOf(row, ivs.a, ivs.d, ivs.s, m), hp: hpOf(row, ivs.s, m) };
};
const tm = gm.species.TESTMON.f[''];
const ivs = { a: 15, d: 13, s: 15 };
/** The two screenshots of one Pokémon, as the page reads them: with the appraisal, and without. */
const withBars = () => ({
	species: 'Testmon', caught: '7/28/2024', caughtPill: '2024 07/28', name: 'XX1144¹⁰⁰⓯㉑', ...shown(tm, ivs, 20),
	cpAlt: [19007], height_m: 1.7, weight_kg: null, types: ['NORMAL'], bars: { a: 14.9, d: 13.1, s: 15 }, badge: 'XXL', lucky: false,
});
const without = () => ({
	species: null, caught: null, caughtPill: '2024 07/28', name: 'XX1144¹⁰⁰⓯㉑', ...shown(tm, ivs, 20),
	height_m: 1.7, weight_kg: 30, types: ['NORMAL'], bars: null, badge: 'XXL', lucky: false,
});
const other = () => ({ species: 'Fakeon', caught: '6/20/2026', hp: 60, cp: 300, height_m: 0.6, weight_kg: 9, types: ['WATER'], bars: null });

test('evaluating, merging, sorting, searching and naming leave readings, edits and results as they were', () => {
	const a = deepFreeze(withBars()), b = deepFreeze(without()), c = deepFreeze(other());
	const edits = deepFreeze({ cp: 1500, ivs: { a: 1, d: 2, s: 3 }, xxl: true, inGame: 1100, form: 'GIANT' });
	for (const ed of [NO_EDITS, edits, deepFreeze({})]) {
		for (const r of [a, b, c]) {
			deepFreeze(evaluate(r, ctx, ed));
			deepFreeze(evaluateSafely(r, ctx, ed));
		}
	}
	assert.equal(mergeTarget([a, c], b, ctx), 0, 'the two screenshots are one Pokémon');
	assert.equal(matchScore(c, b, ctx), null);
	const ab = deepFreeze(mergeReadings(a, b, ctx));
	assert.notEqual(ab, a, 'merging makes a new reading');
	deepFreeze(mergeReadings(ab, deepFreeze(without()), ctx));
	deepFreeze(mergeReadings(c, ab, ctx));

	// the list: evaluated rows (shared by the cache, so frozen too) sorted, searched, named
	const rows = [ab, c].map((reading, i) => deepFreeze({ id: `r${i}`, created: i, scanned: 1, scanIdx: i, reading, edits: i ? NO_EDITS : edits }));
	const list = rows.map(row => ({ row, e: deepFreeze(evaluateRow(row.reading, ctx, row.edits)) }));
	for (const key of Object.keys(SORTS)) for (const dir of [1, -1]) sortList([...list], { key, dir }, -1);
	for (const q of ['testmon', 'xxl&cp1000-', '4*', '4attack', 'year2024', 'check', 'normal,water&!lucky', '9001']) {
		const p = compileSearch(q);
		for (const { e } of list) p(e);
	}
	for (const { e } of list) {
		needsCheck(e); gameSearch(e); duplicateKey(e);
		formatName(DEFAULT_TEMPLATE, nameValues(e));
	}

	// a backup's row: cleaned into new objects, the file's own left alone
	const raw = deepFreeze(JSON.parse(JSON.stringify({ ...rows[0], thumb: 'data:image/jpeg;base64,AAAA' })));
	const clean = cleanRow(raw);
	assert.notEqual(clean.reading, raw.reading);
	deepFreeze(evaluateRow(deepFreeze(clean).reading, ctx, clean.edits));
});

test('a reading changed in place would be noticed here', () => {
	const r = deepFreeze(withBars());
	assert.throws(() => { r.cp = 1; }, TypeError);
	assert.throws(() => { r.types.push('FIRE'); }, TypeError);
	assert.throws(() => { delete r.bars.a; }, TypeError);
});

// Writes into a row's reading or edits through the row: row.reading.cp = …, row.edits[k] = …,
// delete t.reading.covered, Object.assign(row.edits, …), row.reading.types.push(…). Building a
// new object before it is stored (const edits = {}; edits[k] = v) is fine and not matched.
const WRITES = [
	/\.(reading|edits)(\.\w+|\[[^\]]*\])+\s*(=(?!=)|\+=|-=|\*=|\/=|\|\|=|&&=|\?\?=|\+\+|--)/,
	/delete\s+[\w$.[\]'"]*\.(reading|edits)\b/,
	/Object\.(assign|defineProperty|defineProperties|setPrototypeOf)\(\s*[\w$.]*\.(reading|edits)\b/,
	/\.(reading|edits)(\.\w+|\[[^\]]*\])*\.(push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear)\(/,
];

test('the page\'s own code doesn\'t write into a row\'s reading or edits', () => {
	const bad = [];
	for (const f of readdirSync(join(root, 'src/ui')).filter(f => f.endsWith('.js'))) {
		readFileSync(join(root, 'src/ui', f), 'utf8').split('\n').forEach((line, i) => {
			if (WRITES.some(re => re.test(line))) bad.push(`src/ui/${f}:${i + 1}: ${line.trim()}`);
		});
	}
	assert.deepEqual(bad, []);
	// and the patterns do find such writes
	for (const line of ['row.reading.cp = 1;', 't.edits[k] = v;', 'row.edits.ivs.a++;', 'delete t.reading.covered;',
		'Object.assign(row.edits, x);', 'row.reading.types.push(t);', 'x.reading.weight_kg ??= 1;'])
		assert.ok(WRITES.some(re => re.test(line)), line);
	for (const line of ['t.reading = mergeReadings(t.reading, reading, state.ctx);', 'const next = { ...row, edits };', 'if (r.reading.cp === 1) f();', 'edits[k] = v;'])
		assert.ok(!WRITES.some(re => re.test(line)), line);
});

test('evaluateRow: one evaluation per reading, edits and game data, the same as evaluateSafely', () => {
	const r = without(), ed = {};
	const e = evaluateRow(r, ctx, ed);
	assert.deepEqual(e, evaluateSafely(r, ctx, ed));
	assert.equal(evaluateRow(r, ctx, ed), e, 'cached');
	assert.notEqual(evaluateRow({ ...r }, ctx, ed), e, 'a new reading is evaluated anew');
	assert.notEqual(evaluateRow(r, ctx, {}), e, 'new edits too');
	assert.notEqual(evaluateRow(r, makeContext(gm, text), ed), e, 'and new game data');
	// rows stored without edits share one object, so they are cached too
	assert.equal(evaluateRow(r, ctx), evaluateRow(r, ctx));
	assert.equal(evaluateRow(r, ctx, undefined), evaluateRow(r, ctx, NO_EDITS));
	// what can't be a key is evaluated every time, as evaluateSafely does
	for (const [reading, edits] of [[r, null], [null, ed], ['x', ed]]) {
		assert.deepEqual(evaluateRow(reading, ctx, edits), evaluateSafely(reading, ctx, edits));
		assert.notEqual(evaluateRow(reading, ctx, edits), evaluateRow(reading, ctx, edits));
	}
});
