// Smoke test of the page in a real browser: boot with synthetic game data, import a backup,
// the rows, sorting, search, the editor, select and delete, at a phone's width and a desktop's.
// Rows kept on screen from one drawing to the next show what they should after each of these.
// Rows that can't be scored, a hostile backup, a failed import, copying without the clipboard API.
// The text recognition engine reading a drawn image, under the page's CSP, loading only from the site,
// with screenshots decoded in a worker or on the page: the same pixels, the same readings.
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
import { encodePng, iccpDisplayP3 } from '../lib/png.js';

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
// a grey 2 × 2 JPEG: backups carry JPEG thumbnails only
const thumb = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDpKKKKAP/Z';
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

			// rank badges: each row's place by score, whatever the order; the top ten filled
			// (no ties among these rows); a search ranks the rows it shows, without drawing them again
			const ranks = () => page.$$eval('#rows .rank', bs => bs.map(b => Number(b.textContent)).sort((a, b) => a - b));
			const places = n => Array.from({ length: n }, (_, i) => i + 1);
			const all12 = await ranks();
			assert.deepEqual(all12, places(all12.length));
			assert.equal(await page.locator('#rows .rank.top').count(), Math.min(10, all12.length));
			await page.fill('#search', 'mr');
			assert.deepEqual(await ranks(), places((await ids(page)).length));
			await page.click('#search-clear');
			assert.deepEqual(await ranks(), all12);
			assert.equal((await tagged(page)).length, 12, 'none drawn again for the ranks');

			// select mode: marks on exactly the rows tapped, also after a search and back
			// rows off screen report a stand-in height (content-visibility): measured drawn
			const heights = () => page.$$eval('#rows tr', trs => {
				for (const t of trs) t.style.contentVisibility = 'visible';
				const hs = trs.map(t => t.getBoundingClientRect().height);
				for (const t of trs) t.style.contentVisibility = '';
				return hs;
			});
			const unselected = await heights();
			await page.click('#select-btn');
			assert.deepEqual(await heights(), unselected, 'select mode keeps every row\'s height');
			assert.equal(await page.locator('#rows .pair[inert]').count(), await page.locator('#rows .pair').count());
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
			assert.equal(await page.locator('#rows .pair[inert]').count(), 0, 'the buttons are back');

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
test('a backup carries the "Name to copy" template; the newer one wins on import', { timeout: 60_000 }, async () => {
	const tpl = 'XX{score}{lvl:circ}';
	const a = await open(1280);
	const b = await open(1280);	// another browser: storage of its own
	try {
		// set it, and the Backup button says there is something to export
		await boot(a.page);
		await a.page.click('#settings-btn');
		await a.page.fill('#name-tpl', tpl);
		await a.page.press('#name-tpl', 'Tab');
		await a.page.waitForFunction(() => !document.querySelector('#export-dot').hidden);
		await a.page.click('#backup > summary');
		const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#export')]);
		const file = await readFile(await download.path());
		const data = JSON.parse(file.toString());
		assert.equal(data.settings.nameTemplate, tpl);
		assert.ok(data.settings.nameTemplateAt > 0, 'with the time it was set');
		await a.page.waitForFunction(() => document.querySelector('#export-dot').hidden);

		// restored where the browser has none (the default): taken, and the import says so
		await boot(b.page);
		assert.equal(await b.page.inputValue('#name-tpl'), 'XX{score}{iv:sup}{a:dcirc}{lvl:circ}');
		await b.page.click('#backup > summary');
		await b.page.setInputFiles('#import', { name: 'backup.json', mimeType: 'application/json', buffer: file });
		await b.page.waitForFunction(() => /Name to copy: XX\{score\}\{lvl:circ\}/.test(document.querySelector('#banners').textContent));
		assert.equal(await b.page.inputValue('#name-tpl'), tpl);

		// an older backup's template doesn't replace it; one without settings changes nothing
		const older = { app: 'xxl-scorer', v: 1, rows: [], settings: { nameTemplate: 'OLD{score}', nameTemplateAt: 1 } };
		await b.page.setInputFiles('#import', { name: 'older.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(older)) });
		await b.page.waitForFunction(() => /Imported: 0 new, 0 updated, 0 already up to date\.$/m.test(document.querySelector('#banners').innerText));
		await b.page.setInputFiles('#import', { name: 'plain.json', mimeType: 'application/json', buffer: Buffer.from(BACKUP) });
		await b.page.waitForSelector('#rows tr >> nth=2');
		assert.equal(await b.page.inputValue('#name-tpl'), tpl);

		// kept across visits
		await boot(b.page);
		assert.equal(await b.page.inputValue('#name-tpl'), tpl);
		assert.deepEqual([...a.problems, ...b.problems], []);
	} finally {
		await a.context.close();
		await b.context.close();
	}
});

test('the backup file name: set in Settings, used by Export, carried by the backup', { timeout: 60_000 }, async () => {
	const a = await open(1280);
	const b = await open(1280);
	const exportFrom = async page => {
		await page.click('#backup > summary');
		const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export')]);
		return { name: download.suggestedFilename(), data: JSON.parse((await readFile(await download.path())).toString()) };
	};
	try {
		// nothing set: the dated default, and the backup carries no file name
		await boot(a.page);
		await a.page.click('#settings-btn');
		assert.equal(await a.page.inputValue('#file-name'), '');
		assert.match(await a.page.textContent('#file-example'), /^xxl-scorer-\d{4}-\d\d-\d\d\.json$/);
		let out = await exportFrom(a.page);
		assert.match(out.name, /^xxl-scorer-\d{4}-\d\d-\d\d\.json$/);
		assert.equal(out.data.settings, undefined);

		// set: the example follows, the Backup dot lights, Export uses it
		await a.page.fill('#file-name', 'TalimeeZero');
		await a.page.press('#file-name', 'Tab');
		assert.equal(await a.page.textContent('#file-example'), 'TalimeeZero.json');
		await a.page.waitForFunction(() => !document.querySelector('#export-dot').hidden);
		out = await exportFrom(a.page);
		assert.equal(out.name, 'TalimeeZero.json');
		assert.equal(out.data.settings.fileName, 'TalimeeZero');
		assert.ok(out.data.settings.fileNameAt > 0);
		assert.equal(out.data.settings.nameTemplate, undefined, 'the template only once set');

		// restored into a browser with none; the import says so
		await boot(b.page);
		await b.page.click('#backup > summary');
		await b.page.setInputFiles('#import', { name: 'TalimeeZero.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(out.data)) });
		await b.page.waitForFunction(() => /Backup file name: TalimeeZero\.json/.test(document.querySelector('#banners').textContent));
		assert.equal(await b.page.inputValue('#file-name'), 'TalimeeZero');
		// an older one doesn't replace it; kept across visits
		const older = { app: 'xxl-scorer', v: 1, rows: [], settings: { fileName: 'TalimeeOne', fileNameAt: 1 } };
		await b.page.setInputFiles('#import', { name: 'older.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(older)) });
		await b.page.waitForFunction(() => /Imported: 0 new, 0 updated, 0 already up to date\.$/m.test(document.querySelector('#banners').innerText));
		await boot(b.page);
		assert.equal(await b.page.inputValue('#file-name'), 'TalimeeZero');

		// emptied: back to the dated default
		await a.page.fill('#file-name', '');
		await a.page.press('#file-name', 'Tab');
		out = await exportFrom(a.page);
		assert.match(out.name, /^xxl-scorer-\d{4}-\d\d-\d\d\.json$/);
		assert.deepEqual([...a.problems, ...b.problems], []);
	} finally {
		await a.context.close();
		await b.context.close();
	}
});

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

/** The stored rows, as the page keeps them (src/ui/db.js). */
const storedRows = page => page.evaluate(async () => (await import('/src/ui/db.js')).rows.all());
const readBoth = {};	// where -> the row read

// In Chrome the page decodes screenshots in a worker of their own; without
// navigator.userAgentData (as in Safari and Firefox) on the page itself.
for (const where of ['worker', 'page']) {
	test(`the text recognition engine runs under the CSP and loads only from the site (decoded on the ${where === 'page' ? 'page' : 'reader\'s worker'})`, { timeout: 120_000 }, async () => {
		const { context, page, problems } = await open(1280);
		const loaded = [];
		page.on('request', r => loaded.push(r.url()));
		if (where === 'page') await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined }));
		try {
			await boot(page);
			// one engine started ahead, once the page is idle: before any screenshot
			await page.waitForFunction(() => document.querySelectorAll('script[src$="tesseract.min.js"]').length === 1, null, { timeout: 30_000 });
			await page.waitForTimeout(2000);
			assert.ok(page.workers().length >= 1, 'the engine\'s worker');
			const before = loaded.length;
			await page.setInputFiles('#add', { name: 'drawn.png', mimeType: 'image/png', buffer: drawnScreen() });
			await page.waitForFunction(() => document.querySelector('#queue').hidden && !/Starting/.test(document.querySelector('#queue').textContent), null, { timeout: 100_000 });
			assert.ok(!loaded.slice(before).some(u => /tesseract|tessdata/.test(u)), 'engine and model loaded ahead, while the page was idle');
			for (const f of ['vendor/tesseract/tesseract.min.js', 'vendor/tesseract/worker.min.js', 'vendor/tessdata/eng.traineddata.gz'])
				assert.ok(loaded.includes(base + f), `${f} loaded:\n${loaded.join('\n')}`);
			assert.ok(loaded.some(u => u.startsWith(`${base}vendor/tesseract/core/tesseract-core-`)), 'a core file');
			assert.equal(loaded.includes(`${base}src/ui/reader.js`), where === 'worker', `reader.js loaded only for the worker:\n${loaded.join('\n')}`);
			assert.deepEqual(loaded.filter(u => !u.startsWith(base) && !/^(data|blob):/.test(u)), [], 'nothing from elsewhere, PokeMiners included');
			assert.ok(page.workers().length > 0 && page.workers().every(w => w.url().startsWith('blob:')), page.workers().map(w => w.url()).join(', '));
			// the reading went through: a row to check, or a note that nothing could be read
			assert.match(await page.textContent('main') + await page.textContent('#banners'), /Species not read|Could not read|check/);
			// how long it took: a line under the footer, not a banner to dismiss
			assert.match(await page.textContent('#stats'), /^1 screenshot read in \d+\.\d s\.$/);
			assert.equal(await page.isVisible('#stats'), true);
			assert.doesNotMatch(await page.textContent('#banners'), /read in|merged into|swiping/);
			const rows = await storedRows(page);
			assert.equal(rows.length, 1);
			readBoth[where] = { reading: { ...rows[0].reading, ms: 0 }, thumb: rows[0].thumb };
			assert.deepEqual(problems, []);
		} finally {
			await context.close();
		}
	});
}

test('decoded on the page or in the reader\'s worker: the same readings and thumbnail', () => {
	assert.ok(readBoth.worker && readBoth.page, 'both runs above passed');
	assert.deepEqual(readBoth.worker, readBoth.page);
});

// The pixels a worker decodes (OffscreenCanvas) must be the page's (HTML canvas), byte for byte,
// or the readings could differ: PNG at 8 and 16 bits per sample, with a colour profile that
// has to be converted, a JPEG and a JPEG turned by its EXIF orientation. And the thumbnail.
function testImages() {
	const width = 240, height = 400, data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			data[i] = (x * 7 + y) & 255; data[i + 1] = (y * 3) & 255; data[i + 2] = (x * y) & 255; data[i + 3] = 255;
		}
	}
	const img = { width, height, data };
	return {
		png8: encodePng(img), png16: encodePng(img, { depth: 16 }),
		p3: encodePng(img, { chunks: [['iCCP', iccpDisplayP3()]] }),
	};
}

test('decoding in a worker gives the page\'s pixels and thumbnail, byte for byte', { timeout: 60_000 }, async () => {
	const { context, page, problems } = await open(1280);
	try {
		await boot(page);
		const imgs = Object.fromEntries(Object.entries(testImages()).map(([k, b]) => [k, b.toString('base64')]));
		const got = await page.evaluate(async imgs => {
			const files = Object.fromEntries(Object.entries(imgs).map(([k, b64]) =>
				[k, new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], `${k}.png`, { type: 'image/png' })]));
			// a JPEG, and the same with an EXIF orientation (6: turned a quarter clockwise)
			const c = Object.assign(document.createElement('canvas'), { width: 240, height: 400 });
			const g = c.getContext('2d');
			g.drawImage(await createImageBitmap(files.png8), 0, 0);
			const jpeg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
			const exif = [0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
			files.jpeg = new File([jpeg], 'a.jpg', { type: 'image/jpeg' });
			files.turned = new File([jpeg.subarray(0, 2), new Uint8Array(exif), jpeg.subarray(2)], 'b.jpg', { type: 'image/jpeg' });
			const { decode, thumbnail, pageCanvas } = await import('/src/ui/decode.js');
			// as ocr.js starts reader.js: a dynamic import, which the page's policy allows there
			const src = `const m = import(${JSON.stringify(new URL('src/ui/decode.js', document.baseURI).href)});
				onmessage = async ({ data: file }) => {
					const { decode, thumbnail, workerCanvas } = await m;
					const img = await decode(file, workerCanvas);
					postMessage({ img, thumb: await thumbnail(img, workerCanvas) });
				};`;
			const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
			const inWorker = file => new Promise(resolve => { w.onmessage = m => resolve(m.data); w.postMessage(file); });
			const out = {};
			const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
			for (const [k, file] of Object.entries(files)) {
				const a = await decode(file, pageCanvas), b = await inWorker(file);
				out[k] = {
					size: [a.width, a.height], same: a.width === b.img.width && a.height === b.img.height && same(a.data, b.img.data),
					thumb: (await thumbnail(a, pageCanvas)) === b.thumb, data: a.data,
				};
			}
			const differs = (a, b) => !same(a, b);
			return {
				...Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { size: v.size, same: v.same, thumb: v.thumb }])),
				// the profile was applied, the 16-bit file cut to 8 bits like the 8-bit one
				converted: differs(out.p3.data, out.png8.data), sixteen: same(out.png16.data, out.png8.data),
			};
		}, imgs);
		for (const k of ['png8', 'png16', 'p3', 'jpeg', 'turned']) {
			assert.deepEqual(got[k], { size: k === 'turned' ? [400, 240] : [240, 400], same: true, thumb: true }, k);
		}
		assert.equal(got.converted, true, 'the colour profile converted');
		assert.equal(got.sixteen, true);
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
		// but none from a file of the site: it would take its policy from that file's headers,
		// none on GitHub Pages, and the engine's worker file loads whatever core a message names
		const fromFile = await w.page.evaluate(() => new Promise(resolve => {
			try {
				const worker = new Worker('vendor/tesseract/worker.min.js');
				worker.onerror = () => resolve('refused');
				setTimeout(() => resolve('started'), 2000);
			} catch { resolve('refused'); }
		}));
		assert.equal(fromFile, 'refused');
		assert.ok(w.problems.some(p => /CSP violation: worker-src blocked .*worker\.min\.js/.test(p)), w.problems.join('\n'));
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

