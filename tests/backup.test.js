// Backup files are untrusted input: known fields and types only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRow, cleanSettings, safeThumb } from '../src/core/backup.js';

const good = {
	id: 'a1', created: 1, updated: 2, scanned: 2, scanIdx: 4, file: 'IMG_1.PNG', thumb: 'data:image/jpeg;base64,/9j/AAAA',
	reading: { species: 'Gastly', caught: '7/26/2024', hp: 61, cp: 372, cpAlt: [777], weight_kg: 0.17, height_m: 2.13,
		types: ['GHOST', 'POISON'], bars: { a: 7, d: 5, s: 11 }, badge: 'XXL', lucky: false, name: 'XX961', caughtPill: '2024 07/26' },
	edits: { ivs: { a: 7, d: 5, s: 11 }, inGame: 961, xxl: true },
};

test("a row of the page's own export passes unchanged", () => {
	assert.deepEqual(cleanRow(good), good);
});

test('thumbnails: embedded images only, no URLs', () => {
	assert.equal(safeThumb('https://example.com/pixel.gif'), undefined);
	assert.equal(safeThumb('data:image/svg+xml;base64,PHN2Zz4='), undefined);
	assert.equal(safeThumb('data:image/png;base64,iVBOR"onerror="x'), undefined);
	assert.equal(cleanRow({ ...good, thumb: '//tracker.example/x.gif' }).thumb, undefined);
});

test('thumbnails: JPEG bytes only, whatever the label says', () => {
	assert.equal(safeThumb('data:image/jpeg;base64,/9j/4AAQSkZJRg=='), 'data:image/jpeg;base64,/9j/4AAQSkZJRg==');
	// the browser decodes what the bytes are: a GIF, BMP or PNG under a JPEG label too
	for (const b64 of ['R0lGODlhAQABAAAAACw=', 'Qk0eAAAAAAAAABoAAAA=', 'iVBORw0KGgo=', 'AAAA']) {
		assert.equal(safeThumb(`data:image/jpeg;base64,${b64}`), undefined, b64);
	}
	// the page has stored JPEG only from the start
	assert.equal(safeThumb('data:image/png;base64,iVBORw0KGgo='), undefined);
	assert.equal(safeThumb('data:image/webp;base64,UklGRg=='), undefined);
});

test('unknown fields dropped, wrong types dropped, not-a-row refused', () => {
	const r = cleanRow({ ...good, evil: 1, reading: { ...good.reading, hp: '61', types: ['GHOST', '<b>', 'X'], __proto__x: 1, extra: {} }, edits: { ivs: { a: 16, d: 0, s: 0 }, cp: -5 } });
	assert.equal(r.evil, undefined);
	assert.equal(r.reading.hp, undefined);
	assert.deepEqual(r.reading.types, ['GHOST']);
	assert.equal(r.reading.extra, undefined);
	assert.deepEqual(r.edits, {});
	assert.equal(cleanRow({ id: 'x' }), null);
	assert.equal(cleanRow(null), null);
	assert.equal(cleanRow([1]), null);
	assert.equal(cleanRow({ id: 5, reading: {} }), null);
	assert.deepEqual(cleanRow({ id: 'y', reading: {} }).reading, { types: [] });
});

test('scan time: the place in a batch only with the batch', () => {
	assert.equal(cleanRow({ ...good, scanned: undefined }).scanIdx, undefined);
	assert.equal(cleanRow({ ...good, scanIdx: -1 }).scanIdx, undefined);
	assert.equal(cleanRow({ ...good, scanIdx: 1.5 }).scanIdx, undefined);
	assert.equal(cleanRow({ ...good, scanned: 'yesterday' }).scanned, undefined);
});

test('values left empty (null) by the page stay empty', () => {
	const reading = { species: null, caught: null, caughtPill: null, name: null, hp: null, cp: null, weight_kg: null, height_m: null, bars: null, badge: null, lucky: null };
	assert.deepEqual(cleanRow({ id: 'n', reading }).reading, { ...reading, types: [] });
});

test('reading details: merged count, time taken, other CP readings, fractional bars', () => {
	const r = cleanRow({ id: 'm', reading: { merged: 3, ms: 850, covered: true, cpAlt: [1990, 'x', -4, 4790], bars: { a: 14.85, d: 12.99, s: 15 } } }).reading;
	assert.equal(r.merged, 3);
	assert.equal(r.ms, 850);
	assert.equal(r.covered, true);
	assert.deepEqual(r.cpAlt, [1990, 4790], 'only CPs');
	assert.deepEqual(r.bars, { a: 14.85, d: 12.99, s: 15 }, 'as measured');
	const bad = cleanRow({ id: 'm', reading: { merged: 0, ms: -1, cpAlt: Array(21).fill(100), bars: 'full', types: 'ROCK', lucky: 'yes' } }).reading;
	assert.deepEqual(bad, { types: [] });
	assert.equal(cleanRow({ id: 'm', reading: { cpAlt: 1990 } }).reading.cpAlt, undefined);
});

