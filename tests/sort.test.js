// The list's orders: what "Newest" means, directions, missing values, ties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SORTS, MENU, firstDir, isDefault, sortList, scoreRanks, caughtSortKey, cmp } from '../src/core/sort.js';

// an evaluated row as the page has it: {row (stored), e (evaluate's result)}
const item = (id, row = {}, e = {}) => ({ row: { id, ...row }, e: { issues: [], types: '', ...e } });
const ids = list => list.map(x => x.row.id);
const score = t => ({ score: { total: t } });

test('the menu: Score, Newest, CP, Pokédex, Name, IVs, Caught', () => {
	assert.deepEqual(MENU.map(k => SORTS[k].label), ['Score', 'Newest', 'CP', 'Pokédex', 'Name', 'IVs', 'Caught']);
	for (const k of MENU) for (const d of [1, -1]) assert.ok(SORTS[k].dirs[d], `${k} ${d}`);
});

test('first tap: best score first in either mode, newest first, #1 first, A-Z', () => {
	assert.equal(firstDir('score', -1), -1);
	assert.equal(firstDir('score', 1), 1);	// XXS mode: lowest wins
	assert.equal(firstDir('newest', -1), -1);
	assert.equal(firstDir('cp', -1), -1);
	assert.equal(firstDir('dex', -1), 1);
	assert.equal(firstDir('name', -1), 1);
	assert.equal(firstDir('caught', -1), -1);
	assert.ok(isDefault({ key: 'score', dir: -1 }, -1));
	assert.ok(!isDefault({ key: 'score', dir: 1 }, -1));
	assert.ok(!isDefault({ key: 'newest', dir: -1 }, -1));
});

test('newest: last batch first, within a batch in screenshot order', () => {
	const list = [
		item('old', { created: 100 }),				// an older row: created stands in
		item('b1-2', { scanned: 200, scanIdx: 2 }),
		item('b2-1', { scanned: 300, scanIdx: 1 }),
		item('b1-0', { scanned: 200, scanIdx: 0 }),
		item('b2-0', { created: 50, scanned: 300, scanIdx: 0 }),	// an old Pokémon scanned again
	];
	assert.deepEqual(ids(sortList(list, { key: 'newest', dir: -1 }, -1)), ['b2-0', 'b2-1', 'b1-0', 'b1-2', 'old']);
	assert.deepEqual(ids(sortList(list, { key: 'newest', dir: 1 }, -1)), ['old', 'b1-2', 'b1-0', 'b2-1', 'b2-0']);
});

test('rows without a value go last in both directions', () => {
	const list = [item('none', {}, {}), item('a', {}, { cp: 100 }), item('b', {}, { cp: 900 })];
	assert.deepEqual(ids(sortList(list, { key: 'cp', dir: -1 }, -1)), ['b', 'a', 'none']);
	assert.deepEqual(ids(sortList(list, { key: 'cp', dir: 1 }, -1)), ['a', 'b', 'none']);
	const scored = [item('x', {}, {}), item('y', {}, score(900)), item('z', {}, score(1100))];
	assert.deepEqual(ids(sortList(scored, { key: 'score', dir: -1 }, -1)), ['z', 'y', 'x']);
	assert.deepEqual(ids(sortList(scored, { key: 'score', dir: 1 }, 1)), ['y', 'z', 'x']);
});

test('Pokédex: by number, forms after the base form, each species best score first', () => {
	const list = [
		item('tor-t', {}, { dex: 641, formName: 'Therian', ...score(1100) }),
		item('chansey-lo', {}, { dex: 113, formName: '', ...score(900) }),
		item('tor', {}, { dex: 641, formName: '', ...score(1000) }),
		item('chansey-hi', {}, { dex: 113, formName: '', ...score(1060) }),
	];
	assert.deepEqual(ids(sortList(list, { key: 'dex', dir: 1 }, -1)), ['chansey-hi', 'chansey-lo', 'tor', 'tor-t']);
	// XXS mode: the best is the lowest
	assert.deepEqual(ids(sortList(list, { key: 'dex', dir: 1 }, 1)), ['chansey-lo', 'chansey-hi', 'tor', 'tor-t']);
});

test('caught: dates as read, newest first', () => {
	assert.equal(caughtSortKey('7/28/2024'), '2024-07-28');
	assert.equal(caughtSortKey('28.7.2024'), '2024-07-28');
	assert.equal(caughtSortKey(''), null);
	const list = [item('a', {}, { caught: '2/4/2024' }), item('b', {}, { caught: '10/16/2026' }), item('c', {}, { caught: '6/20/2026' })];
	assert.deepEqual(ids(sortList(list, { key: 'caught', dir: -1 }, -1)), ['b', 'c', 'a']);
});

test('keys compare element by element', () => {
	assert.equal(cmp([1, 'b'], [1, 'a']), 1);
	assert.equal(cmp([2], [10]), -1);
	assert.equal(cmp('chansey', 'Chansey'.toLowerCase()), 0);
});

