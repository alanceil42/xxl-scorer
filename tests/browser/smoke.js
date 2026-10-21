// Smoke test of the page in a real browser: boot with synthetic game data, import a backup,
// the rows, sorting, search, the editor, select and delete, at a phone's width and a desktop's.
// Rows kept on screen from one drawing to the next show what they should after each of these.
// Rows that can't be scored, a hostile backup, a failed import, copying without the clipboard API.
// The text recognition engine reading a drawn image, under the page's CSP, loading only from the site.
// Fails on any Content-Security-Policy violation, any error in the console or the page, and
// any request to somewhere other than the site itself and PokeMiners on GitHub.
//
// Not part of npm test: it needs playwright-core and Chrome. CI installs playwright-core
// without saving it (no browser download) and uses the runner's Chrome. Locally:
//
//   npm install --no-save --ignore-scripts playwright-core@<version in .github/workflows/ci.yml>
//   node --test tests/browser/smoke.js                                # Google Chrome installed
//   XXL_CHROME=/path/to/chromium node --test tests/browser/smoke.js   # another Chromium
//
// No game art and no screenshots: the game data and the backup are made up (tests/synthetic.js).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { compactGameMaster } from '../../src/core/gm.js';
import { compactText } from '../../src/core/text.js';
import { makeContext, evaluate } from '../../src/core/evaluate.js';
import { sortList } from '../../src/core/sort.js';
import { compileSearch } from '../../src/core/search.js';
import { levelTable, cpOf, hpOf } from '../../src/core/ivs.js';
import { syntheticGameMaster, syntheticText, CPM } from '../synthetic.js';
import { encodePng } from '../lib/png.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PM = 'https://raw.githubusercontent.com/PokeMiners/';

// ---------- the site: the repository's files, plus a site's own settings and game data in local/ ----------

