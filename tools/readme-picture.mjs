// Draws the README's pictures: the real page at a phone's width (iPhone 17 Pro, 402 CSS px).
//   docs/list.png, docs/list-dark.png   the list, filled with made-up XXL Pokémon
//   docs/help.png                       the empty list with its drawing of which screenshots
// No game art and no screenshots: the rows are invented values for real species, and each
// thumbnail is drawn here the way the help draws its phones (backdrop, arc, a blob standing in
// for the Pokémon, tinted by its type). Stats, sizes and the score formula are the real game
// data's, so CP, HP and scores are ones a Pokémon of that species could have.
//
//   npm install --no-save --ignore-scripts playwright-core@<version in .github/workflows/ci.yml>
//   node tools/readme-picture.mjs                                # Google Chrome installed
//   XXL_CHROME=/path/to/chromium node tools/readme-picture.mjs   # another Chromium
//
// The game data is downloaded from PokeMiners,
// or taken from XXL_GM_DIR (latest.json, i18n_english.json) when set. With pngquant on the
// PATH the pictures are quantized to a quarter of their size.
//
// The page's font is the system's: San Francisco on the iPhone. Elsewhere (Inter on most
// Linux systems) the lines are wider and break in other places; XXL_TRACKING (default
// -0.035em, for Inter) narrows the letters to break them roughly as an iPhone does.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { compactGameMaster, GM_URL, ROW } from '../src/core/gm.js';
import { compactText, textUrl } from '../src/core/text.js';
import { makeContext, evaluate } from '../src/core/evaluate.js';
import { levelTable, cpOf, hpOf } from '../src/core/ivs.js';
import { score } from '../src/core/score.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HEIGHT = 760;	// CSS px: the header and three and a half rows
const HELP_HEIGHT = 548;	// CSS px: the header and the drawing with its captions
const TRACKING = process.env.XXL_TRACKING ?? '-0.035em';

async function load(file, url) {
	const dir = process.env.XXL_GM_DIR;
	if (dir && existsSync(join(dir, file))) return JSON.parse(readFileSync(join(dir, file), 'utf8'));
	const r = await fetch(url);
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
	return r.json();
}

// ---------- the rows: made up, each one a possible Pokémon ----------

const gm = compactGameMaster(await load('latest.json', GM_URL));
const text = compactText(await load('i18n_english.json', textUrl('en')));
const levels = levelTable(gm.cpm);

const ctx = makeContext(gm, text);

// species, IVs, level, the score aimed at, weight against (height ratio)² × average weight,
// catch date. Scores as a real box of XXLs has them: about 940-1150, few above 1100 (the
// maintainer's 280: Meowscarada 1144.7, Yanma 1098.7, Buizel 1030.1, Klink 940.9). Where a
// species can land depends on its XXL bound K (h̄ × 1.55, 1.75 or 2.00): an XXL of a 1.55
// species scores 1130 or more, so none here; the lowest scores come from 2.00 species.
const LIST = [
	['DRAGONITE', [15, 14, 15], 40, 1139, 1.05, '7/12/2023'],
	['PIKACHU', [10, 13, 11], 25, 1098, 1.04, '8/9/2026'],
	['LAPRAS', [9, 14, 15], 28, 1071, 1.0, '6/1/2024'],
	['WOOPER', [15, 15, 14], 22, 1046, 0.95, '5/30/2026'],
	['SNORLAX', [10, 12, 9], 33, 1031, 0.9, '3/2/2025'],
	['GYARADOS', [13, 11, 12], 35, 1002, 0.94, '9/14/2022'],
	['MAGIKARP', [6, 11, 9], 20, 941, 0.88, '4/18/2025'],
];
const r2 = x => Math.round(x * 100) / 100;
const rows = LIST.map(([sp, [a, d, s], level, aim, wf, caught], i) => {
	const row = gm.species[sp].f[''];
	const species = text.names[String(gm.species[sp].dex)];	// as the game shows it
	const m = levels.find(x => x.level === level).m;
	// the XXL height (as the game shows it, to the centimetre) whose score comes closest to the aim
	let best;
	for (let h = r2(row[ROW.XL_MAX] + 0.01); h <= row[ROW.XXL_MAX]; h = r2(h + 0.01)) {
		const w = r2(row[ROW.W] * (h / row[ROW.H]) ** 2 * wf);
		const total = score(row, gm.coef, h, w, a + d + s, true).total;
		if (!best || Math.abs(total - aim) < Math.abs(best.total - aim)) best = { h, w, total };
	}
	const { h: height_m, w: weight_kg } = best;
	const types = row[ROW.TYPES].split('/');
	const reading = { species, caught, cp: cpOf(row, a, d, s, m), hp: hpOf(row, s, m), height_m, weight_kg,
		bars: { a, d, s }, badge: 'XXL', types };
	const e = evaluate(reading, ctx);
	if (e.id !== sp || !e.score || !e.xxl || e.issues.length) throw new Error(`${species} isn't a clean XXL row of ${sp}: ${e.issues.map(x => x.msg)}`);
	console.log(`${species.padEnd(10)} ${e.score.total.toFixed(1)} ±${e.score.band.toFixed(1)}  ${height_m} m  ${weight_kg} kg  CP ${e.cp}`);
	return { id: `readme-${i}`, created: 1e12 + i, updated: 1e12 + i, scanned: 1e12, scanIdx: i,
		file: `${i}.png`, edits: {}, reading, type: types[0] };
});

