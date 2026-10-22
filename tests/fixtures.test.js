// Local screenshot tests. Skipped unless XXL_FIXTURES is set.
//
//   # the Node build, at the vendored versions; no install scripts, which run as you
//   npm install --no-save --ignore-scripts \
//       tesseract.js@$(tools/vendor.sh --version tesseract.js) \
//       tesseract.js-core@$(tools/vendor.sh --version tesseract.js-core)
//   tools/vendor.sh                              # once; provides vendor/tessdata
//   XXL_FIXTURES=/path/to/fixtures npm test
//
// The fixtures folder holds screenshots plus expected.json, and optionally latest.json and
// i18n_english.json (otherwise they are downloaded from PokeMiners). expected.json:
//   { "fixtures": [{ "file": "a.png", "truth": { "species", "cp", "hp", "height_m", "weight_kg",
//                    "xxl", "caught" }, "ivs": [a, d, s], "level", "score", "in_game_score" }, …],
//     "batches": [ see below ] }
//
// expected.json may also list batches: a folder of screenshots added in one go, as when swiping
// through the storage, and the Pokémon they should puzzle into:
//   "batches": [{ "dir": "dump", "rows": [{ "files": [1, 24, 25], "species": "Geodude",
//                 "cp": 967, "ivs": [8, 0, 15], "xxl": true }, …] }]
// Files are numbered in name order (natural sort, so "2 of 45" before "10 of 45"), from 1;
// with "numbers": "name", by the first number in their name instead ("Library - 26 of 566.png"
// is 26), so a folder thinned out to the interesting screenshots keeps its numbering.
// A row may leave out species, cp, ivs, xxl or xxs; files are always compared. The rows may
// come in any order. "dir" may be a subfolder ("diversity/team_blue").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactGameMaster, GM_URL } from '../src/core/gm.js';
import { compactText, textUrl, findDex } from '../src/core/text.js';
import { makeRules } from '../src/core/read.js';
import { makeContext, evaluate, mergeTarget, mergeReadings } from '../src/core/evaluate.js';
import { tesseractEngine, readScreenshot } from '../src/core/pipeline.js';
import { pam } from '../src/core/image.js';
import { decodePng } from './lib/png.js';

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
	const worker = await Tesseract.createWorker('eng', 1, { langPath: tessdata, gzip: true, cacheMethod: 'none' });
	// the crops as the page hands them over: raw pixels
	const engine = tesseractEngine(worker, pam);
	const { fixtures, batches = [] } = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
	try {
		for (const f of fixtures) {
			await t.test(f.file, async () => {
				const buf = readFileSync(join(dir, f.file));
				const img = decodePng(buf);
				const r = await readScreenshot(img, buf, engine, rules);
				const tr = f.truth;
				t.diagnostic(`${f.file}: ${r.ms} ms ${JSON.stringify({ ...r, ms: undefined })}`);
				assert.equal(findDex(r.species, ctx.names), findDex(tr.species, ctx.names), 'species');
				if (tr.caught) assert.equal(r.caught, tr.caught, 'catch date');
				// compare what the page uses: readings after size repair and CP correction
				const e = evaluate(r, ctx);
				assert.equal(e.hp, tr.hp, 'hp');
				assert.equal(e.cp, tr.cp, 'cp');
				assert.equal(e.height_m, tr.height_m, 'height');
				assert.equal(e.weight_kg, tr.weight_kg, 'weight');
				assert.deepEqual([e.ivs.a, e.ivs.d, e.ivs.s], f.ivs, 'IVs');
				assert.equal(e.xxl, tr.xxl, 'XXL');
				assert.ok(Math.abs(e.score.total - f.score.total) < 0.05, `score ${e.score.total} vs ${f.score.total}`);
				if (f.in_game_score != null) {
					assert.ok(Math.abs(e.score.total - f.in_game_score) <= e.score.band + 0.5, 'in-game score outside ± band');
				}
			});
		}
		for (const b of batches) {
			await t.test(`batch ${b.dir}`, async () => {
				const names = readdirSync(join(dir, b.dir)).filter(n => /\.(png|jpe?g)$/i.test(n))
					.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }));
				const rows = [];	// { reading, files }, as the page's addFiles builds them
				const numOf = (n, i) => (b.numbers === 'name' ? Number(n.match(/\d+/)[0]) : i + 1);
				for (let i = 0; i < names.length; i++) {
					const buf = readFileSync(join(dir, b.dir, names[i]));
					const r = await readScreenshot(decodePng(buf), buf, engine, rules);
					const no = numOf(names[i], i);
					const k = mergeTarget(rows.map(x => x.reading), r, ctx);
					if (k >= 0) {
						rows[k].reading = mergeReadings(rows[k].reading, r, ctx);
						rows[k].files.push(no);
					} else rows.push({ reading: r, files: [no] });
				}
				const got = rows.map(x => {
					const e = evaluate(x.reading, ctx);
					return { files: x.files, species: e.name, cp: e.cp, ivs: e.ivs && [e.ivs.a, e.ivs.d, e.ivs.s], xxl: e.xxl, xxs: e.xxs };
				});
				for (const g of got) t.diagnostic(JSON.stringify(g));
				assert.equal(b.skip, undefined, 'nothing is skipped any more: list each screenshot in a row');
				const keyOf = files => files.slice().sort((x, y) => x - y).join('+');
				const byFiles = new Map(got.map(g => [keyOf(g.files), g]));
				const missing = b.rows.filter(w => !byFiles.has(keyOf(w.files))).map(w => keyOf(w.files));
				const extra = got.filter(g => !b.rows.some(w => keyOf(w.files) === keyOf(g.files))).map(g => keyOf(g.files));
				assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, 'rows (files merged per Pokémon)');
				for (const w of b.rows) {
					const g = byFiles.get(keyOf(w.files));
					for (const k of ['species', 'cp', 'ivs', 'xxl', 'xxs']) if (k in w) assert.deepEqual(g[k], w[k], `${keyOf(w.files)}: ${k}`);
				}
			});
		}
	} finally {
		await worker.terminate();
	}
});