// The editor gives the focus back to its row when it closes: after a tap the row shows no focus
// ring, after the keyboard it has the focus (and its ring), after Cancel as after Save.
test('closing the editor: no focus ring after a tap, the row focused after the keyboard', { timeout: 60_000 }, async () => {
	const { context, page, problems } = await open(402, { hasTouch: true, isMobile: true });
	await boot(page);
	await page.setInputFiles('#import', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(BACKUP) });
	await page.waitForSelector('tr[data-id="tm"]');
	const focused = () => page.evaluate(() => {
		const a = document.activeElement;
		return { row: a?.dataset?.id ?? null, ring: !!a && a !== document.body && a.matches(':focus-visible') };
	});
	const closed = () => page.waitForFunction(() => !document.querySelector('#editor').open);
	for (const button of ['cancel', 'save']) {
		await page.tap('tr[data-id="tm"] .c-name');
		await page.waitForSelector('#editor[open]');
		await page.tap(`#editor button[value="${button}"]`);
		await closed();
		await page.waitForTimeout(100);
		assert.deepEqual(await focused(), { row: null, ring: false }, `tap, ${button}`);

		await page.focus('tr[data-id="tm"]');
		await page.keyboard.press('Enter');
		await page.waitForSelector('#editor[open]');
		if (button === 'cancel') await page.keyboard.press('Escape');
		else { await page.focus('#ed-save'); await page.keyboard.press('Enter'); }
		await closed();
		await page.waitForTimeout(100);
		assert.deepEqual(await focused(), { row: 'tm', ring: true }, `keyboard, ${button}`);
	}
	assert.deepEqual(problems, []);
	await context.close();
});

