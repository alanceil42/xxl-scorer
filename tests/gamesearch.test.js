// "Find in game": the search string for one Pokémon, and that the page's own search
// reads it the way the game would, so the "fits n in this list" check can be trusted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameSearch, ivGroup } from '../src/core/gamesearch.js';
import { compileSearch } from '../src/core/search.js';

const mon = (name, o = {}) => ({ name, formName: '', dex: 1, types: 'NORMAL', cp: 500, hp: 80, xxl: false, xxs: false,
	ivs: { a: 10, d: 10, s: 10 }, caught: '10/10/2026', issues: [], ...o });

test('IV groups as the game\'s search has them: 0, 1-5, 6-10, 11-14, 15', () => {
	const groups = Array.from({ length: 16 }, (_, v) => ivGroup(v));
	assert.deepEqual(groups, [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4]);
});

test('an XXL Tornadus', () => {
	const e = mon('Tornadus', { dex: 641, cp: 1900, hp: 121, xxl: true, ivs: { a: 15, d: 13, s: 15 }, caught: '7/28/2024' });
	assert.equal(gameSearch(e), '641&xxl&cp1900&hp121&4attack&3defense&4hp&year2024');
});

test('XXS, no size class, missing values', () => {
	assert.equal(gameSearch(mon('Joltik', { dex: 595, cp: 88, hp: 31, xxs: true, ivs: { a: 0, d: 5, s: 6 }, caught: '1/2/2025' })),
		'595&xxs&cp88&hp31&0attack&1defense&2hp&year2025');
	// neither XXL nor XXS, no bars, no catch date (a 16:9 screenshot without the appraisal)
	assert.equal(gameSearch(mon('Pidove', { dex: 519, cp: 312, hp: 70, ivs: null, caught: null })), '519&cp312&hp70');
	// a catch date from the year pill ("2024" over "04/19") reads the same
	assert.equal(gameSearch(mon('Gible', { dex: 443, cp: 41, hp: 20, caught: '4/19/2024' })), '443&cp41&hp20&2attack&2defense&2hp&year2024');
});

test('no species or no CP: no search', () => {
	assert.equal(gameSearch(mon('?', { dex: null })), null);
	assert.equal(gameSearch(mon('Gastly', { dex: 92, cp: null })), null);
	assert.equal(gameSearch(null), null);
});

test('every string finds its own row through the page\'s search, and twins together', () => {
	const list = [
		mon('Tornadus', { dex: 641, cp: 1900, hp: 121, xxl: true, ivs: { a: 15, d: 13, s: 15 }, caught: '7/28/2024' }),
		mon('Tornadus', { dex: 641, cp: 1900, hp: 121, xxl: true, ivs: { a: 15, d: 12, s: 15 }, caught: '7/28/2025' }),
		mon('Tynamo', { dex: 602, cp: 214, hp: 41, xxl: true, ivs: { a: 12, d: 14, s: 13 } }),
		mon('Tynamo', { dex: 602, cp: 214, hp: 41, xxl: true, ivs: { a: 13, d: 11, s: 12 } }),	// same groups
		mon('Tynamo', { dex: 602, cp: 214, hp: 41, xxl: true, ivs: { a: 15, d: 11, s: 12 } }),
		mon('Joltik', { dex: 595, cp: 88, hp: 31, xxs: true, ivs: { a: 0, d: 5, s: 6 } }),
		mon('Pidove', { dex: 519, cp: 312, hp: 70, ivs: null, caught: null }),
	];
	const fits = e => list.filter(compileSearch(gameSearch(e)));
	for (const e of list) assert.ok(fits(e).includes(e), `${gameSearch(e)} finds its own row`);
	assert.equal(fits(list[0]).length, 1);	// the year tells the Tornadus apart
	assert.equal(fits(list[2]).length, 2);	// twins in the same IV groups: both
	assert.equal(fits(list[4]).length, 1);
});
