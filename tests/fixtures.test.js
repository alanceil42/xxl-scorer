// Local screenshot tests. Skipped unless XXL_FIXTURES is set.
//
//   # the Node build, at the vendored versions; no install scripts, which run as you
//   npm install --no-save --ignore-scripts \
//       tesseract.js@$(tools/vendor.sh --version tesseract.js) \
//       tesseract.js-core@$(tools/vendor.sh --version tesseract.js-core)
//   XXL_FIXTURES=/path/to/fixtures npm test
//
// The fixtures folder holds sets: folders of screenshots, nested as you like
// (phone-a/swipe-1/). Optionally latest.json and i18n_english.json at the top
// (otherwise they are downloaded from PokeMiners). Each set may have a truth.json:
//
//   { "note": "where the screenshots come from, what was checked",
//     "screenshots": [{ "file": "a.png", "truth": { "species", "cp", "hp", "height_m",
//                       "weight_kg", "xxl", "caught" }, "ivs": [a, d, s], "score": { "total" },
//                       "in_game_score" }, …],
//     "rows": [{ "files": [1, 24, 25], "species": "Geodude", "cp": 967, "ivs": [8, 0, 15],
//                "xxl": true }, …],
//     "loose": [7, 12],
//     "draft": true,
//     "read": false }
//
// "screenshots" are read one by one and compared field by field. "rows" is the whole folder
// added in one go, as when swiping through the storage, and the Pokémon it should puzzle into.
// Files are numbered by the first number in their name ("Library - 26 of 80.png" is 26,
// "IMG_1234.PNG" 1234); a row may leave out species, cp, ivs, xxl or xxs, the files are always
// compared. "loose": screenshots of no Pokémon (an appraisal intro); they may end up in rows of
// their own, never in a Pokémon's. "draft": truth not checked by eye yet; differences are
// reported, not failed. "read": false: not screenshots of the game (notes); skipped.
// A set without truth.json is read and its rows reported, as a start for one.
//
// More switches:
//   XXL_OCR_CACHE=<folder>   keep the engine's answers there (tests/lib/ocrcache.js): a run
//                            after a change to reading asks the engine only about what changed
//   XXL_RESULTS=<file.json>  write every set's readings and rows there, to compare two
//                            versions (or to start a truth.json from)
//   XXL_SETS=<text>          only the sets whose path contains it ("phone-a/")
//   XXL_WORKERS=<n>          engines reading in parallel (default 2)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactGameMaster, GM_URL } from '../src/core/gm.js';
import { compactText, textUrl, findDex } from '../src/core/text.js';
import { makeRules } from '../src/core/read.js';
import { makeContext, evaluate, mergeTarget, mergeReadings } from '../src/core/evaluate.js';
import { tesseractEngine, readScreenshot } from '../src/core/pipeline.js';
import { pam } from '../src/core/image.js';
import { decodePng } from './lib/png.js';
import { openCache, engineId } from './lib/ocrcache.js';
import { IMAGE, findSets, fileNumber, compareRows } from './lib/sets.js';

const dir = process.env.XXL_FIXTURES;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tessdata = join(root, 'vendor/tessdata');

async function load(file, url) {
	const p = join(dir, file);
	if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
	const r = await fetch(url);
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
	return r.json();
}

let skip = false;
if (!dir) skip = 'XXL_FIXTURES not set';
else if (!existsSync(join(tessdata, 'eng.traineddata.gz'))) skip = 'run tools/vendor.sh first';