test('name: A-Z by name and form, ignoring case; IVs: highest sum first', () => {
	const list = [
		item('b', {}, { name: 'testmon', formName: 'Giant' }), item('none', {}, {}), item('a', {}, { name: 'Testmon' }), item('c', {}, { name: 'Fakeon' }),
	];
	assert.deepEqual(ids(sortList(list, { key: 'name', dir: 1 }, -1)), ['c', 'a', 'b', 'none']);
	assert.deepEqual(ids(sortList(list, { key: 'name', dir: -1 }, -1)), ['b', 'a', 'c', 'none']);
	const ivs = [item('x', {}, { ivs: { a: 1, d: 2, s: 3 } }), item('y', {}, {}), item('z', {}, { ivs: { a: 15, d: 15, s: 15 } })];
	assert.deepEqual(ids(sortList(ivs, { key: 'iv', dir: -1 }, -1)), ['z', 'x', 'y']);
});

test('column headers only: type, level, height, weight, status', () => {
	assert.ok(!MENU.some(k => ['types', 'level', 'height', 'weight', 'status'].includes(k)));
	const list = [
		item('a', {}, { types: 'WATER', level: 20, height_m: 1.2, weight_kg: 30, issues: [{ code: 'cp' }, { code: 'merged', info: true }] }),
		item('b', {}, { types: 'NORMAL/FLYING', level: 31.5, height_m: 2.1, weight_kg: 8 }),
		item('c', {}, { level: null, issues: [{ code: 'size' }, { code: 'ivs' }] }),
	];
	const by = key => ids(sortList(list, { key, dir: firstDir(key, -1) }, -1));
	assert.deepEqual(by('types'), ['b', 'a', 'c'], 'A-Z, no types last');
	assert.deepEqual(by('level'), ['b', 'a', 'c'], 'highest first, unknown last');
	assert.deepEqual(by('height'), ['b', 'a', 'c']);
	assert.deepEqual(by('weight'), ['a', 'b', 'c']);
	assert.deepEqual(by('status'), ['c', 'a', 'b'], 'most problems first; notes do not count');
});

test('an unknown sort falls back to the score', () => {
	const list = [item('lo', {}, score(900)), item('hi', {}, score(1100))];
	assert.deepEqual(ids(sortList(list, { key: 'nonsense', dir: -1 }, -1)), ['hi', 'lo']);
});

test('ties: scored rows before unscored, then the newest scan', () => {
	const list = [
		item('old', { scanned: 100 }, { cp: 500, ...score(1000) }),
		item('unscored', { scanned: 300 }, { cp: 500 }),
		item('new', { scanned: 200 }, { cp: 500, ...score(1000) }),
	];
	assert.deepEqual(ids(sortList(list, { key: 'cp', dir: -1 }, -1)), ['new', 'old', 'unscored']);
	assert.deepEqual(ids(sortList(list, { key: 'cp', dir: 1 }, -1)), ['new', 'old', 'unscored'], 'in either direction');
});

test('caught: year first, and day before month when the first number is over 12', () => {
	assert.equal(caughtSortKey('2024/7/28'), '2024-07-28');
	assert.equal(caughtSortKey('28/7/2024'), '2024-07-28');
	assert.equal(caughtSortKey('7/28'), null);
	assert.equal(caughtSortKey(null), null);
	assert.equal(cmp(3, 3), 0);
	assert.equal(cmp(4, 3), 1);
	assert.equal(cmp([1], [1, 2]), 0, 'a missing element decides nothing');
});

test('score: an entered in-game score counts instead of the computed one', () => {
	// computed 1115.5, but the game says 1112: it belongs between 1113.6 and 1104.4
	const list = [
		item('excadrill', {}, score(1104.4)),
		item('meditite', {}, { ...score(1115.5), inGame: 1112 }),
		item('staryu', {}, score(1113.6)),
		item('only-game', {}, { score: null, inGame: 1100 }),
		item('none', {}, { score: null }),
	];
	assert.deepEqual(ids(sortList(list, { key: 'score', dir: -1 }, -1)), ['staryu', 'meditite', 'excadrill', 'only-game', 'none']);
});

test('ranks: place by score whatever the order, ties share one, no score no place', () => {
	const list = [item('c', {}, score(990)), item('none'), item('a', {}, score(1100)),
		item('b1', {}, score(1050)), item('b2', {}, { ...score(1000), inGame: 1050 }), item('d', {}, score(900))];
	assert.deepEqual(Object.fromEntries(scoreRanks(list, -1)), { a: 1, b1: 2, b2: 2, c: 4, d: 5 });
	// XXS mode: the lowest wins
	assert.deepEqual(Object.fromEntries(scoreRanks(list, 1)), { d: 1, c: 2, b1: 3, b2: 3, a: 5 });
	assert.deepEqual(ids(list), ['c', 'none', 'a', 'b1', 'b2', 'd'], 'the list itself stays as it was');
});
