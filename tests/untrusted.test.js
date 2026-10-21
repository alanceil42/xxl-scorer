// Rows that came from outside (a backup anyone could have edited) or from an older version of
// the page: none of them may break the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactGameMaster } from '../src/core/gm.js';
import { compactText } from '../src/core/text.js';
import { makeContext, evaluate, evaluateSafely } from '../src/core/evaluate.js';
import { cleanRow } from '../src/core/backup.js';
import { needsCheck } from '../src/core/search.js';
import { syntheticGameMaster, syntheticText } from './synthetic.js';

const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
const ctx = makeContext(gm, compactText(syntheticText('en')));
const reading = { species: 'Testmon', caught: '7/28/2024', hp: 120, cp: 1900, height_m: 1.7, weight_kg: 30, types: [] };

test('a backup with "constructor" as species id: imported without it, the species from the reading', () => {
	const backup = { app: 'xxl-scorer', v: 1, rows: [{ id: 'c', updated: 1, reading, edits: { id: 'constructor', cp: 1900 } }] };
	const r = cleanRow(JSON.parse(JSON.stringify(backup)).rows[0]);
	assert.deepEqual(r.edits, { cp: 1900 });
	const e = evaluate(r.reading, ctx, r.edits);
	assert.equal(e.id, 'TESTMON');
});

test('a species id every object has is no species, even where cleanRow did not run', () => {
	for (const id of ['constructor', '__proto__', 'toString']) {
		const e = evaluate(reading, ctx, { id });
		assert.equal(e.id, null, id);
		assert.ok(e.issues.some(i => i.code === 'species'), id);
	}
});

test('a row evaluate() can\'t handle is marked to check, not thrown', () => {
	// types as a string, as a version or a hand-edited backup may have stored it
	const bad = { ...reading, types: 'ROCK' };
	assert.throws(() => evaluate(bad, ctx));
	const e = evaluateSafely(bad, ctx);
	assert.equal(e.name, 'Testmon');
	assert.equal(e.score, null);
	assert.equal(e.key, null, 'no duplicate key: it is never taken for another row');
	assert.deepEqual(e.issues.map(i => i.code), ['broken']);
	assert.match(e.issues[0].msg, /can't be scored/);
	assert.ok(needsCheck(e), 'marked to check');
	// game data an older version stored, without forms
	const odd = makeContext({ ...gm, species: { ...gm.species, TESTMON: { dex: 9001 } } }, ctx.text);
	assert.deepEqual(evaluateSafely(reading, odd).issues.map(i => i.code), ['broken']);
	assert.deepEqual(evaluateSafely({ species: 7 }, ctx).issues.map(i => i.code), ['species'], 'what evaluate() handles stays as it was');
});

test('evaluateSafely gives what evaluate gives for a good row', () => {
	assert.deepEqual(evaluateSafely(reading, ctx, { inGame: 1100 }), evaluate(reading, ctx, { inGame: 1100 }));
});
