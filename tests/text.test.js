import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactText, caughtPatterns, matchCaught, nameIndex, findDex, normalizeName, levenshtein } from '../src/core/text.js';
import { syntheticText } from './synthetic.js';

const en = compactText(syntheticText('en'));
const de = compactText(syntheticText('de'));

test('compacts names, templates and labels', () => {
	assert.equal(en.names['9001'], 'Testmon');
	assert.equal(en.names['1'], 'Filler1mon');
	assert.equal(Object.keys(en.caught).length, 4);
	assert.equal(de.hp, 'KP');
	assert.throws(() => compactText({ data: ['a', 'b'] }), /format changed/);
});

test('info line: all four variants, English', () => {
	const p = caughtPatterns(en);
	assert.deepEqual(matchCaught('Attack This Testmon was caught on 7/28/2024 around Somewhere, Some Region.', p),
		{ species: 'Testmon', caught: '7/28/2024' });
	assert.deepEqual(matchCaught('This Mr. Fake was caught on 10/16/2026', p), { species: 'Mr. Fake', caught: '10/16/2026' });
	assert.deepEqual(matchCaught('This Fakeon was caught around Elsewhere.', p), { species: 'Fakeon', caught: null });
	assert.deepEqual(matchCaught('xx This Fakeon was caught', p), { species: 'Fakeon', caught: null });
	assert.deepEqual(matchCaught('nothing here', p), { species: null, caught: null });
});

test('info line, German', () => {
	const p = caughtPatterns(de);
	assert.deepEqual(matchCaught('Dieses Testmon wurde am 28.07.2024 in der Nähe von Irgendwo gefangen.', p),
		{ species: 'Testmon', caught: '28.07.2024' });
	assert.deepEqual(matchCaught('Dieses Fakeon wurde gefangen.', p), { species: 'Fakeon', caught: null });
});

test('species names: exact, normalised, fuzzy, unsure', () => {
	const idx = nameIndex(en);
	assert.equal(findDex('Testmon', idx), 9001);
	assert.equal(findDex('MR FAKE', idx), 9003);
	assert.equal(findDex('Mr.Fake', idx), 9003);
	assert.equal(findDex('Tcstmon', idx), 9001, 'one OCR slip');
	assert.equal(findDex('Xyzzyplugh', idx), null);
	assert.equal(findDex('', idx), null);
	assert.equal(normalizeName('Nidoran♀'), 'nidoran♀');
	assert.equal(levenshtein('kitten', 'sitting'), 3);
});
