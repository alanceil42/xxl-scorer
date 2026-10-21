// The parts of src/ui that run without a page: how many engines to start and where they come
// from, how often to ask for new game data, the help drawing, ids and storage persistence.
// Browser objects (navigator, matchMedia, document, Tesseract) are stood in for, one test at a
// time. The DOM code in app.js is not tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poolSize, getWorkers, getWorker } from '../src/ui/ocr.js';
import { checkInterval, DEFAULT_CHECK_DAYS } from '../src/ui/gamedata.js';
import { phoneSvg } from '../src/ui/help.js';
import { newId, askPersist } from '../src/ui/db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 24 * 3600 * 1000;

/** Run fn with these globals in place, then put the old ones back. */
async function withGlobals(globals, fn) {
	const old = Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
	for (const [k, v] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
	try {
		return await fn();
	} finally {
		for (const [k, d] of old) {
			if (d) Object.defineProperty(globalThis, k, d);
			else delete globalThis[k];
		}
	}
}

const device = (cores, touch) => ({
	navigator: { hardwareConcurrency: cores },
	matchMedia: q => ({ matches: touch && q === '(pointer: coarse)' }),
});

test('engines at once: all cores but one on a computer, at most 8; two on a touch device', async () => {
	const cases = [
		[12, false, 8], [4, false, 3], [2, false, 1], [1, false, 1], [undefined, false, 1],
		[6, true, 2], [1, true, 1], [undefined, true, 2],
	];
	for (const [cores, touch, want] of cases) {
		await withGlobals(device(cores, touch), () => assert.equal(poolSize(0), want, `${cores} cores, touch ${touch}`));
	}
});

test('engines at once: config.json "ocrWorkers" wins, whole numbers up to 16; 0 or less is automatic', async () => {
	await withGlobals(device(12, false), () => {
		assert.equal(poolSize(3), 3);
		assert.equal(poolSize(2.7), 2);
		assert.equal(poolSize(40), 16);
		assert.equal(poolSize(0), 8);
		assert.equal(poolSize(-1), 8);
		assert.equal(poolSize(undefined), 8);
	});
});

test('engines: from the site itself (vendor/), the first alone, kept for reuse, failed ones retried', async () => {
	const log = [];
	let started = 0;
	let fail = 0;	// how many of the next createWorker calls fail
	const Tesseract = {
		async createWorker(lang, oem, opts) {
			const n = ++started;
			log.push(`start ${n}`);
			await null;
			if (fail > 0) { fail--; log.push(`fail ${n}`); throw new Error(`worker ${n} failed`); }
			log.push(`end ${n}`);
			return { n, lang, oem, opts };
		},
	};
	await withGlobals({ Tesseract, document: { baseURI: 'https://xxl.example.org/xxl/' } }, async () => {
		// the very first one fails (no network for the model): an error, and nothing kept
		fail = 1;
		await assert.rejects(getWorkers(2, 'eng'), /worker 1 failed/);
		assert.deepEqual(log, ['start 1', 'fail 1'], 'the first one alone: the others would fetch the model again');

		log.length = 0;
		started = 0;
		const ws = await getWorkers(3, 'eng');
		assert.deepEqual(ws.map(w => w.n), [1, 2, 3]);
		assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'start 3', 'end 2', 'end 3'], 'then the rest in parallel');
		const { lang, oem, opts } = ws[0];
		assert.equal(lang, 'eng');
		assert.equal(oem, 1, 'LSTM engine only');
		assert.equal(opts.workerPath, 'https://xxl.example.org/xxl/vendor/tesseract/worker.min.js');
		assert.equal(opts.corePath, 'https://xxl.example.org/xxl/vendor/tesseract/core/');
		assert.equal(opts.langPath, 'https://xxl.example.org/xxl/vendor/tessdata');
		assert.equal(opts.gzip, true);
		assert.equal(opts.workerBlobURL, false);

		log.length = 0;
		assert.deepEqual((await getWorkers(2)).map(w => w.n), [1, 2], 'reused');
		assert.equal(await getWorker(), ws[0]);
		assert.deepEqual(log, [], 'nothing new started');

		// two more wanted, one of them fails: the ones that work are used, the failed one is
		// dropped and started again next time
		fail = 1;
		assert.deepEqual((await getWorkers(5)).map(w => w.n), [1, 2, 3, 5]);
		assert.deepEqual((await getWorkers(5)).map(w => w.n), [1, 2, 3, 5, 6]);
	});
});