// ---------- the site: the repository's files, with this game data ----------

const LOCAL = {
	'/local/config.json': JSON.stringify({ gm: 'local/data/gm.json' }),
	'/local/data/gm.json': JSON.stringify({ ...gm, text: { en: text } }),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
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
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch(process.env.XXL_CHROME ? { executablePath: process.env.XXL_CHROME } : { channel: 'chrome' });

// ---------- drawing ----------

async function draw(scheme, out) {
	const context = await browser.newContext({ viewport: { width: 402, height: HEIGHT }, deviceScaleFactor: 2,
		colorScheme: scheme, isMobile: true, hasTouch: true });
	const page = await context.newPage();
	page.on('pageerror', err => { throw err; });
	await page.goto(base);
	await page.waitForFunction(() => /species from/.test(document.querySelector('#gm-status').textContent));

	// in the page's own colours, so the dark picture gets dark thumbnails
	const thumbs = await page.evaluate(rows => {
		const css = getComputedStyle(document.documentElement);
		const v = n => css.getPropertyValue(n).trim();
		const tint = { DRAGON: '#8a7fc0', NORMAL: '#a8a08a', GROUND: '#b99a62', ELECTRIC: '#d9b84a', WATER: '#6f9bc9', ICE: '#7fb8c2' };
		const shape = [[30, 30], [34, 29], [33, 31], [26, 26], [30, 24], [36, 22], [33, 28]];
		return rows.map((r, i) => {
			const c = document.createElement('canvas');
			c.width = 112; c.height = 92;	// the page's own thumbnails are 112 px wide
			const g = c.getContext('2d');
			g.fillStyle = v('--accent-soft');
			g.fillRect(0, 0, 112, 92);
			g.strokeStyle = v('--muted'); g.globalAlpha = 0.4; g.lineWidth = 3;
			g.beginPath(); g.arc(56, 84, 44, Math.PI, 2 * Math.PI); g.stroke();
			const [rx, ry] = shape[i % shape.length];
			g.globalAlpha = 0.18; g.fillStyle = v('--muted');
			g.beginPath(); g.ellipse(56, 82, rx * 1.05, 4, 0, 0, 2 * Math.PI); g.fill();
			g.globalAlpha = 0.85; g.fillStyle = tint[r.type] || v('--muted');
			g.beginPath(); g.ellipse(56, 80 - ry, rx, ry, 0, 0, 2 * Math.PI); g.fill();
			return c.toDataURL('image/jpeg', 0.9);
		});
	}, rows);

	const backup = { app: 'xxl-scorer', v: 1, exported: '2026-10-22T00:00:00Z',
		rows: rows.map(({ type, ...r }, i) => ({ ...r, thumb: thumbs[i] })) };
	await page.setInputFiles('#import', { name: 'readme.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
	await page.waitForFunction(n => document.querySelectorAll('#rows tr').length === n, rows.length);
	// not in the picture: the import's banner, the dot on Backup ("not exported yet")
	await page.evaluate(tracking => {
		document.querySelectorAll('.banner, .dot').forEach(x => x.remove());
		document.body.style.letterSpacing = tracking;
	}, TRACKING);
	await page.waitForTimeout(300);
	await page.screenshot({ path: out });
	await context.close();
	quantize(out);
	console.log(out);
}

/** The empty list: the header and the help's drawing. Light only: the README links to it. */
async function drawHelp(out) {
	const context = await browser.newContext({ viewport: { width: 402, height: HELP_HEIGHT }, deviceScaleFactor: 2,
		colorScheme: 'light', isMobile: true, hasTouch: true });
	const page = await context.newPage();
	page.on('pageerror', err => { throw err; });
	await page.goto(base);
	await page.waitForFunction(() => /species from/.test(document.querySelector('#gm-status').textContent));
	await page.evaluate(tracking => { document.body.style.letterSpacing = tracking; }, TRACKING);
	await page.waitForTimeout(300);
	await page.screenshot({ path: out });
	await context.close();
	quantize(out);
	console.log(out);
}

function quantize(file) {
	try {
		execFileSync('pngquant', ['--quality', '80-100', '--speed', '1', '--force', '--ext', '.png', file]);
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
	}
}

try {
	await draw('light', join(root, 'docs/list.png'));
	await draw('dark', join(root, 'docs/list-dark.png'));
	await drawHelp(join(root, 'docs/help.png'));
} finally {
	await browser.close();
	server.close();
}
