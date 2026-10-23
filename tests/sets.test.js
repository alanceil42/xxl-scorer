// The local screenshot tests' plumbing, without screenshots: finding sets, numbering files,
// comparing rows with truth.json, and the cache of the engine's answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findSets, fileNumber, compareRows } from './lib/sets.js';
import { openCache, engineId } from './lib/ocrcache.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'xxl-sets-'));

test('sets: every folder with screenshots or a truth.json, nested, in natural order', () => {
	const top = tmp();
	try {
		for (const d of ['phone-b/swipe', 'phone-b/notes', 'phone-a/set-2', 'phone-a/set-10', 'empty/inner', '.hidden']) mkdirSync(join(top, d), { recursive: true });
		writeFileSync(join(top, 'latest.json'), '{}');
		writeFileSync(join(top, 'phone-b/swipe/IMG_1234.PNG'), '');
		writeFileSync(join(top, 'phone-b/notes/truth.json'), '{"read":false}');
		writeFileSync(join(top, 'phone-a/set-2/a.jpg'), '');
		writeFileSync(join(top, 'phone-a/set-10/b.png'), '');
		writeFileSync(join(top, '.hidden/c.png'), '');
		assert.deepEqual(findSets(top), ['phone-a/set-2', 'phone-a/set-10', 'phone-b/notes', 'phone-b/swipe']);
	} finally { rmSync(top, { recursive: true }); }
});

test('files go by the first number in their name', () => {
	assert.equal(fileNumber('Library - 26 of 80.png'), 26);
	assert.equal(fileNumber('IMG_1234.PNG'), 1234);
	assert.equal(fileNumber('b07.png'), 7);
	assert.equal(fileNumber('gastly.png'), null);
});

test('rows: missing, extra, loose screenshots alone, fields that differ', () => {
	const want = [
		{ files: [1, 2], species: 'Testmon', cp: 835, ivs: [9, 4, 13] },
		{ files: [3, 4], species: 'Othermon' },
	];
	const ok = [{ files: [2, 1], species: 'Testmon', cp: 835, ivs: [9, 4, 13] }, { files: [3, 4], species: 'Othermon', cp: 410 }];
	assert.deepEqual(compareRows(ok, want), { missing: [], extra: [], fields: [] });
	// a loose screenshot (no Pokémon) in a row of its own is fine, in a Pokémon's row it is not
	assert.deepEqual(compareRows([...ok, { files: [5] }], want, [5]).extra, []);
	assert.deepEqual(compareRows([ok[0], { files: [3, 4, 5], species: 'Othermon' }], want, [5]),
		{ missing: ['3+4'], extra: ['3+4+5'], fields: [] });
	assert.deepEqual(compareRows([{ ...ok[0], cp: 35 }, ok[1]], want).fields, ['1+2: cp 35, expected 835']);
	assert.deepEqual(compareRows([ok[0], { files: [3] }, { files: [4] }], want), { missing: ['3+4'], extra: ['3', '4'], fields: [] });
});

test('cache: asks the engine once per input and reading, keeps the answers in a file per engine', async () => {
	const dir = tmp();
	try {
		let asked = 0;
		const engine = { words: async () => { asked++; return [{ text: 'CP', bbox: {} }]; }, line: async (img, wl) => { asked++; return `${wl}:${img.data[0]}`; } };
		const img = v => ({ width: 2, height: 1, data: new Uint8ClampedArray([v, 0, 0, 255, 0, 0, 0, 255]) });
		const id = engineId('tesseract.js 7.0.0', 'model');
		const c = openCache(dir, id);
		const e = c.wrap(engine);
		assert.equal(await e.line(img(1), '0123'), '0123:1');
		assert.equal(await e.line(img(1), '0123'), '0123:1');
		assert.equal(asked, 1);
		await e.line(img(2), '0123');	// other pixels
		await e.line(img(1), '01');	// another whitelist
		await e.line(img(1), '0123', '6');	// another page mode
		assert.equal(asked, 4);
		await e.words(Buffer.from('png bytes'));
		await e.words(Buffer.from('png bytes'));
		assert.equal(asked, 5);
		assert.deepEqual(c.stats, { hits: 2, misses: 5, file: join(dir, `ocr-${id}.json`) });
		c.save();
		// a second run with the same engine: nothing asked; another engine: its own file
		const again = openCache(dir, id).wrap(engine);
		assert.equal(await again.line(img(2), '0123'), '0123:2');
		assert.equal(asked, 5);
		assert.notEqual(engineId('tesseract.js 7.0.1', 'model'), id);
		openCache(dir, engineId('tesseract.js 7.0.1', 'model')).save();
		assert.deepEqual(readdirSync(dir), [`ocr-${id}.json`]);
	} finally { rmSync(dir, { recursive: true }); }
});
