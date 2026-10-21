// Smoke test of the page in a real browser: boot with synthetic game data, import a backup,
// the rows, sorting, search, the editor, select and delete, at a phone's width and a desktop's.
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
	page.on('console', m => { if (m.type() === 'error' || /Content.Security.Policy/i.test(m.text())) problems.push(`console: ${m.text()}`); });
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
