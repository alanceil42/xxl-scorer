// The list's orders: what "Newest" means, directions, missing values, ties.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SORTS, MENU, firstDir, isDefault, sortList, caughtSortKey, cmp } from '../src/core/sort.js';

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
