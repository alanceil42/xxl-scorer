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
	assert.equal(formatName('{lvl:circ}', { lvl: 20.5 }).text, '20.5', 'half levels fall back to digits');
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