const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
const text = compactText(syntheticText('en'));
const LOCAL = {
	'/local/config.json': JSON.stringify({ gm: 'local/data/gm.json' }),
	'/local/data/gm.json': JSON.stringify({ ...gm, text: { en: text } }),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.gz': 'application/gzip' };

let server, base, browser;

before(async () => {
	server = createServer(async (req, res) => {
		const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		const file = normalize(join(root, path === '/' ? 'index.html' : path));
		try {
			if (!file.startsWith(root + sep) || path.split('/').some(p => p.startsWith('.'))) throw new Error('outside');
			const body = LOCAL[path] ?? await readFile(file);
			res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
			res.end(body);
		} catch {
			res.writeHead(404).end();
		}
	});
	await new Promise(r => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}/`;
	browser = await chromium.launch(process.env.XXL_CHROME ? { executablePath: process.env.XXL_CHROME } : { channel: 'chrome' });
});

after(async () => {
	await browser?.close();
	server?.close();
});

// ---------- a backup of three made-up Pokémon ----------

const ctx = makeContext(gm, text);
const shown = (row, ivs, level) => {
	const m = levelTable(CPM).find(x => x.level === level).m;
	return { cp: cpOf(row, ivs.a, ivs.d, ivs.s, m), hp: hpOf(row, ivs.s, m) };
};
const thumb = `data:image/png;base64,${encodePng({ width: 2, height: 2, data: new Uint8ClampedArray(16).fill(200) }).toString('base64')}`;
const mon = (id, species, sp, ivs, level, height_m, weight_kg, caught) => ({
	id, created: 1, updated: 1, scanned: 1, scanIdx: 0, file: `${id}.png`, thumb, edits: {},
	reading: { species, caught, ...shown(gm.species[sp].f[''], ivs, level), height_m, weight_kg, bars: ivs, types: [] },
});
const ROWS = [
	mon('tm', 'Testmon', 'TESTMON', { a: 15, d: 13, s: 15 }, 20, 1.7, 30, '7/28/2024'),
	mon('fk', 'Fakeon', 'FAKEON', { a: 1, d: 14, s: 11 }, 30, 0.6, 9, '6/20/2026'),
	mon('mf', 'Mr. Fake', 'MR_FAKE', { a: 10, d: 10, s: 10 }, 25, 1.4, 60, '10/16/2026'),
];
const BACKUP = JSON.stringify({ app: 'xxl-scorer', v: 1, exported: '2026-10-21T00:00:00Z', rows: ROWS });
const byScore = ROWS.map(r => ({ id: r.id, e: evaluate(r.reading, ctx, r.edits) })).sort((a, b) => b.e.score.total - a.e.score.total).map(x => x.id);

// ---------- the guards ----------

/** A page that records what must not happen: CSP violations, errors, requests elsewhere. */
async function open(width, opts = {}) {
	const context = await browser.newContext({ viewport: { width, height: 900 }, ...opts });
	const problems = [];
	const page = await context.newPage();
	// the event the browser fires for each CSP violation, so none goes unnoticed in the console
	await page.addInitScript(() => addEventListener('securitypolicyviolation', e =>
		console.error(`CSP violation: ${e.violatedDirective} blocked ${e.blockedURI}`)));
	page.on('console', m => {
		const csp = /Content.Security.Policy/i.test(m.text());
		// the engine writes Tesseract's own diagnostics (statistics of an empty page) to stderr,
		// which shows as console errors from its core file: not a fault of the page
		if (!csp && m.location().url.startsWith(`${base}vendor/tesseract/core/`)) return;
		if (m.type() === 'error' || csp) problems.push(`console: ${m.text()} @${m.location().url}`);
	});
	page.on('pageerror', err => problems.push(`page error: ${err.message}`));
	page.on('request', r => {
		const url = r.url();
		if (/^(data|blob):/.test(url)) return;	// not a request to anywhere
		if (!url.startsWith(base) && !url.startsWith(PM)) problems.push(`request: ${url}`);
	});
	page.on('dialog', d => d.accept());	// "Delete n Pokémon?"
	return { context, page, problems };
}

const ids = page => page.$$eval('#rows tr', trs => trs.map(t => t.dataset.id));
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function boot(page) {
	await page.goto(base);
	await page.waitForFunction(() => /species from/.test(document.querySelector('#gm-status').textContent));
}

for (const width of [402, 1280]) {
	test(`at ${width} px: boot, import, sort, search, edit, select and delete`, { timeout: 60_000 }, async () => {
		const { context, page, problems } = await open(width);
		try {
			await boot(page);
			assert.match(await page.textContent('#gm-status'), /^3 species from .*local\/data\/gm\.json/);
			assert.ok(await page.isVisible('#empty'), 'the empty list explains what to add');
			assert.equal(await page.locator('#empty svg.hf').count(), 2, 'with the two phone drawings');
			assert.ok(await noSideScroll(page), 'empty list: no sideways scrolling');

			// the help: the search terms first; the empty list's button opens it at the screenshots
			await page.click('#help-btn');
			assert.equal(await page.textContent('#help h3'), 'Searching the list');
			assert.equal(await page.evaluate(() => document.activeElement.id), 'help-title');
			await page.keyboard.press('Escape');
			await page.click('#empty [data-help]');
			assert.equal(await page.evaluate(() => document.activeElement.id), 'help-shots');
			assert.ok(await page.evaluate(() => document.querySelector('#help').scrollTop > 0), 'scrolled to it');
			await page.keyboard.press('Escape');

			// import a backup
			await page.click('#backup > summary');
			await page.setInputFiles('#import', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(BACKUP) });
			await page.waitForSelector('#rows tr >> nth=2');
			assert.match(await page.textContent('#banners'), /Imported: 3 new, 0 updated/);
			assert.deepEqual(await ids(page), byScore, 'by score, best first, as src/core scores them');
			assert.match(await page.textContent('tr[data-id="tm"] .c-name'), /Testmon.*XXL/);
			assert.ok(await page.isVisible('#search-wrap'));
			assert.ok(await noSideScroll(page), 'list: no sideways scrolling');
			// a phone shows cards, the column headers hidden; a desktop the table
			const header = await page.locator('#table thead').boundingBox();
			if (width < 680) assert.ok(header.width <= 1 && header.height <= 1, JSON.stringify(header));
			else assert.ok(header.width > 600, JSON.stringify(header));

			// sort: the menu everywhere, the column headers where they show; one state for both
			await page.click('#sort > summary');
			await page.click('#sort-items button:has-text("Name")');
			assert.deepEqual(await ids(page), ['fk', 'mf', 'tm'], 'A-Z');
			assert.match(await page.getAttribute('#sort > summary', 'aria-label'), /^Sort: Name, A–Z$/);
			if (width >= 680) {
				await page.click('th[data-sort="cp"]');
				assert.equal(await page.getAttribute('th[data-sort="cp"]', 'aria-sort'), 'descending');
				const cps = ROWS.map(r => [r.id, r.reading.cp]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
				assert.deepEqual(await ids(page), cps, 'CP, highest first');
				await page.click('#sort > summary');
				assert.equal(await page.getAttribute('#sort-items button:has-text("CP")', 'aria-pressed'), 'true', 'the menu shows the header\'s sort');
				await page.click('#sort > summary');
			}

			// search: names and the game's terms
			await page.fill('#search', 'fakeon');
			assert.deepEqual(await ids(page), ['fk']);
			assert.equal(await page.textContent('#search-count'), '1 of 3');
			await page.fill('#search', 'xxl');
			assert.deepEqual(await ids(page), ['tm']);
			await page.click('#search-clear');
			assert.equal((await ids(page)).length, 3);

			// the editor: a changed weight is saved, re-scored and kept after a reload. Opened
			// with the focus still in the search field: the first click must reach the row
			const before = await page.textContent('tr[data-id="fk"] .c-score .score');
			await page.click('tr[data-id="fk"] .c-name');
			await page.waitForSelector('#editor[open]');
			assert.equal(await page.inputValue('#ed-weight'), '9');
			await page.fill('#ed-weight', '9.5');
			await page.click('#ed-save');
			await page.waitForFunction(() => !document.querySelector('#editor').open);
			// saving stores the row, then draws the list again
			await page.waitForFunction(() => /9\.50 kg/.test(document.querySelector('tr[data-id="fk"]').textContent));
			assert.notEqual(await page.textContent('tr[data-id="fk"] .c-score .score'), before, 're-scored');
			await boot(page);
			await page.waitForSelector('#rows tr >> nth=2');
			assert.match(await page.textContent('tr[data-id="fk"]'), /9\.50 kg/, 'stored on this device');

			// select mode: mark one row, delete it
			await page.click('#select-btn');
			assert.ok(await page.isVisible('#list-bar'));
			await page.click('tr[data-id="mf"] .c-name');
			assert.equal(await page.textContent('#select-delete'), 'Delete 1');
			assert.equal(await page.isVisible('#editor[open]'), false, 'a tap marks, it does not open');
			await page.click('#select-delete');
			await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 2);
			assert.deepEqual((await ids(page)).sort(), ['fk', 'tm']);
			assert.equal(await page.isVisible('#list-bar'), false, 'select mode ends');
			assert.ok(await noSideScroll(page));

			assert.deepEqual(problems, []);
		} finally {
			await context.close();
		}
	});
}

// ---------- rows kept from one drawing of the list to the next ----------

// Twelve made-up Pokémon: three species, sizes and IVs varied, each caught on a day of its own
const SP = [['Testmon', 'TESTMON', 1.0, 20], ['Fakeon', 'FAKEON', 0.5, 8], ['Mr. Fake', 'MR_FAKE', 1.3, 55]];
const MANY = Array.from({ length: 12 }, (_, i) => {
	const [species, sp, h, w] = SP[i % 3];
	const ivs = { a: (i * 5) % 16, d: (i * 7 + 3) % 16, s: (i * 11 + 1) % 16 };
	const size = 1.52 + (i % 4) * 0.05;	// XXL, below every species' XXL limit
	return mon(`m${i}`, species, sp, ivs, 20 + (i % 5) * 2, Math.round(h * size * 100) / 100, Math.round(w * (size - 0.1 + (i % 3) * 0.1) * 100) / 100, `${1 + (i % 12)}/${10 + i}/2025`);
});
const MANY_BACKUP = JSON.stringify({ app: 'xxl-scorer', v: 1, exported: '2026-10-21T00:00:00Z', rows: MANY });

/** Ids in the order src/core gives them: the rows (with edits by id), a search, a sort. */
function expected(edits, query, sort) {
	const list = MANY.map(row => ({ row, e: evaluate(row.reading, ctx, edits[row.id] || row.edits) }));
	const p = compileSearch(query);
	return sortList(p ? list.filter(x => p(x.e)) : list, sort, -1).map(x => x.row.id);
}

/** Tags every row's element; tagged() then tells which elements are still the same ones. */
const tag = page => page.$$eval('#rows tr', trs => trs.forEach(t => { t.dataset.tag = 'kept'; }));
const tagged = page => page.$$eval('#rows tr', trs => trs.filter(t => t.dataset.tag === 'kept').map(t => t.dataset.id));
const pick = async (page, label) => {
	await page.click('#sort > summary');
	await page.click(`#sort-items button:has-text("${label}")`);
};

for (const width of [402, 1280]) {
	test(`at ${width} px: rows kept between drawings show the right Pokémon after sort, search, select, find and save`, { timeout: 60_000 }, async () => {
		const { context, page, problems } = await open(width);
		try {
			await page.addInitScript(() => { navigator.clipboard.writeText = () => Promise.resolve(); });
			await boot(page);
			await page.click('#backup > summary');
			await page.setInputFiles('#import', { name: 'many.json', mimeType: 'application/json', buffer: Buffer.from(MANY_BACKUP) });
			await page.waitForSelector('#rows tr >> nth=11');
			const all = MANY.map(r => r.id);
			assert.deepEqual(await ids(page), expected({}, '', { key: 'score', dir: -1 }));

			// sort: the same elements, in the new order
			await tag(page);
			await pick(page, 'Name');
			const byName = expected({}, '', { key: 'name', dir: 1 });
			assert.deepEqual(await ids(page), byName);
			assert.deepEqual((await tagged(page)).sort(), [...all].sort(), 'no row drawn again for a sort');
			await pick(page, 'CP');
			assert.deepEqual(await ids(page), expected({}, '', { key: 'cp', dir: -1 }));
			await pick(page, 'Name');

			// search: fewer rows, then all of them again, in order
			await page.fill('#search', 'fakeon');
			assert.deepEqual(await ids(page), expected({}, 'fakeon', { key: 'name', dir: 1 }));
			await page.fill('#search', 'mr');
			assert.deepEqual(await ids(page), expected({}, 'mr', { key: 'name', dir: 1 }));
			await page.click('#search-clear');
			assert.deepEqual(await ids(page), byName);
			assert.equal((await tagged(page)).length, 12, 'and none for a search');

			// select mode: marks on exactly the rows tapped, also after a search and back
			await page.click('#select-btn');
			const [s1, s2, s3] = [byName[1], byName[4], byName[7]];
			for (const id of [s1, s2, s3]) await page.click(`tr[data-id="${id}"] .c-name`);
			await page.click(`tr[data-id="${s2}"] .c-name`);	// and off again
			const marked = () => page.$$eval('#rows tr.selected', trs => trs.map(t => t.dataset.id));
			assert.deepEqual((await marked()).sort(), [s1, s3].sort());
			assert.equal(await page.textContent('#select-delete'), 'Delete 2');
			assert.deepEqual(await page.$$eval('#rows tr .tick', ts => ts.filter(t => t.textContent === '✓').length), 2);
			// a search drops the marks on rows it hides; back to all rows, those stay unmarked
			const name1 = MANY.find(r => r.id === s1).reading.species.toLowerCase();
			await page.fill('#search', name1);
			await page.click('#search-clear');
			assert.deepEqual(await marked(), [s1]);
			assert.equal(await page.textContent('#select-delete'), 'Delete 1');
			await page.click('#select-done');
			assert.deepEqual(await marked(), []);
			assert.equal(await page.locator('#rows tr .tick').count(), 0, 'no ticks left');
			assert.equal(await page.locator('#rows .btn.copy.find').count(), 12, 'the buttons are back');

			// find, then another row's find while the first is hidden by a search: one outline
			const species = id => MANY.find(r => r.id === id).reading.species;
			const f1 = byName[0], f2 = byName.find(id => species(id) !== species(f1));
			await page.click(`tr[data-id="${f1}"] .btn.copy.find`);
			assert.equal(await page.locator(`tr[data-id="${f1}"] .btn.copy.next`).count(), 1);
			await page.fill('#search', species(f2).toLowerCase());
			assert.ok(!(await ids(page)).includes(f1), 'the first one hidden');
			await page.click(`tr[data-id="${f2}"] .btn.copy.find`);
			await page.click('#search-clear');
			assert.deepEqual(await page.$$eval('#rows .btn.copy.next', bs => bs.map(b => b.closest('tr').dataset.id)), [f2]);
			await page.click('#toast');

			// the editor: the saved row drawn again with its new weight and moved by score;
			// the others kept
			await pick(page, 'Score');
			await tag(page);
			const ed = byName[5];
			await page.click(`tr[data-id="${ed}"] .c-name`);
			await page.waitForSelector('#editor[open]');
			const w = Math.round(MANY.find(r => r.id === ed).reading.weight_kg * 1.4 * 100) / 100;
			await page.fill('#ed-weight', String(w));
			await page.click('#ed-save');
			await page.waitForFunction(([id, w]) => document.querySelector(`tr[data-id="${id}"]`).textContent.includes(`${w.toFixed(2)} kg`), [ed, w]);
			const byScore = expected({ [ed]: { weight_kg: w } }, '', { key: 'score', dir: -1 });
			assert.deepEqual(await ids(page), byScore);
			assert.deepEqual((await tagged(page)).sort(), all.filter(id => id !== ed).sort(), 'only the saved row drawn again');
			const score = evaluate(MANY.find(r => r.id === ed).reading, ctx, { weight_kg: w }).score.total.toFixed(1);
			assert.equal(await page.textContent(`tr[data-id="${ed}"] .c-score .score`), score);

			// and after a reload, the same
			await boot(page);
			await page.waitForSelector('#rows tr >> nth=11');
			assert.deepEqual(await ids(page), byScore);
			assert.deepEqual(problems, []);
		} finally {
			await context.close();
		}
	});
}

// rows from outside or from an older version: shown and marked, never breaking the page
test('a row that can\'t be scored, a hostile backup, a failed import, copying without the clipboard API', { timeout: 60_000 }, async () => {
	const { context, page, problems } = await open(1280);
	try {
		await boot(page);
		// stored as an older version or a hand-edited backup might have: types as a string
		const bad = { ...ROWS[1], id: 'bad', reading: { ...ROWS[1].reading, types: 'ROCK' } };
		await page.evaluate(rows => new Promise((resolve, reject) => {
			const req = indexedDB.open('xxl-scorer', 1);
			req.onsuccess = () => {
				const t = req.result.transaction('rows', 'readwrite');
				for (const r of rows) t.objectStore('rows').put(r);
				t.oncomplete = () => { req.result.close(); resolve(); };
				t.onerror = () => reject(t.error);
			};
			req.onerror = () => reject(req.error);
		}), [ROWS[0], bad]);
		await boot(page);
		await page.waitForSelector('#rows tr >> nth=1');
		assert.deepEqual((await ids(page)).sort(), ['bad', 'tm'], 'both rows listed');
		assert.equal(await page.textContent('tr[data-id="bad"] .chip'), 'check');
		await page.click('tr[data-id="bad"] .c-name');
		await page.waitForSelector('#editor[open]');
		assert.match(await page.textContent('#ed-issues'), /can't be scored/);
		await page.click('#editor button[value="cancel"]');

		// a backup naming "constructor" as the species: taken without that edit
		const evil = { ...mon('ev', 'Fakeon', 'FAKEON', { a: 2, d: 3, s: 4 }, 22, 0.55, 7.5, '1/2/2025'), edits: { id: 'constructor' } };
		await page.click('#backup > summary');
		await page.setInputFiles('#import', { name: 'evil.json', mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify({ app: 'xxl-scorer', v: 1, rows: [evil] })) });
		await page.waitForSelector('tr[data-id="ev"]');
		assert.match(await page.textContent('tr[data-id="ev"] .c-name'), /Fakeon/);
		assert.equal(await page.textContent('tr[data-id="ev"] .chip'), 'ok');

		// storage refusing the rows: the import says so
		await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new Error('disk full'); }; });
		await page.click('#backup > summary');
		await page.setInputFiles('#import', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(BACKUP) });
		await page.waitForFunction(() => /Import failed: disk full/.test(document.querySelector('#banners').textContent));

		// no Async Clipboard API: the fallback copies without a CSP violation
		await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('no')); });
		await page.click('tr[data-id="tm"] .btn.copy.find');
		await page.waitForSelector('#toast:not([hidden])');
		assert.match(await page.textContent('#toast'), /641|9001/);

		assert.deepEqual(problems, []);
	} finally {
		await context.close();
	}
});