test('screenshots read and score as expected', { skip, timeout: 3_600_000 }, async t => {
	let Tesseract;
	try { Tesseract = await import('tesseract.js'); } catch {
		t.skip('npm install --no-save --ignore-scripts tesseract.js@$(tools/vendor.sh --version tesseract.js) tesseract.js-core@$(tools/vendor.sh --version tesseract.js-core)');
		return;
	}
	const gm = compactGameMaster(await load('latest.json', GM_URL));
	const text = compactText(await load('i18n_english.json', textUrl('en')));
	const ctx = makeContext(gm, text);
	const rules = makeRules(text);
	const only = process.env.XXL_SETS;
	const sets = findSets(dir).filter(s => !only || s.includes(only)).map(rel => {
		const p = join(dir, ...rel.split('/'), 'truth.json');
		const truth = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
		const files = readdirSync(join(dir, ...rel.split('/'))).filter(n => IMAGE.test(n))
			.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
		return { rel, truth, files };
	}).filter(s => s.truth?.read !== false && s.files.length);

	// Read everything first, several engines at a time; the sets then only evaluate and merge.
	const version = p => JSON.parse(readFileSync(join(root, 'node_modules', p, 'package.json'), 'utf8')).version;
	const model = readFileSync(join(tessdata, 'eng.traineddata.gz'));
	// OEM 1 below and the adapter's source are part of the engine as much as the versions are
	const id = engineId(version('tesseract.js'), version('tesseract.js-core'), model, 'oem 1', tesseractEngine.toString());
	const workers = [];
	const engines = [];
	for (let i = 0; i < Math.max(1, Number(process.env.XXL_WORKERS) || 2); i++) {
		const worker = await Tesseract.createWorker('eng', 1, { langPath: tessdata, gzip: true, cacheMethod: 'none' });
		workers.push(worker);
		// the crops as the page hands them over: raw pixels
		engines.push(tesseractEngine(worker, pam));
	}
	const cacheDir = process.env.XXL_OCR_CACHE;
	const cache = cacheDir ? openCache(cacheDir, id) : null;
	const readings = new Map();	// "set/file" → reading
	const todo = sets.flatMap(s => s.files.map(f => `${s.rel}/${f}`.replace(/^\//, '')));
	let next = 0;
	const t0 = Date.now();
	try {
		await Promise.all(engines.map(async e => {
			const engine = cache ? cache.wrap(e) : e;
			while (next < todo.length) {
				const rel = todo[next++];
				const buf = readFileSync(join(dir, ...rel.split('/')));
				readings.set(rel, await readScreenshot(decodePng(buf), buf, engine, rules));
			}
		}));
	} finally {
		cache?.save();
		await Promise.all(workers.map(w => w.terminate()));
	}
	t.diagnostic(`${todo.length} screenshots in ${sets.length} sets read in ${((Date.now() - t0) / 1000).toFixed(0)} s` +
		(cache ? `; engine asked ${cache.stats.misses} times, cache answered ${cache.stats.hits} (${cache.stats.file})` : ''));

	const results = { engine: id, sets: {} };
	for (const s of sets) {
		const tr = s.truth || {};
		const at = f => readings.get(`${s.rel}/${f}`.replace(/^\//, ''));
		await t.test(s.rel || '.', async st => {
			const res = results.sets[s.rel] = { readings: {}, rows: [] };
			for (const f of s.files) { const { ms, ...r } = at(f); res.readings[f] = r; }
			const problems = [];
			for (const f of tr.screenshots || []) {
				const r = at(f.file);
				assert.ok(r, `${f.file}: not in the folder`);
				const want = f.truth;
				const e = evaluate(r, ctx);
				const check = (label, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) problems.push(`${f.file}: ${label} ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); };
				check('species', findDex(r.species, ctx.names), findDex(want.species, ctx.names));
				if (want.caught) check('catch date', r.caught, want.caught);
				// compare what the page uses: readings after size repair and CP correction
				for (const [k, label] of [['hp', 'hp'], ['cp', 'cp'], ['height_m', 'height'], ['weight_kg', 'weight'], ['xxl', 'XXL']]) check(label, e[k], want[k]);
				check('IVs', e.ivs && [e.ivs.a, e.ivs.d, e.ivs.s], f.ivs);
				if (f.score && !(Math.abs(e.score?.total - f.score.total) < 0.05)) problems.push(`${f.file}: score ${e.score?.total} vs ${f.score.total}`);
				if (f.in_game_score != null && !(Math.abs(e.score?.total - f.in_game_score) <= e.score?.band + 0.5)) problems.push(`${f.file}: in-game score outside ± band`);
			}
			if (tr.rows || !s.truth) {
				// the whole folder added in one go, as the page's addFiles builds the rows
				const rows = [];
				for (const f of s.files) {
					const r = at(f);
					const no = fileNumber(f);
					const k = mergeTarget(rows.map(x => x.reading), r, ctx);
					if (k >= 0) {
						rows[k].reading = mergeReadings(rows[k].reading, r, ctx);
						rows[k].files.push(no);
					} else rows.push({ reading: r, files: [no] });
				}
				res.rows = rows.map(x => {
					const e = evaluate(x.reading, ctx);
					return { files: x.files, species: e.name, cp: e.cp, ivs: e.ivs && [e.ivs.a, e.ivs.d, e.ivs.s], xxl: e.xxl, xxs: e.xxs,
						issues: (e.issues || []).filter(i => !i.info).map(i => i.code) };
				});
				if (tr.rows) {
					assert.ok(s.files.every(f => fileNumber(f) != null), 'with "rows", every file name needs a number');
					const c = compareRows(res.rows, tr.rows, tr.loose);
					for (const k of c.missing) problems.push(`row ${k} missing`);
					for (const k of c.extra) problems.push(`row ${k} should not be there`);
					problems.push(...c.fields);
				}
				if (!s.truth || problems.length) for (const g of res.rows) st.diagnostic(JSON.stringify(g));
			}
			for (const p of problems) st.diagnostic(p);
			if (tr.draft) { if (problems.length) st.diagnostic(`draft truth: ${problems.length} differences, not failed`); return; }
			assert.deepEqual(problems, [], `${s.rel}: ${problems.length} differences`);
		});
	}
	if (process.env.XXL_RESULTS) {
		writeFileSync(process.env.XXL_RESULTS, JSON.stringify(results, null, '\t') + '\n');
		t.diagnostic(`readings and rows written to ${process.env.XXL_RESULTS}`);
	}
});
