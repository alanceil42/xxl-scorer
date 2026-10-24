import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileSearch, parseRange } from '../src/core/search.js';

const mon = (name, o = {}) => ({ name, formName: '', dex: 1, types: 'NORMAL', cp: 500, hp: 80, xxl: false,
	ivs: { a: 10, d: 10, s: 10 }, caught: '10/10/2026', score: { total: 600 }, ...o });
const list = [
	mon('Geodude', { dex: 74, types: 'ROCK/GROUND', cp: 967, hp: 97, xxl: true, ivs: { a: 8, d: 0, s: 15 }, caught: '05/25/2024', score: { total: 1106.3 } }),
	mon('Geodude', { dex: 74, formName: 'Alola', types: 'ROCK/ELECTRIC', cp: 713 }),
	mon('Cranidos', { dex: 408, types: 'ROCK', cp: 1335, hp: 123, ivs: { a: 15, d: 15, s: 15 } }),
	mon('Flabébé', { dex: 669, types: 'FAIRY', cp: 300, ivs: null, score: null }),
	mon('Tornadus', { dex: 641, types: 'FLYING', cp: 1900, xxl: true, ivs: { a: 15, d: 13, s: 15 } }),
];
const find = q => list.filter(compileSearch(q)).map(e => `${e.name}${e.formName ? ' ' + e.formName : ''}`);

test('ranges', () => {
	assert.deepEqual(parseRange('25'), [25, 25]);
	assert.deepEqual(parseRange('10-20'), [10, 20]);
	assert.deepEqual(parseRange('-30'), [-Infinity, 30]);
	assert.deepEqual(parseRange('40-'), [40, Infinity]);
	assert.deepEqual(parseRange('1100.5-'), [1100.5, Infinity]);
	assert.equal(parseRange('abc'), null);
	assert.equal(parseRange('-'), null);
});

test('empty search shows everything', () => {
	assert.equal(compileSearch(''), null);
	assert.equal(compileSearch('  , & '), null);
});

test('free text: name or form, case and accents ignored', () => {
	assert.deepEqual(find('geo'), ['Geodude', 'Geodude Alola']);
	assert.deepEqual(find('ALOLA'), ['Geodude Alola']);
	assert.deepEqual(find('flabebe'), ['Flabébé']);
	assert.deepEqual(find('geo alola'), ['Geodude Alola'], 'space = and');
});

test('game syntax: cp, hp, dex, xxl, types, stars, stats, year, score', () => {
	assert.deepEqual(find('cp713'), ['Geodude Alola']);
	assert.deepEqual(find('cp1000-'), ['Cranidos', 'Tornadus']);
	assert.deepEqual(find('cp-400'), ['Flabébé']);
	assert.deepEqual(find('hp97'), ['Geodude']);
	assert.deepEqual(find('74'), ['Geodude', 'Geodude Alola']);
	assert.deepEqual(find('400-700'), ['Cranidos', 'Flabébé', 'Tornadus']);
	assert.deepEqual(find('xxl'), ['Geodude', 'Tornadus']);
	assert.deepEqual(find('!xxl'), ['Geodude Alola', 'Cranidos', 'Flabébé']);
	assert.deepEqual(find('ground'), ['Geodude']);
	assert.deepEqual(find('rock&!ground'), ['Geodude Alola', 'Cranidos']);
	assert.deepEqual(find('4*'), ['Cranidos']);
	assert.deepEqual(find('3-4*'), ['Cranidos', 'Tornadus']);
	assert.deepEqual(find('1*'), ['Geodude'], '8+0+15 = 23');
	assert.deepEqual(find('0defense'), ['Geodude']);
	assert.deepEqual(find('4attack&4hp'), ['Cranidos', 'Tornadus']);
	assert.deepEqual(find('3defense'), ['Tornadus']);
	assert.deepEqual(find('year2024'), ['Geodude']);
	assert.deepEqual(find('score1100-'), ['Geodude']);
});

test('operators: , ; : or, binding tighter than & and |', () => {
	assert.deepEqual(find('fairy,flying'), ['Flabébé', 'Tornadus']);
	assert.deepEqual(find('fairy;flying&xxl'), ['Tornadus']);
	assert.deepEqual(find('ground : flying | xxl'), ['Geodude', 'Tornadus']);
	assert.deepEqual(find('cranidos, tornadus & 4attack & !xxl'), ['Cranidos']);
	assert.deepEqual(find('nothing-like-this'), []);
	assert.equal(compileSearch('!'), null, 'a lone ! is ignored');
});

test('check: rows with an issue to look at, notes don\'t count', () => {
	const p = compileSearch('check');
	assert.equal(p({ issues: [{ code: 'cp', msg: 'x' }] }), true);
	assert.equal(p({ issues: [{ code: 'merged', info: true, msg: 'x' }] }), false);
	assert.equal(compileSearch('!check')({ issues: [] }), true);
});

test('xxs and lucky (XXS mode; lucky read from the card)', () => {
	const more = [...list, mon('Zubat', { dex: 41, types: 'POISON/FLYING', cp: 155, xxs: true, lucky: true }), mon('Onix', { dex: 95, xxs: true })];
	const q = s => more.filter(compileSearch(s)).map(e => e.name);
	assert.deepEqual(q('xxs'), ['Zubat', 'Onix']);
	assert.deepEqual(q('lucky'), ['Zubat']);
	assert.deepEqual(q('xxs&!lucky'), ['Onix']);
	assert.deepEqual(q('xxl,xxs').length, 4);
});

test('score search: an entered in-game score counts instead of the computed one', () => {
	const e = mon('Meditite', { score: { total: 1115.5 }, inGame: 1112 });
	assert.equal(compileSearch('score1113-')(e), false);
	assert.equal(compileSearch('score1110-1112')(e), true);
});
