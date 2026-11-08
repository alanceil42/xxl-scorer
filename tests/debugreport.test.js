// The debug report: state, never pictures; a short error log; the ticked rows or all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessage, addEntry, cleanLog, scrub, makeReport, pickRows, reportFileName, LOG_MAX, MESSAGE_MAX } from '../src/core/debugreport.js';

const row = (id, extra = {}) => ({
	id, file: `IMG_${id}.PNG`, thumb: 'data:image/jpeg;base64,/9j/AAAA',
	reading: { species: 'Gastly', cp: 372, height_m: 2.13 }, edits: {}, ...extra,
});

test('no data: URL survives anywhere in the report, whatever the field', () => {
	const r = makeReport({
		app: 'xxl-scorer',
		drop: ['thumb'],
		sections: {
			rows: { list: [row('a'), row('b', { reading: { species: 'Gastly', sprite: 'data:image/png;base64,iVBOR' } })] },
			settings: { picture: '  DATA:text/html,<b>x</b>', nested: [[{ deep: 'data:image/gif;base64,R0lG' }]] },
		},
		errors: [{ at: 1, source: 'error', message: 'decode failed: data:image/jpeg;base64,/9j/AAAA' }],
	});
	const text = JSON.stringify(r);
	assert.doesNotMatch(text, /\bdata:/i);
	assert.equal(r.errors[0].message, 'decode failed: [data URL]');
	assert.equal(r.rows.list[0].thumb, undefined, 'thumbnails are dropped, not just replaced');
	assert.equal(r.rows.list[1].reading.sprite, '[data URL removed]');
	assert.equal(r.settings.picture, '[data URL removed]');
});

test('the report says what it is, its format version and when it was made', () => {
	const now = new Date('2026-11-08T14:00:00Z');
	const r = makeReport({ app: 'catch-triage', now, build: { commit: 'abc1234' } });
	assert.equal(r.app, 'catch-triage');
	assert.equal(r.kind, 'debug-report');
	assert.equal(r.v, 1);
	assert.equal(r.made, '2026-11-08T14:00:00.000Z');
	assert.deepEqual(r.build, { commit: 'abc1234' });
	assert.deepEqual(r.errors, []);
});

test('scrub: JSON-safe copy; Sets, Maps, cycles, functions, NaN', () => {
	const cyc = { a: 1 };
	cyc.self = cyc;
	const out = scrub({ s: new Set(['x']), m: new Map([['k', 1]]), f: () => 1, u: undefined, n: NaN, cyc, long: 'x'.repeat(3000) });
	assert.deepEqual(out.s, ['x']);
	assert.deepEqual(out.m, { k: 1 });
	assert.equal('f' in out, false);
	assert.equal('u' in out, false);
	assert.equal(out.n, 'NaN');
	assert.equal(out.cyc.self, '[cycle]');
	assert.equal(out.long.length, 2001);
	assert.doesNotThrow(() => JSON.stringify(out));
});

test('scrub: an object shared by two fields is copied into both (not a cycle)', () => {
	const bars = { a: 9.93, d: 14.93, s: 13.94 };
	const out = scrub({ reading: { bars }, shown: { bars, list: [bars, bars] } });
	assert.deepEqual(out.shown.bars, bars);
	assert.deepEqual(out.shown.list, [bars, bars]);
	assert.deepEqual(out.reading.bars, bars);
});

test('error messages: one line, no data: URLs, cut short', () => {
	assert.equal(cleanMessage('a\n  b\tc'), 'a b c');
	assert.equal(cleanMessage('bad image data:image/png;base64,iVBORw0KGgo= here'), 'bad image [data URL] here');
	assert.equal(cleanMessage('x'.repeat(500)).length, MESSAGE_MAX);
	assert.equal(cleanMessage('in "data:image/svg+xml,<svg>"'), 'in "[data URL]"');
	assert.equal(cleanMessage('gamedata: fine, metadata:x stays'), 'gamedata: fine, metadata:x stays');
	assert.equal(cleanMessage(undefined), '');
	assert.equal(cleanMessage({ toString: () => 'obj' }), 'obj');
});

test(`the log keeps the newest ${LOG_MAX}; a repeat within a second counts once`, () => {
	let log = [];
	for (let i = 0; i < LOG_MAX + 10; i++) log = addEntry(log, 'error', `e${i}`, 1000 * i);
	assert.equal(log.length, LOG_MAX);
	assert.equal(log[0].message, 'e10');
	assert.equal(log.at(-1).message, `e${LOG_MAX + 9}`);
	let rep = addEntry([], 'error', 'loop', 0);
	rep = addEntry(rep, 'error', 'loop', 300);
	rep = addEntry(rep, 'error', 'loop', 600);
	assert.deepEqual(rep, [{ at: 600, source: 'error', message: 'loop', n: 3 }]);
	rep = addEntry(rep, 'error', 'loop', 5000);
	assert.equal(rep.length, 2);
});

test('a stored log is untrusted: entries of the right shape only', () => {
	assert.deepEqual(cleanLog('nope'), []);
	assert.deepEqual(cleanLog([null, 1, { at: 'x', source: 'e', message: 'm' }, { at: 2, source: 'e', message: 'm' }]), [{ at: 2, source: 'e', message: 'm' }]);
	const long = Array.from({ length: 80 }, (_, i) => ({ at: i, source: 'e', message: String(i) }));
	assert.equal(cleanLog(long).length, LOG_MAX);
	assert.equal(cleanLog(long)[0].message, '30');
});

test('rows: the ticked ones, or all when none is ticked', () => {
	const rows = [row('a'), row('b'), row('c')];
	assert.deepEqual(pickRows(rows, new Set(['b'])), { included: 'ticked', total: 3, list: [rows[1]] });
	assert.deepEqual(pickRows(rows, new Set()), { included: 'all', total: 3, list: rows });
	assert.deepEqual(pickRows(rows, []).included, 'all');
});

test('file name: app, "debug", the local date', () => {
	assert.equal(reportFileName('xxl-scorer', new Date(2026, 0, 5, 23, 59)), 'xxl-scorer-debug-2026-01-05.json');
});
