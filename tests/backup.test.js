// Backup files are untrusted input: known fields and types only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRow, cleanSettings, safeThumb, backupFileName, notInFile, filedAfterImport } from '../src/core/backup.js';

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

test('settings: the backup file name, with its own time, next to the template or alone', () => {
	const s = { nameTemplate: 'XX', nameTemplateAt: 3, fileName: 'TalimeeZero', fileNameAt: 4 };
	assert.deepEqual(cleanSettings(s), s);
	assert.deepEqual(cleanSettings({ fileName: ' TalimeeOne ' }), { fileName: 'TalimeeOne', fileNameAt: 0 });
	assert.equal(cleanSettings({ fileName: 'X', fileNameAt: 8e15 }, 5).fileNameAt, 5);
	// one bad setting doesn't take the other with it
	assert.deepEqual(cleanSettings({ nameTemplate: 'XX', nameTemplateAt: 3, fileName: 'x'.repeat(101) }), { nameTemplate: 'XX', nameTemplateAt: 3 });
	assert.deepEqual(cleanSettings({ nameTemplate: '', fileName: 'T', fileNameAt: 2 }), { fileName: 'T', fileNameAt: 2 });
	for (const f of ['', '  ', 42, ['T'], null]) assert.deepEqual(cleanSettings({ fileName: f }), {}, JSON.stringify(f));
});

test('backup file name: {date} is the local date, .json added once, unsafe characters replaced', () => {
	const d = new Date(2026, 9, 29, 23, 59);	// local time: a backup before midnight is that day's
	assert.equal(backupFileName(undefined, d), 'xxl-scorer-2026-10-29.json');
	assert.equal(backupFileName('', d), 'xxl-scorer-2026-10-29.json');
	assert.equal(backupFileName('xxl-scorer-{date}', d), 'xxl-scorer-2026-10-29.json');
	assert.equal(backupFileName('TalimeeZero', d), 'TalimeeZero.json');
	assert.equal(backupFileName(' TalimeeZero.JSON ', d), 'TalimeeZero.json');
	assert.equal(backupFileName('{date} TalimeeOne {date}', d), '2026-10-29 TalimeeOne 2026-10-29.json');
	assert.equal(backupFileName('a/b\\c:d*e?f"g<h>i|j\u0000k\nl', d), 'a-b-c-d-e-f-g-h-i-j-k-l.json');
	assert.equal(backupFileName('Pokémon ⓿㉚', d), 'Pokémon ⓿㉚.json');
	// hidden (leading dot) or nothing left: the default
	assert.equal(backupFileName('.hidden', d), 'hidden.json');
	assert.equal(backupFileName('...', d), 'xxl-scorer-2026-10-29.json');
	assert.equal(backupFileName('.json', d), 'xxl-scorer-2026-10-29.json');
	assert.equal(backupFileName('x'.repeat(300), d), `${'x'.repeat(100)}.json`);
	assert.equal(backupFileName(42, d), 'xxl-scorer-2026-10-29.json');
});

test('not in a file: what came after the last export, unless an import brought that version', () => {
	const state = { rows: [{ id: 'a', updated: 5 }, { id: 'b', updated: 20 }, { id: 'c', updated: 30 }, { id: 'd' }], nameTemplateAt: 25, fileNameAt: -1 };
	// exported at 10: b, c and the template since
	let out = notInFile(state, 10, null);
	assert.deepEqual(out.rows.map(r => r.id), ['b', 'c']);
	assert.equal(out.settings, 1);
	// never exported, all of it imported at these times (a restore into a fresh browser): nothing
	const all = { rows: new Map([['a', 5], ['b', 20], ['c', 30], ['d', 0]]), nameTemplateAt: 25 };
	out = notInFile(state, 0, all);
	assert.deepEqual(out.rows, []);
	assert.equal(out.settings, 0);
	// changed here after the import: that row and the template again
	out = notInFile({ ...state, rows: [...state.rows.slice(0, 2), { id: 'c', updated: 31 }], nameTemplateAt: 26 }, 0, all);
	assert.deepEqual(out.rows.map(r => r.id), ['c']);
	assert.equal(out.settings, 1);
	// a file with an older version of a row here doesn't count for the newer one
	out = notInFile(state, 10, { rows: new Map([['b', 20], ['c', 29]]) });
	assert.deepEqual(out.rows.map(r => r.id), ['c']);
	// an id the file named oddly is just an id
	out = notInFile({ rows: [{ id: '__proto__', updated: 3 }, { id: 'constructor', updated: 3 }], nameTemplateAt: -1, fileNameAt: -1 }, 0, null);
	assert.equal(out.rows.length, 2);
});

test('after an import: the file\'s times, the later of old and new, for rows still here', () => {
	const old = { rows: new Map([['a', 5], ['gone', 9], ['b', 30]]), nameTemplateAt: 7 };
	const out = filedAfterImport(old, new Map([['b', 20], ['c', 40], ['__proto__', 2]]),
		{ nameTemplate: 'X{score}', nameTemplateAt: 3, fileName: 'Zero', fileNameAt: 12 }, ['a', 'b', 'c', '__proto__']);
	assert.deepEqual([...out.rows], [['a', 5], ['b', 30], ['c', 40], ['__proto__', 2]]);
	assert.equal(out.nameTemplateAt, 7);
	assert.equal(out.fileNameAt, 12);
	// no settings in the file, nothing before: no times for them
	const bare = filedAfterImport(null, new Map([['a', 1]]), {}, ['a']);
	assert.deepEqual(bare, { rows: new Map([['a', 1]]) });
	// it fits what notInFile reads
	assert.deepEqual(notInFile({ rows: [{ id: '__proto__', updated: 2 }], nameTemplateAt: 3, fileNameAt: 12 }, 0, out), { rows: [], settings: 0 });
});
