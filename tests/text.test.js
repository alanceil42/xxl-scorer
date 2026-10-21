import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactText, caughtPatterns, matchCaught, nameIndex, findDex, findDexByName, normalizeName, levenshtein, textUrl } from '../src/core/text.js';
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

/** The synthetic English table without the keys in `drop`, with `pairs` added (a later key wins). */
function table(pairs, drop = []) {
	const d = syntheticText('en').data;
	const out = [];
	for (let i = 0; i < d.length; i += 2) if (!drop.includes(d[i])) out.push(d[i], d[i + 1]);
	for (const [k, v] of pairs) out.push(k, v);
	return { data: out };
}

test('text table: labels default to English, nameless entries skipped, not a table refused', () => {
	const t = compactText(table([['pokemon_name_0121', '']], ['general_hp', 'general_kg', 'general_m']));
	assert.deepEqual([t.hp, t.kg, t.m], ['HP', 'kg', 'm']);
	assert.equal(t.names['121'], undefined);
	assert.throws(() => compactText({ data: 'x' }), /expected \{data/);
	assert.throws(() => compactText(null), /expected \{data/);
	assert.throws(() => compactText(table([], ['appraise_v2_caught'])), /caught line missing/);
});

test('info line: only the variants the language has; a template ending with the species', () => {
	const t = compactText(table([['appraise_v2_dateless_uncached_loc', 'Caught: {0}']], ['appraise_v2_date_uncached_loc', 'appraise_v2_dateless_caught']));
	const p = caughtPatterns(t);
	assert.deepEqual(p.map(x => x.key), ['appraise_v2_caught', 'appraise_v2_dateless_uncached_loc']);
	assert.deepEqual(matchCaught('Caught: Testmon Attack Defense', p), { species: 'Testmon', caught: null }, 'the name ends at the next word');
	assert.deepEqual(matchCaught('This Testmon was caught on 7/28/2024, around X', p), { species: 'Testmon', caught: '7/28/2024' }, 'punctuation after the date');
});

test('species names: short names allow one slip, a slip that fits several is unsure', () => {
	const idx = nameIndex(compactText(table([['pokemon_name_0200', 'Muk']])));
	assert.equal(findDex('Mak', idx), 200);
	assert.equal(findDex('Mzz', idx), null, 'two slips in a short name');
	assert.equal(findDex('Filler1Xmon', idx), null, 'one slip from Filler10mon … Filler19mon alike');
	assert.equal(findDex(null, idx), null);
	assert.equal(normalizeName(undefined), '');
});

test('name line: one character off counts only from 6 letters, and only for one name', () => {
	const idx = nameIndex(en);
	assert.equal(findDexByName('Fakon', idx), null, 'one slip in a 5-letter name: a nickname');
	assert.equal(findDexByName('Xx', idx), null, 'too short to be anything');
	assert.equal(findDexByName('Filler1Xmon', idx), null, 'one slip from several names');
	assert.equal(findDexByName('Testmonxx', idx), null, 'two characters off');
});

test('text table URL: by language name, PokeMiners on GitHub', () => {
	assert.equal(textUrl('en'), 'https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Texts/Latest%20APK/JSON/i18n_english.json');
	assert.match(textUrl('de'), /\/i18n_german\.json$/);
	assert.match(textUrl('french'), /\/i18n_french\.json$/, 'an unlisted language as its file name part');
});
