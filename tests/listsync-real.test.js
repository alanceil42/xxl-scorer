// List sync on real list screenshots. Skipped unless XXL_FIXTURES is set (see fixtures.test.js
// for the engine; XXL_OCR_CACHE as there). A folder with a sync.json holds one sync:
//
//   { "about": "...", "backup": "backup.json", "count": 120,
//     "expect": { "gone": 7, "evolved": 1, "unsure": 0, "new": 0 }, "other": true,
//     "level": [{ "row": id, "levels": [24.5, 25], "cp": 1251, "level": 25 }] }
//
// "other": screenshots of another search, from which a sync must mark nothing gone. Each set is
// also synced reversed, rotated and shuffled (the same marks), with every name taken away (CP
// alone: no row marked gone that the named sync saw), and with three seen rows taken out of the
// backup (their tiles new).
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
			// rows whose level the HP alone leaves open ("level": [{row, levels, cp, level}])
			for (const l of sync.level || []) {
				const it = items.find(x => x.row.id === l.row);
				assert.deepEqual(it.e.levels, l.levels, `${l.species} levels`);
				assert.equal(evaluate(it.row.reading, ctx, { ...it.row.edits, cp: l.cp }).level, l.level, `${l.species} with CP ${l.cp}`);
			}
			if (sync.other) { assert.equal(n.gone, 0, 'another search marks nothing gone'); return; }
			if (sync.count != null) { assert.equal(res.count, sync.count); assert.equal(res.read, sync.count); assert.ok(res.complete, res.why); }
			if (sync.expect) assert.deepEqual({ gone: n.gone, evolved: n.evolved, unsure: n.unsure, new: res.newCps.length }, sync.expect);
			// any order: the same marks
			const rev = runSync([...shots].reverse(), items, ctx, { now: 0 });
			const mid = runSync([...shots.slice(7), ...shots.slice(0, 7)], items, ctx, { now: 0 });
			assert.deepEqual(rev.marks, res.marks, 'reversed');
			assert.deepEqual(mid.marks, res.marks, 'rotated');
			// shuffled (a fixed seed, so a failure repeats)
			let seed = 7;
			const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
			const mixed = [...shots];
			for (let i = mixed.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [mixed[i], mixed[j]] = [mixed[j], mixed[i]]; }
			assert.deepEqual(runSync(mixed, items, ctx, { now: 0 }).marks, res.marks, 'shuffled');
			// CP alone: nothing gone that the names saw
			const bare = shots.map(s => ({ ...s, rows: s.rows.map(r => ({ ...r, slots: r.slots.map(x => (typeof x === 'object' ? { ...x, p: null, name: null } : x)) })) }));
			const cpOnly = runSync(bare, items, ctx, { now: 0 });
			const wrong = Object.entries(cpOnly.marks).filter(([id, m]) => m.k === 'gone' && res.marks[id]?.k !== 'gone');
			assert.deepEqual(wrong, [], 'CP alone marks a row gone the names saw');
			// one CP not read (as a phone's reading had it): no row gone the whole list didn't
			// have, and where nothing is, the screenshot named
			for (const k of [0, Math.floor(shots.length / 2)]) {
				const s = shots[k];
				const r = s.rows.findIndex(x => x.slots.some(t => typeof t === 'object' && t.cp != null));
				if (r < 0) continue;
				const c = s.rows[r].slots.findIndex(t => typeof t === 'object' && t.cp != null);
				const lost = shots.map((x, i) => (i !== k ? x : { ...x, file: `shot ${k}`, rows: x.rows.map((y, j) => (j !== r ? y : { ...y, slots: y.slots.map((t, m) => (m === c ? { ...t, cp: null } : t)) })) }));
				const one = runSync(lost, items, ctx, { now: 0 });
				const extra = Object.entries(one.marks).filter(([id, m]) => m.k === 'gone' && res.marks[id]?.k !== 'gone');
				assert.deepEqual(extra, [], `a CP lost on shot ${k}: no new gone`);
				if (!one.complete && one.why.includes('CP')) assert.match(one.why, new RegExp(`shot ${k}`), 'the screenshot named');
			}
			// new: rows taken out of the backup (seen, a CP no other row has) leave their tiles new
			const cpCount = new Map();
			for (const x of items) cpCount.set(x.e.cp, (cpCount.get(x.e.cp) || 0) + 1);
			const out = items.filter(x => x.e.cp != null && cpCount.get(x.e.cp) === 1 && !res.marks[x.row.id]).slice(0, 3);
			const less = runSync(shots, items.filter(x => !out.includes(x)), ctx, { now: 0 });
			const cps = out.map(x => x.e.cp).sort((a, b) => a - b);
			assert.deepEqual([...less.newCps].sort((a, b) => a - b), cps, 'their tiles new');
			assert.equal(less.newSearch, `xxl&${cps.map(c => `cp${c}`).join(',')}`);
			assert.deepEqual(less.marks, res.marks, 'the rest as before');
		});
	}
	assert.ok(fallback || !sets.length, 'a sync set with a backup');
});
