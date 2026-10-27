import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatName, nameValues, circled, darkCircled, DEFAULT_TEMPLATE } from '../src/core/nickname.js';

const e = { name: 'Testmon', ivs: { a: 14, d: 2, s: 11 }, level: 29, xxl: true, score: { total: 1059.8 } };

test('default template: score, IV % superscript, attack IV dark circle, level circle', () => {
	assert.equal(formatName(DEFAULT_TEMPLATE, nameValues(e)).text, 'XX1060⁶⁰⓮㉙');
	// the Charmander from the first iPhone test: 0/0/8, level 30, 1063.5 → the game shows 1063
	const c = { name: 'Charmander', ivs: { a: 0, d: 0, s: 8 }, level: 30, xxl: true, score: { total: 1063.4 } };
	const r = formatName(DEFAULT_TEMPLATE, nameValues(c));
	assert.equal(r.text, 'XX1063¹⁸⓿㉚');
	assert.equal(r.length, 10);
	assert.equal(formatName('XX{score}', nameValues(e)).text, 'XX1060');
});

test('an entered in-game score replaces the computed one', () => {
	assert.equal(formatName('XX{score}', nameValues({ ...e, inGame: 1057 })).text, 'XX1057');
	assert.equal(formatName('XX{score}', nameValues({ ...e, score: null, inGame: 1057 })).text, 'XX1057');
	assert.equal(formatName('XX{score}', nameValues({ ...e, inGame: null })).text, 'XX1060');
});

test('IVs not known: the top of the score range, an in-game score still first', () => {
	const range = { ...e, score: { total: 1040, lo: 1021.2, hi: 1058.8, band: 19 } };
	assert.equal(formatName('XX{score}', nameValues(range)).text, 'XX1059');
	assert.equal(formatName('XX{score}', nameValues({ ...range, inGame: 1033 })).text, 'XX1033');
});

test('styles: superscript IV percent, circled level', () => {
	const r = formatName('XX{iv:sup}{lvl:circ}', nameValues(e));
	assert.equal(r.text, 'XX⁶⁰㉙');
	assert.equal(r.length, 5);
	assert.equal(r.tooLong, false);
});

test('circled numbers', () => {
	assert.equal(circled(0), '⓪');
	assert.equal(circled(7), '⑦');
	assert.equal(circled(20), '⑳');
	assert.equal(circled(21), '㉑');
	assert.equal(circled(35), '㉟');
	assert.equal(circled(36), '㊱');
	assert.equal(circled(50), '㊿');
	assert.equal(circled(20.5), null);
	assert.equal(darkCircled(0), '⓿');
	assert.equal(darkCircled(1), '❶');
	assert.equal(darkCircled(10), '❿');
	assert.equal(darkCircled(11), '⓫');
	assert.equal(darkCircled(15), '⓯');
	assert.equal(darkCircled(20), '⓴');
	assert.equal(darkCircled(21), null);
});

test('half levels: the whole part circled, then ½', () => {
	assert.equal(formatName('{lvl:circ}', { lvl: 20.5 }).text, '⑳½');
	assert.equal(formatName('{lvl:circ}', { lvl: 2.5 }).text, '②½');
	assert.equal(formatName('{lvl:circ}', { lvl: 49.5 }).text, '㊾½');
	assert.equal(formatName('{lvl:dcirc}', { lvl: 1.5 }).text, '❶½');
	assert.equal(formatName('{lvl:circ}', { lvl: 51 }).text, '51', 'out of range: digits');
	assert.equal(formatName('{lvl:circ}', { lvl: 50.5 }).text, '㊿½');
	assert.equal(formatName('{lvl:circ}', { lvl: 20.25 }).text, '20.25', 'not a half: digits');
	// 990 points, 40 %, attack 8, level 2.5
	const l = { ivs: { a: 8, d: 5, s: 5 }, level: 2.5, xxl: true, score: { total: 990.2 } };
	const r = formatName(DEFAULT_TEMPLATE, nameValues(l));
	assert.equal(r.text, 'XX990⁴⁰❽②½');
	assert.equal(r.length, 10);
	// a four-digit score with a half level still fits the game's 12
	const n = formatName(DEFAULT_TEMPLATE, nameValues({ ivs: { a: 15, d: 15, s: 15 }, level: 39.5, xxl: true, score: { total: 1145 } }));
	assert.equal(n.text, 'XX1145¹⁰⁰⓯㊴½');
	assert.equal(n.tooLong, false);
});

test('missing values, unknown keys, length limit', () => {
	const r = formatName('{score} {a}/{d}/{s}{xxl}', nameValues({ name: 'X', ivs: null, level: null, xxl: false, score: null }));
	assert.equal(r.text, '? ?/?/?');
	assert.deepEqual(r.missing, ['score', 'a', 'd', 's']);
	assert.equal(formatName('{nope}', {}).text, '{nope}');
	assert.equal(formatName('{name} {xxl} {score}', nameValues(e)).tooLong, true);
});

test('size placeholders may be empty', async () => {
	const { formatName } = await import('../src/core/nickname.js');
	assert.equal(formatName('{size}{score}', { score: 512, size: 'XXS' }).text, 'XXS512');
	const r = formatName('{xxs}{score}', { score: 512, xxs: '' });
	assert.equal(r.text, '512');
	assert.deepEqual(r.missing, []);
});

test('a placeholder every object has is no placeholder', async () => {
	const { formatName, nameValues } = await import('../src/core/nickname.js');
	const values = nameValues({ ivs: null, score: null, level: null, name: 'Testmon' });
	for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
		const r = formatName(`{${k}}{name}`, values);
		assert.equal(r.text, `{${k}}Testmon`, k);
		assert.deepEqual(r.missing, [], k);
	}
});