// The engine (tesseract.js) reads a drawn image: it runs in a worker started from a blob: URL, so
// the page's CSP covers it, and everything it loads comes from the site itself. No screenshot:
// a grey card with dark bars, nothing a reading could find a Pokémon in.
function drawnScreen() {
	const width = 750, height = 1334, data = new Uint8ClampedArray(width * height * 4).fill(235);
	const box = (x0, y0, w, h, v) => {
		for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) data.fill(v, (y * width + x) * 4, (y * width + x) * 4 + 3);
	};
	box(60, 700, 630, 560, 250);
	for (let i = 0; i < 6; i++) box(120, 760 + i * 70, 300 + i * 40, 24, 40);
	return encodePng({ width, height, data });
}

test('the text recognition engine runs under the CSP and loads only from the site', { timeout: 120_000 }, async () => {
	const { context, page, problems } = await open(1280);
	const loaded = [];
	page.on('request', r => loaded.push(r.url()));
	try {
		await boot(page);
		const before = loaded.length;
		await page.setInputFiles('#add', { name: 'drawn.png', mimeType: 'image/png', buffer: drawnScreen() });
		await page.waitForFunction(() => document.querySelector('#queue').hidden && !/Starting/.test(document.querySelector('#queue').textContent), null, { timeout: 100_000 });
		const engine = loaded.slice(before);
		for (const f of ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tessdata/eng.traineddata.gz'])
			assert.ok(engine.includes(base + f), `${f} loaded:\n${engine.join('\n')}`);
		assert.ok(engine.some(u => u.startsWith(`${base}vendor/tesseract/core/tesseract-core-`)), 'a core file');
		assert.deepEqual(engine.filter(u => !u.startsWith(base) && !/^(data|blob):/.test(u)), [], 'nothing from elsewhere, PokeMiners included');
		assert.ok(page.workers().length > 0 && page.workers().every(w => w.url().startsWith('blob:')), page.workers().map(w => w.url()).join(', '));
		// the reading went through: a row to check, or a note that nothing could be read
		assert.match(await page.textContent('main') + await page.textContent('#banners'), /Species not read|Could not read|check/);
		assert.deepEqual(problems, []);
	} finally {
		await context.close();
	}
});

test('the guards notice what they are there for', { timeout: 30_000 }, async () => {
	// a request the CSP blocks
	const a = await open(1280);
	try {
		await boot(a.page);
		await a.page.evaluate(() => fetch('https://example.org/x').catch(() => {}));
		await a.page.waitForTimeout(200);
		assert.ok(a.problems.some(p => /CSP violation: connect-src blocked https:\/\/example\.org/.test(p)), a.problems.join('\n'));
	} finally {
		await a.context.close();
	}
	// a worker started from a blob: URL, as the engine's, runs under the page's CSP
	const w = await open(1280);
	try {
		await boot(w.page);
		const got = await w.page.evaluate(() => new Promise(resolve => {
			const src = "fetch('https://example.org/w').then(() => postMessage('fetched'), () => postMessage('refused'))";
			const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
			worker.onmessage = m => resolve(m.data);
		}));
		assert.equal(got, 'refused');
		await w.page.waitForTimeout(200);
		assert.ok(!w.problems.includes('request: https://example.org/w'), 'blocked before it left');
	} finally {
		await w.context.close();
	}
	// a request elsewhere that gets past the CSP (here switched off), stopped before it leaves
	const b = await open(1280, { bypassCSP: true });
	try {
		await b.context.route('https://example.org/**', r => r.abort());
		await boot(b.page);
		await b.page.evaluate(() => fetch('https://example.org/y').catch(() => {}));
		assert.ok(b.problems.includes('request: https://example.org/y'), b.problems.join('\n'));
	} finally {
		await b.context.close();
	}
});
