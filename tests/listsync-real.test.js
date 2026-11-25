// List sync on real list screenshots. Skipped unless XXL_FIXTURES is set (see fixtures.test.js
// for the engine; XXL_OCR_CACHE as there). A folder with a sync.json holds one sync:
//
//   { "about": "...", "backup": "backup.json", "count": 120,
//     "expect": { "gone": 7, "evolved": 1, "unsure": 0, "new": 0 }, "other": true }
//
// "other": screenshots of another search, from which a sync must mark nothing gone. Each set is
// also synced shuffled (the same marks) and with every name taken away (CP alone: no row
// marked gone that the named sync saw).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compactGameMaster } from '../src/core/gm.js';
import { compactText } from '../src/core/text.js';
import { makeContext, evaluate } from '../src/core/evaluate.js';
import { cleanRow } from '../src/core/backup.js';
import { runSync, markCounts } from '../src/core/listsync.js';
import { listEngines, readShots, tessdata } from './lib/listshots.js';
import { IMAGE } from './lib/sets.js';

const dir = process.env.XXL_FIXTURES;
let skip = false;
if (!dir) skip = 'XXL_FIXTURES not set';
else if (!existsSync(join(tessdata, 'eng.traineddata.gz'))) skip = 'run tools/vendor.sh first';

/** Folders with a sync.json, below dir. */
function syncSets(top, rel = '') {
	const here = join(top, rel);
	const names = readdirSync(here).filter(n => !n.startsWith('.'));
	if (names.includes('sync.json')) return [rel];
	return names.filter(n => !IMAGE.test(n) && existsSync(join(here, n)) && !n.includes('.')).flatMap(n => syncSets(top, rel ? `${rel}/${n}` : n));
}

test('list sync on real screenshots', { skip, timeout: 3_600_000 }, async t => {
	let Tesseract;
	try { Tesseract = await import('tesseract.js'); } catch { t.skip('tesseract.js not installed (see fixtures.test.js)'); return; }
	const ctx = makeContext(compactGameMaster(JSON.parse(readFileSync(join(dir, 'latest.json'), 'utf8'))),
		compactText(JSON.parse(readFileSync(join(dir, 'i18n_english.json'), 'utf8'))));
	const sets = syncSets(dir);
	const { engines, done } = await listEngines(Tesseract);
	const read = new Map();
	try {
		for (const rel of sets) {
			const files = readdirSync(join(dir, rel)).filter(n => IMAGE.test(n)).sort().map(n => join(dir, rel, n));
			read.set(rel, await readShots(files, engines));
		}
	} finally { await done(); }
	const fallback = sets.map(rel => JSON.parse(readFileSync(join(dir, rel, 'sync.json'), 'utf8'))).find(s => s.backup && !s.other);
	for (const rel of sets) {
		await t.test(rel, () => {
			const sync = JSON.parse(readFileSync(join(dir, rel, 'sync.json'), 'utf8'));
			const backupAt = sync.backup ? join(dir, rel, sync.backup) : null;
			const backup = backupAt ? JSON.parse(readFileSync(backupAt, 'utf8')) : { rows: [] };
			const items = backup.rows.map(r => cleanRow(r)).filter(Boolean).map(row => ({ row, e: evaluate(row.reading, ctx, row.edits) }));
			const shots = [...read.get(rel).values()];
			const res = runSync(shots, items, ctx, { now: 0 });
			const n = markCounts(res.marks);
			t.diagnostic(`${rel}: ${res.shots} shots (${res.other} other), ${res.read} read of ${res.count}, matched ${res.matched}, gone ${n.gone}, evolved ${n.evolved}, not sure ${n.unsure}, new ${res.newCps.length}${res.why ? `; ${res.why}` : ''}`);
			if (sync.other) { assert.equal(n.gone, 0, 'another search marks nothing gone'); return; }
			if (sync.count != null) { assert.equal(res.count, sync.count); assert.equal(res.read, sync.count); assert.ok(res.complete, res.why); }
			if (sync.expect) assert.deepEqual({ gone: n.gone, evolved: n.evolved, unsure: n.unsure, new: res.newCps.length }, sync.expect);
			// any order: the same marks
			const rev = runSync([...shots].reverse(), items, ctx, { now: 0 });
			const mid = runSync([...shots.slice(7), ...shots.slice(0, 7)], items, ctx, { now: 0 });
			assert.deepEqual(rev.marks, res.marks, 'reversed');
			assert.deepEqual(mid.marks, res.marks, 'rotated');
			// CP alone: nothing gone that the names saw
			const bare = shots.map(s => ({ ...s, rows: s.rows.map(r => ({ ...r, slots: r.slots.map(x => (typeof x === 'object' ? { ...x, p: null, name: null } : x)) })) }));
			const cpOnly = runSync(bare, items, ctx, { now: 0 });
			const wrong = Object.entries(cpOnly.marks).filter(([id, m]) => m.k === 'gone' && res.marks[id]?.k !== 'gone');
			assert.deepEqual(wrong, [], 'CP alone marks a row gone the names saw');
		});
	}
	assert.ok(fallback || !sets.length, 'a sync set with a backup');
});