test('game data: asked for again after "gmCheckDays", 7 by default', () => {
	assert.equal(DEFAULT_CHECK_DAYS, 7);
	assert.equal(checkInterval({}), 7 * DAY);
	assert.equal(checkInterval({ gmCheckDays: 3 }), 3 * DAY);
	assert.equal(checkInterval({ gmCheckDays: '14' }), 14 * DAY);
	assert.equal(checkInterval({ gmCheckDays: 0.5 }), DAY / 2);
	for (const bad of [0, -2, 'weekly', null, Infinity]) assert.equal(checkInterval({ gmCheckDays: bad }), 7 * DAY, String(bad));
});

test('help drawing: two phones, what each screenshot gives marked, nothing fetched', () => {
	const css = readFileSync(join(root, 'app.css'), 'utf8');
	const appraisal = phoneSvg('appraisal'), plain = phoneSvg('plain');
	for (const svg of [appraisal, plain]) {
		assert.match(svg, /^<svg class="hf" viewBox="0 0 200 420" role="img" aria-label="[^"<>]+">.*<\/svg>$/s);
		for (const tag of ['svg', 'text', 'tspan']) {
			assert.equal(svg.split(`<${tag}`).length, svg.split(`</${tag}>`).length, `<${tag}> closed`);
		}
		// drawn shapes only: no picture and no other file referenced (CSP, no game art)
		assert.doesNotMatch(svg, /<image|href=|url\(|https?:/);
		for (const cls of new Set([...svg.matchAll(/class="([^"]+)"/g)].map(m => m[1]))) {
			assert.match(css, new RegExp(`\\.${cls}(?![\\w-])`), `.${cls} styled in app.css (light and dark)`);
		}
	}
	const marks = svg => [...svg.matchAll(/class="hf-num-t"[^>]*>(\d)</g)].map(m => m[1]);
	assert.deepEqual(marks(appraisal), ['1', '2'], 'bars and the "was caught" line');
	assert.deepEqual(marks(plain), ['1'], 'the stats row');
	assert.match(appraisal, /aria-label="[^"]*three bars \(1\)[^"]*caught \(2\)/);
	assert.match(plain, /aria-label="[^"]*weight and height \(1\)/);
	for (const label of ['Attack', 'Defense', 'HP']) assert.ok(appraisal.includes(`>${label}</text>`), label);
	assert.ok(appraisal.includes('was caught on'));
	assert.ok(!plain.includes('class="hf-bar"'), 'no bars without the appraisal');
	assert.ok(!plain.includes('was caught'));
	assert.equal(phoneSvg('anything else'), plain);
});

test('row ids: random UUIDs, with a fallback where the browser has none', async () => {
	const a = newId(), b = newId();
	assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	assert.notEqual(a, b);
	await withGlobals({ crypto: {} }, () => {
		const c = newId(), d = newId();
		assert.match(c, /^[0-9a-z]{10,}$/);
		assert.notEqual(c, d);
	});
});

test('storage: persistence asked for once, its answer returned, never an error', async () => {
	const storage = granted => {
		const s = { asked: 0, async persisted() { return granted; }, async persist() { s.asked++; granted = true; return true; } };
		return s;
	};
	const no = storage(false);
	assert.equal(await withGlobals({ navigator: { storage: no } }, askPersist), true);
	assert.equal(no.asked, 1);
	const yes = storage(true);
	assert.equal(await withGlobals({ navigator: { storage: yes } }, askPersist), true);
	assert.equal(yes.asked, 0, 'already persistent: not asked again');
	const refused = { async persisted() { return false; }, async persist() { return false; } };
	assert.equal(await withGlobals({ navigator: { storage: refused } }, askPersist), false);
	assert.equal(await withGlobals({ navigator: {} }, askPersist), false, 'no storage API');
	const broken = { async persisted() { throw new Error('SecurityError'); } };
	assert.equal(await withGlobals({ navigator: { storage: broken } }, askPersist), false);
});