test('edits: IVs whole numbers only; strings and numbers within bounds', () => {
	const e = cleanRow({ id: 'e', reading: {}, edits: { id: 'TESTMON', form: '', hp: 120, cp: 1900, height_m: 1.62, weight_kg: 30.12, caught: '7/28/2024', ivs: { a: 15, d: 13, s: 15 } } }).edits;
	assert.deepEqual(e, { id: 'TESTMON', form: '', hp: 120, cp: 1900, height_m: 1.62, weight_kg: 30.12, caught: '7/28/2024', ivs: { a: 15, d: 13, s: 15 } });
	const bad = cleanRow({ id: 'e', reading: {}, edits: { id: 'X'.repeat(61), hp: 0, height_m: 1001, ivs: { a: 14.5, d: 13, s: 15 }, inGame: Infinity } }).edits;
	assert.deepEqual(bad, {});
	assert.deepEqual(cleanRow({ id: 'e', reading: {}, edits: 'all' }).edits, {}, 'edits not an object');
});

test('long strings dropped: names, file names, ids, thumbnails over 200 KB', () => {
	const r = cleanRow({ id: 'l', file: 'x'.repeat(256), reading: { species: 'S'.repeat(61), name: 'N'.repeat(60) } });
	assert.equal(r.file, undefined);
	assert.equal(r.reading.species, undefined);
	assert.equal(r.reading.name, 'N'.repeat(60), 'at the limit: kept');
	assert.equal(cleanRow({ id: 'i'.repeat(65), reading: {} }), null);
	assert.equal(safeThumb(`data:image/jpeg;base64,${'A'.repeat(200_000)}`), undefined);
});

test('edits: a species id only in the game data\'s form, never a name every object has', () => {
	for (const id of ['MR_MIME', 'PORYGON2', 'HO_OH']) assert.equal(cleanRow({ id: 'e', reading: {}, edits: { id } }).edits.id, id);
	for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'testmon', 'MR MIME', ''])
		assert.equal(cleanRow({ id: 'e', reading: {}, edits: { id } }).edits.id, undefined, JSON.stringify(id));
});

test('times after now are taken as now', () => {
	const now = 1_800_000_000_000;
	const r = cleanRow({ ...good, created: 1, updated: now + 1, scanned: 8e15 }, now);
	assert.equal(r.created, 1, 'earlier times as they are');
	assert.equal(r.updated, now);
	assert.equal(r.scanned, now);
	assert.equal(r.scanIdx, good.scanIdx, 'the place in the batch stays');
	const later = cleanRow({ ...good, updated: Date.now() + 365 * 86400e3 });
	assert.ok(later.updated <= Date.now(), 'now by default');
});

test('settings: the "Name to copy" template with the time it was set', () => {
	const s = { nameTemplate: 'XX{score}{iv:sup}', nameTemplateAt: 1_700_000_000_000 };
	assert.deepEqual(cleanSettings(s), s);
	// a backup without the time: taken as older than any set since, newer than never set (-1)
	assert.deepEqual(cleanSettings({ nameTemplate: ' XX{score} ' }), { nameTemplate: 'XX{score}', nameTemplateAt: 0 });
	// set in the future: now, or it would win every import for good
	assert.equal(cleanSettings({ nameTemplate: 'X', nameTemplateAt: 8e15 }, 5).nameTemplateAt, 5);
	assert.equal(cleanSettings({ nameTemplate: 'X', nameTemplateAt: 8e15 }, 5).nameTemplate, 'X');
});

test('settings: anything else is dropped', () => {
	for (const s of [undefined, null, 'XX', [], {}, { nameTemplate: '' }, { nameTemplate: '   ' }, { nameTemplate: 42 },
		{ nameTemplate: 'x'.repeat(501) }, { nameTemplate: ['XX'] }]) {
		assert.deepEqual(cleanSettings(s), {}, JSON.stringify(s));
	}
	assert.deepEqual(cleanSettings({ nameTemplate: 'XX', nameTemplateAt: 'soon', mode: 'xxs', evil: 1 }), { nameTemplate: 'XX', nameTemplateAt: 0 });
});
