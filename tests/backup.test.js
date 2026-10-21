// Backup files are untrusted input: known fields and types only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanRow, safeThumb } from '../src/core/backup.js';

const good = {
	id: 'a1', created: 1, updated: 2, scanned: 2, scanIdx: 4, file: 'IMG_1.PNG', thumb: 'data:image/jpeg;base64,/9j/AAAA',
	reading: { species: 'Gastly', caught: '7/26/2024', hp: 61, cp: 372, cpAlt: [777], weight_kg: 0.17, height_m: 2.13,
		types: ['GHOST', 'POISON'], bars: { a: 7, d: 5, s: 11 }, badge: 'XXL', slid: false, lucky: false, name: 'XX961', caughtPill: '2024 07/26' },
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
