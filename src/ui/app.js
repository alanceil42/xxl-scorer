// xxl-scorer page: queue, table, editor, backup. Pure logic lives in src/core.
import { makeContext, evaluate, evaluateSafely, formLabel, mergeTarget, mergeReadings } from '../core/evaluate.js';
import { makeRules } from '../core/read.js';
import { findDex } from '../core/text.js';
import { formatName, nameValues, DEFAULT_TEMPLATE } from '../core/nickname.js';
import { compileSearch, needsCheck } from '../core/search.js';
import { gameSearch } from '../core/gamesearch.js';
import { MODES } from '../core/score.js';
import { SORTS, MENU, firstDir, isDefault, sortList, scoreRanks } from '../core/sort.js';
import { rows as rowStore, kv, newId, askPersist } from './db.js';
import { loadGameData, importGameData, dropImportedGameData } from './gamedata.js';
import { readerFor, startWorkers, poolSize, warmUp } from './ocr.js';
import { evaluateRow } from './evalcache.js';
import rulesEn from '../rules/en.js';
import { phoneElement } from './help.js';
import { cleanRow, cleanSettings } from '../core/backup.js';
import { imprintLink } from '../core/imprint.js';
import { readBuild, buildLink } from '../core/buildinfo.js';

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
	const e = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') e.className = v;
		else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
		else e.setAttribute(k, v === true ? '' : v);
	}
	e.append(...kids.flat().filter(k => k != null && k !== false));
	return e;
};
const fmt = (n, d = 2) => (n == null || Number.isNaN(n) ? '–' : Number(n).toFixed(d));
const RULES = { en: rulesEn };
const SVG = 'http://www.w3.org/2000/svg';
/** A Lucide icon from the vendored sprite; the button's own words or label name it. */
const icon = name => {
	const s = document.createElementNS(SVG, 'svg');
	// a size of its own, so a stale app.css (or none) can't blow it up to 300 × 150
	for (const [k, v] of [['class', 'ic'], ['width', '20'], ['height', '20'], ['viewBox', '0 0 24 24'], ['aria-hidden', 'true']]) s.setAttribute(k, v);
	const u = document.createElementNS(SVG, 'use');
	u.setAttribute('href', `vendor/lucide/icons.svg#${name}`);
	s.append(u);
	return s;
};

const state = {
	config: { gm: 'upstream', gmCheckDays: 7, lang: 'en' },
	ctx: null, rules: null, gmInfo: null,
	// stored: {id, created, updated, scanned, scanIdx, file, reading, edits, thumb}. A row's
	// reading and edits are never changed in place, only replaced by new objects: evaluated
	// rows are cached by them (evalcache.js), and a change in place would go unseen
	rows: [],
	sort: { key: 'score', dir: -1 },	// not stored: a visit starts by score
	search: null,	// predicate from compileSearch, null = show all
	shown: [],	// ids of the rows on screen, for select mode's All
	busy: false,
	run: null,	// the screenshot queue while it runs (addFiles)
	pendingDup: [],	// [{row, existing}]
	errors: [],
	nameTemplate: DEFAULT_TEMPLATE,
	nameTemplateAt: -1,	// when it was set; -1: never (the default). A backup's newer one wins.
	mode: 'xxl',	// showcase: 'xxl' biggest, 'xxs' smallest
	minHintSeen: false,
	selecting: false,	// select mode: a tap marks a row instead of opening it
	selected: new Set(),
	findNext: null,	// the row whose nickname is the next tap, after its Find
	lastExport: null,
};

const DAY = 24 * 3600 * 1000;
const EXPORT_NAG_DAYS = 6;	// Safari may delete site data after 7 days without a visit
const TEMPLATE_PAUSE = 400;	// ms without a keystroke before a new nickname template is taken

// ---------- boot ----------

async function boot() {
	// The stored list first: it is on this device and quick, so the page can say "Loading 50
	// Pokémon…" at once instead of showing the empty list until the game data is ready.
	state.rows = await rowStore.all();
	const tpl = await kv.get('nameTemplate');
	state.nameTemplate = tpl || DEFAULT_TEMPLATE;
	// set before the time was kept: 0, older than any set since, newer than never
	state.nameTemplateAt = (await kv.get('nameTemplateAt')) ?? (tpl ? 0 : -1);
	state.lastExport = (await kv.get('lastExport')) || null;
	state.mode = (await kv.get('mode')) === 'xxs' ? 'xxs' : 'xxl';
	state.minHintSeen = !!(await kv.get('minHintSeen'));
	state.sort = { key: 'score', dir: MODES[state.mode].best };
	$('#name-tpl').value = state.nameTemplate;
	wire();
	render();
	// Shipped defaults, then the site's own settings in local/ (never in git).
	for (const url of ['config.json', 'local/config.json']) {
		try {
			const r = await fetch(url, { cache: 'no-cache' });
			if (r.ok) Object.assign(state.config, await r.json());
		} catch { /* keep what we have */ }
	}
	showImprint();
	showBuild();
	await loadData(false);
	// One engine started once the page has nothing else to do, so that the first screenshot
	// doesn't wait for the download and start-up; the others when the file picker opens (wire)
	const idle = window.requestIdleCallback || (f => setTimeout(f, 1000));
	idle(() => warmUp(1, tesseractLang()), { timeout: 5000 });
}

const tesseractLang = () => (RULES[state.config.lang] || rulesEn).tesseract;

/** The footer's legal notice link, when the site's settings name one. */
function showImprint() {
	const link = imprintLink(state.config);
	const a = $('#imprint');
	if (!link || !a) return;
	a.href = link.href;
	a.textContent = link.label;
	a.parentElement.hidden = false;
}

/** The last batch's numbers, a line under the footer; gone on reload. */
function showStats(text) {
	const p = $('#stats');
	p.textContent = text;
	p.hidden = false;
}

/** The footer's version: the release, or branch and commit, when git archive filled them in. */
async function showBuild() {
	try {
		const r = await fetch('src/build.js', { cache: 'no-cache' });
		const link = r.ok ? buildLink(readBuild(await r.text())) : null;
		const a = $('#version');
		if (!link || !a) return;
		a.href = link.href;
		a.textContent = link.text;
	} catch { /* index.html's text stays */ }
}

async function loadData(force) {
	setStatus('#gm-status', 'loading…');
	try {
		const { gm, text, info } = await loadGameData(state.config, { force });
		state.ctx = makeContext(gm, text);
		state.rules = makeRules(text);
		state.gmInfo = info;
		const list = $('#species-list');
		list.replaceChildren(...Object.values(text.names).map(n => el('option', { value: n })));
	} catch (err) {
		state.ctx = null;
		state.gmInfo = { error: String(err.message || err) };
	}
	render();
}

// ---------- adding screenshots ----------

/**
 * Screenshots go through one queue. Files added while it runs (a second pick, a drop,
 * a paste) join the end of it: the first version started a second run on the same workers, and
 * the page showed only the second one, as if the first had been cancelled.
 */
async function addFiles(files) {
	files = [...files].filter(f => f.type.startsWith('image/') || /\.(png|jpe?g|heic|webp)$/i.test(f.name));
	if (!files.length) return;
	if (!state.ctx) {
		banner('bad', 'Game data is not loaded yet, so screenshots can\'t be scored. Check Settings.');
		return;
	}
	if (state.run) {
		state.run.files.push(...files);
		state.run.show();
		addWorkers(state.run);
		return;
	}
	const run = state.run = {
		started: Date.now(),	// the batch's scan time, on every row it touches
		files: files.slice(), results: [], next: 0, taken: 0, workers: [], loops: [],
		added: [], merged: new Set(), read: 0, withBars: 0,
		rules: RULES[state.config.lang] || rulesEn,
	};
	state.busy = true;
	const q = $('#queue');
	q.hidden = false;
	const prog = el('progress', { max: files.length, value: 0 });
	const line = el('p', { class: 'small' }, 'Starting the text recognition engine (first time: ~4 MB download)…');
	q.replaceChildren(line, prog);
	run.show = () => {
		prog.max = run.files.length;
		prog.value = run.taken;
		if (run.workers.length) line.textContent = `Read ${run.taken} of ${run.files.length}${run.workers.length > 1 ? ` (${run.workers.length} at a time)` : ''}`;
	};
	try {
		await addWorkers(run);
		// files added while this runs start more loops (addWorkers); wait until all are done
		for (;;) {
			const n = run.loops.length;
			await Promise.all(run.loops);
			if (run.loops.length !== n) continue;
			if (run.next < run.files.length) { await addWorkers(run, true); continue; }
			break;
		}
	} catch (err) {
		banner('bad', `Text recognition could not start: ${err.message}`);
	}
	// From here on, new files start a new run; it must see this run's rows, so they go into
	// the list before anything is awaited.
	state.run = null;
	const { added, merged } = run;
	if (added.length) state.rows.push(...added);
	if (added.length || merged.size) {
		await rowStore.putMany([...added, ...merged]);
		askPersist();
	}
	// What was just added is what one looks at next (readings to check, names to copy): the
	// list shows the newest first, and the sort button shows it isn't by score.
	if (added.length || merged.size || state.pendingDup.some(d => d.row.scanned === run.started)) {
		state.sort = { key: 'newest', dir: SORTS.newest.first };
	}
	// How long it took: for whoever wonders about speed, so in the footer, not a banner to dismiss
	if (run.taken) showStats(`${run.taken} screenshot${run.taken > 1 ? 's' : ''} read in ${duration(Date.now() - run.started)}.`);
	// None with the appraisal: the IVs can't be read. Point to the picture of what to take.
	if (run.read >= 2 && run.withBars === 0) {
		banner('info', `None of these ${run.read} screenshots shows the appraisal's bars, so the IVs are unknown.`,
			{ label: 'Which screenshots', run: () => openHelp('shots') });
	}
	if (!state.run) {
		state.busy = false;
		q.hidden = true;
	}
	render();
}

/**
 * As many workers as the files waiting can use (up to poolSize), each with a loop that reads the
 * next file until none is left. `restart`: loops ended while files were still being added.
 */
async function addWorkers(run, restart = false) {
	const want = Math.min(poolSize(state.config.ocrWorkers), run.workers.length + run.files.length - run.next);
	if (!restart && want <= run.workers.length) return;
	// each engine reads as soon as it is ready, the one started while the page was idle first
	const ws = await startWorkers(Math.max(want, 1), run.rules.tesseract);
	await Promise.allSettled(ws.map(p => p.then(w => {
		const fresh = !run.workers.includes(w);
		if (fresh) run.workers.push(w);
		if (fresh || restart) run.loops.push(readLoop(run, w));
		run.show();
	})));
}

/**
 * One engine's loop: the next file waiting, until none is left. It also takes the file after
 * that, to be decoded while the engine reads this one; not near the end, where another engine
 * may be free first.
 */
async function readLoop(run, w) {
	const reader = readerFor(w);
	const take = () => (run.next < run.files.length ? run.next++ : null);
	let i = take();
	while (i != null) {
		const next = run.files.length - run.next > run.workers.length ? take() : null;
		try {
			run.results[i] = await reader.read(run.files[i], next == null ? null : run.files[next], state.rules);
		} catch (err) {
			run.results[i] = { error: err };
		}
		drainRun(run);
		i = next ?? take();
	}
}

/**
 * Readings are taken in file order whatever worker was quicker, so the result doesn't
 * depend on timing: one screenshot's reading merges into a row, starts a row, or waits as a
 * duplicate.
 */
function drainRun(run) {
	while (run.taken < run.files.length && run.results[run.taken]) {
		takeReading(run, run.files[run.taken], run.results[run.taken], run.taken);
		run.results[run.taken] = true;	// free the reading
		run.taken++;
	}
	run.show();
}

function takeReading(run, f, res, idx) {
	const { added, merged } = run;
	if (res.error) { state.errors.push(`${f.name}: ${res.error.message || res.error}`); return; }
	const { reading, thumb } = res;
	run.read++;
	if (reading.bars) run.withBars++;
	const now = Date.now();
	// reading and edits: new objects, never changed in place from here on (state.rows)
	const row = { id: newId(), created: now, updated: now, scanned: run.started, scanIdx: idx, file: f.name, reading, edits: {}, thumb };
	// Another screenshot of a Pokémon already here (e.g. once with the appraisal, once
	// without the trainer in front): merge the readings.
	const all = state.rows.concat(added);
	const k = mergeTarget(all.map(r => r.reading), reading, state.ctx);
	if (k >= 0) {
		const t = all[k];
		t.reading = mergeReadings(t.reading, reading, state.ctx);	// a new object
		t.updated = now;
		// scanned again: it belongs to this batch now, at the place of its first screenshot here
		if (t.scanned !== run.started) { t.scanned = run.started; t.scanIdx = idx; }
		if (!added.includes(t)) merged.add(t);
		return;
	}
	const ev = evaluate(reading, state.ctx, row.edits);
	const existing = ev.key && state.rows.concat(added).find(r => keyOf(r) === ev.key);
	if (existing) state.pendingDup.push({ row, existing });
	else added.push(row);
}

/** 4.2 s, 38 s, 1 min 12 s */
function duration(ms) {
	if (ms < 9950) return `${(ms / 1000).toFixed(1)} s`;
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function keyOf(row) {
	return state.ctx ? evaluateRow(row.reading, state.ctx, row.edits).key : null;
}

async function resolveDuplicates(replace) {
	const list = state.pendingDup;
	state.pendingDup = [];
	if (replace) {
		for (const { row, existing } of list) {
			// keep the user's edits and in-game score, take the new reading and picture
			const next = { ...existing, reading: row.reading, thumb: row.thumb, file: row.file, updated: Date.now(), scanned: row.scanned, scanIdx: row.scanIdx };
			await rowStore.put(next);
			state.rows = state.rows.map(r => (r.id === existing.id ? next : r));
		}
	} else {
		const rows = list.map(d => d.row);
		await rowStore.putMany(rows);
		state.rows.push(...rows);
	}
	render();
}

// ---------- table ----------

/** Issues that need a look; notes (info) don't. */
const problems = e => e.issues.filter(i => !i.info);

function evaluated() {
	const keys = new Map();
	return state.rows.map(row => {
		// one row that can't be scored is marked to check; it must not take the list down
		const e = state.ctx ? evaluateRow(row.reading, state.ctx, row.edits) : null;
		if (e && e.key) keys.set(e.key, (keys.get(e.key) || 0) + 1);
		return { row, e };
	}).map(x => ({ ...x, dup: x.e && x.e.key && keys.get(x.e.key) > 1 }));
}

function render() {
	renderSettings();
	renderBanners();
	const all = evaluated().filter(x => x.e);
	const list = state.search ? all.filter(x => state.search(x.e)) : all;
	state.shown = list.map(x => x.row.id);
	// select mode acts on what is on screen only: a search drops marks on hidden rows
	if (state.search) for (const id of [...state.selected]) if (!state.shown.includes(id)) state.selected.delete(id);
	// Rows stored but the game data not ready yet: they can't be scored, so say they are coming
	// rather than show an empty or half list
	const loading = state.rows.length > 0 && !state.ctx && !(state.gmInfo && state.gmInfo.error);
	$('#loading').hidden = !loading;
	if (loading) $('#loading').textContent = `Loading ${state.rows.length} Pokémon…`;
	$('#empty').hidden = state.rows.length > 0;
	$('#table').hidden = list.length === 0;
	$('#search-wrap').hidden = state.rows.length === 0 || loading;
	$('#search-count').textContent = state.search ? `${list.length} of ${all.length}` : '';
	// "n to check" (as Actual's "n uncategorised transactions"): one tap filters to those rows
	const toCheck = all.filter(x => needsCheck(x.e)).length;
	const cf = $('#check-filter');
	cf.textContent = `${toCheck} to check`;
	cf.hidden = toCheck === 0 || $('#search').value.trim().toLowerCase() === 'check';
	$('#no-match').hidden = !(state.search && all.length && !list.length);
	renderListBar();
	const { key, dir } = state.sort;
	sortList(list, state.sort, MODES[state.mode].best);
	const ranks = scoreRanks(list, MODES[state.mode].best);
	for (const x of list) x.rank = ranks.get(x.row.id);
	for (const th of document.querySelectorAll('th[data-sort]')) {
		th.setAttribute('aria-sort', th.dataset.sort === key ? (dir > 0 ? 'ascending' : 'descending') : 'none');
	}
	renderSortMenu();
	renderRows(list);
	// with a ResizeObserver, measured only when a size changed (wire)
	if (!window.ResizeObserver) fitRows();
}

/**
 * The <tr> drawn for each row, with what it was drawn from. A row whose evaluated result and
 * state are unchanged keeps its <tr>: a sort, a search or a tap in select mode then redraws only
 * what changed, and the browser restyles and lays out far less (seconds on a phone with a
 * list of hundreds). Code that changes a drawn row's elements outside renderRow drops the
 * row's entry, so it is drawn afresh next time.
 */
const drawn = new Map();

/** Everything renderRow reads: when any of it changes, the row is drawn again. */
const drawnFrom = ({ row, e, dup }) => [e, row.thumb, dup, state.selecting, state.selected.has(row.id), state.findNext === row.id, state.nameTemplate];

function renderRows(list) {
	const nodes = list.map(x => {
		const from = drawnFrom(x);
		const d = drawn.get(x.row.id);
		if (d && d.from.every((v, i) => v === from[i])) return d.node;
		const node = renderRow(x);
		drawn.set(x.row.id, { from, node });
		return node;
	});
	list.forEach((x, i) => setRank(nodes[i], x.rank));
	const tbody = $('#rows'), old = [...tbody.children];
	if (old.length === nodes.length && old.every((n, i) => n.dataset.id === nodes[i].dataset.id)) {
		// the same rows in the same order: swap only those drawn again
		old.forEach((n, i) => { if (n !== nodes[i]) n.replaceWith(nodes[i]); });
	} else tbody.replaceChildren(...nodes);
	// rows deleted or replaced by an import are gone for good
	const ids = new Set(state.rows.map(r => r.id));
	for (const id of drawn.keys()) if (!ids.has(id)) drawn.delete(id);
}

/**
 * The rank badge is set apart from renderRow: a search changes the places of nearly every row
 * shown, and that must not draw them all again.
 */
function setRank(node, rank) {
	const b = node.querySelector('.rank'), text = rank ? String(rank) : '';
	if (b.textContent === text) return;
	b.textContent = text;
	b.classList.toggle('top', rank <= TOP);
	b.title = rank ? `${ordinal(rank)} by score in this list` : '';
}

// ---------- sort menu ----------

/** Pick a sort; picking the current one again turns its direction round. */
function setSort(key) {
	const best = MODES[state.mode].best;
	state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : firstDir(key, best) };
	render();
}

function renderSortMenu() {
	const { key, dir } = state.sort;
	const s = SORTS[key];
	const text = `Sort: ${s.label || $(`th[data-sort="${key}"]`).textContent.trim()}${s.dirs ? `, ${s.dirs[dir]}` : ''}`;
	const btn = $('#sort > summary');
	btn.setAttribute('aria-label', text);
	btn.title = text;
	// tinted while the list isn't in its usual order, since the button has no words to say so
	btn.classList.toggle('on', !isDefault(state.sort, MODES[state.mode].best));
	$('#sort-items').replaceChildren(...MENU.map(k => {
		const cur = k === key;
		return el('button', { class: 'item', type: 'button', 'aria-pressed': String(cur), onclick: () => { $('#sort').open = false; setSort(k); } },
			el('span', { class: 'chk', 'aria-hidden': 'true' }, cur ? '✓' : ''), SORTS[k].label,
			el('span', { class: 'dir' }, cur ? `${dir > 0 ? '↑' : '↓'} ${SORTS[k].dirs[dir]}` : ''));
	}));
}

// ---------- labels that give way on narrow screens ----------

/**
 * Where a row of buttons would be wider than the screen (a phone narrower than about 370 px),
 * its labels marked .lbl.give hide and the icons stay; where the table would be wider than the
 * window, its cells tighten. Measured, not guessed from the width:
 * the system font is not the same width everywhere.
 */
function fitRows() {
	for (const r of document.querySelectorAll('.fit')) {
		r.classList.remove('tight');
		if (r.scrollWidth > r.clientWidth + 1) r.classList.add('tight');
	}
}

/**
 * The score column: the computed score ± its band; where the score shown in game was entered,
 * that one (the list is sorted by it), with the computed one below.
 */
function scoreCell(e) {
	const calc = e.score ? [el('span', { class: 'score' }, e.score.total.toFixed(1)), el('span', { class: 'pm' }, `±${e.score.band.toFixed(1)}`)] : null;
	if (e.inGame == null) return calc || ['–'];
	return [el('span', { class: 'score', title: 'Score shown in game, entered by hand' }, String(e.inGame)), el('span', { class: 'pm' }, 'game'),
		e.score ? el('div', { class: 'pm', title: 'Computed score' }, `calc ${e.score.total.toFixed(1)}`) : null];
}

/** Places 1 to TOP get a tinted rank badge, so the end of the top ten stands out. */
const TOP = 10;
const ordinal = n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`;

function renderRow({ row, e, dup }) {
	const ivs = e.ivs ? `${e.ivs.a}/${e.ivs.d}/${e.ivs.s}` : '–';
	const status = dup ? el('span', { class: 'chip dup', title: 'Same species, catch date, height and weight as another row' }, 'duplicate')
		: problems(e).length ? el('span', { class: 'chip check', title: problems(e).map(i => i.msg).join('\n') }, 'check')
			: el('span', { class: 'chip ok' }, 'ok');
	// one span per item so a line never breaks inside "2.30 m"
	const meta = [e.cp != null ? `CP ${e.cp}` : null, e.types.replace('/', ' / '), `IV ${ivs}`, `${fmt(e.height_m)} m`, `${fmt(e.weight_kg)} kg`].filter(Boolean)
		.flatMap((t, i) => [i ? ' · ' : null, el('span', { class: 'nw' }, t)]);
	const sel = state.selecting && state.selected.has(row.id);
	// In select mode the find and copy buttons stay, dimmed and out of reach (a tap marks the
	// row): a card keeps its height, so the list doesn't jump when select mode ends.
	const btns = rowButtons(row.id, e);
	if (btns && state.selecting) btns.inert = true;
	const act = () => (state.selecting ? toggleSelected(row.id) : openEditor(row.id));
	return el('tr', {
		tabindex: 0, 'data-id': row.id, class: sel ? 'selected' : null,
		'aria-selected': state.selecting ? String(sel) : null,
		onclick: act, onkeydown: ev => { if (ev.key === 'Enter' || (state.selecting && ev.key === ' ')) { ev.preventDefault(); act(); } },
	},
		el('td', { class: 'c-thumb' }, row.thumb ? el('img', { src: row.thumb, alt: '', loading: 'lazy' }) : null,
			state.selecting ? el('span', { class: 'tick', 'aria-hidden': 'true' }, sel ? '✓' : '') : null),
		el('td', { class: 'c-num c-score' }, ...scoreCell(e)),
		el('td', { class: 'c-name name' }, el('span', { class: 'rank' }), e.name || e.id || '?', e.formName ? el('small', {}, ` ${e.formName}`) : null,
			e.xxl ? el('span', { class: 'xxl' }, 'XXL') : e.xxs ? el('span', { class: 'xxl' }, 'XXS') : null, el('div', { class: 'mobile-meta' }, meta)),
		el('td', { class: 'c-meta c-num', 'data-label': 'CP' }, e.cp ?? '–'),
		el('td', { class: 'c-meta', 'data-label': 'Type' }, e.types.replace('/', ' / ').toLowerCase()),
		el('td', { class: 'c-meta c-num', 'data-label': 'IVs' }, ivs),
		el('td', { class: 'c-meta c-num', 'data-label': 'Level' }, e.level ?? '–'),
		el('td', { class: 'c-meta c-num', 'data-label': 'Height' }, `${fmt(e.height_m)} m`),
		el('td', { class: 'c-meta c-num', 'data-label': 'Weight' }, `${fmt(e.weight_kg)} kg`),
		el('td', { class: 'c-meta', 'data-label': 'Caught' }, e.caught || '–'),
		el('td', { class: 'c-status' }, status, btns));
}

// ---------- select mode: mark rows, delete them together ----------

function renderListBar() {
	$('#list-bar').hidden = !state.selecting;
	$('#select-btn').hidden = state.rows.length === 0;
	$('#select-delete').disabled = state.selected.size === 0;
	$('#select-delete').textContent = state.selected.size ? `Delete ${state.selected.size}` : 'Delete';
	$('#select-all').textContent = state.shown.length && state.shown.every(id => state.selected.has(id)) ? 'None' : 'All';
	$('#list-count').textContent = `${state.selected.size} selected`;
	document.body.classList.toggle('selecting', state.selecting);
}

function toggleSelected(id) {
	if (state.selected.has(id)) state.selected.delete(id);
	else state.selected.add(id);
	render();
}

function setSelecting(on) {
	state.selecting = on;
	state.selected.clear();
	render();
}

async function deleteSelected() {
	const n = state.selected.size;
	if (!n || !window.confirm(`Delete ${n} Pokémon? Export first if you might want them back.`)) return;
	await rowStore.delMany([...state.selected]);
	state.rows = state.rows.filter(r => !state.selected.has(r.id));
	setSelecting(false);
}

// ---------- find in game, then copy the nickname ----------

/** One pill: find (a search for the game) on the left, the nickname on the right. */
function rowButtons(id, e) {
	const find = findButton(id, e), name = nameButton(id, e);
	return find || name ? el('span', { class: 'pair' }, find, name) : null;
}

function nameButton(id, e) {
	const n = formatName(state.nameTemplate, nameValues(e));
	if (n.missing.length) return null;
	const label = el('span', {}, n.text);
	const b = el('button', { class: `btn copy${state.findNext === id ? ' next' : ''}`, type: 'button', title: n.tooLong ? `Longer than the game allows (${n.length} > 12)` : 'Copy as nickname' }, icon('copy'), label);
	b.addEventListener('click', async ev => {
		ev.stopPropagation();
		const ok = await copyText(n.text);
		label.textContent = ok ? 'Copied' : 'Copy failed';
		b.classList.toggle('done', ok);
		if (ok && state.findNext === id) { state.findNext = null; b.classList.remove('next'); drawn.delete(id); }
		setTimeout(() => { label.textContent = n.text; b.classList.remove('done'); }, 1500);
	});
	b.addEventListener('keydown', ev => ev.stopPropagation());
	return b;
}

function findButton(id, e) {
	const q = gameSearch(e);
	if (!q) return null;
	const title = 'Copy a search that finds this Pokémon in the game';
	const b = el('button', { class: 'btn copy find', type: 'button', title, 'aria-label': title }, icon('scan-search'));
	b.addEventListener('click', async ev => {
		ev.stopPropagation();
		const ok = await copyText(q);
		// the page's search reads the game's syntax: what else in the list would it find?
		const p = compileSearch(q);
		const others = evaluated().filter(x => x.e && x.row.id !== id && p(x.e)).length;
		b.replaceChildren(icon(ok ? 'check' : 'scan-search'));
		b.classList.toggle('done', ok);
		setTimeout(() => { b.replaceChildren(icon('scan-search')); b.classList.remove('done'); }, 1500);
		if (ok) {
			document.querySelectorAll('.btn.copy.next').forEach(x => x.classList.remove('next'));
			// both rows' outlines change outside renderRow: draw them afresh next time (a row
			// hidden by the search would otherwise come back with the old outline)
			if (state.findNext != null) drawn.delete(state.findNext);
			drawn.delete(id);
			state.findNext = id;
			if (b.nextElementSibling) b.nextElementSibling.classList.add('next');
		}
		toast(!ok ? 'Couldn\'t copy. The search for the game:'
			: others ? `Search copied. It also fits ${others} other Pokémon in this list: compare height and weight in the game.`
				: 'Search copied. Paste it into the game\'s search.', q, !ok || others > 0);
	});
	b.addEventListener('keydown', ev => ev.stopPropagation());
	return b;
}

let toastTimer = null;
/** A note at the bottom of the screen, gone after a few seconds (longer for a warning) or a tap. */
function toast(msg, code, warn) {
	const t = $('#toast');
	t.onclick = () => { t.hidden = true; };
	t.replaceChildren(icon(warn ? 'triangle-alert' : 'check'), el('div', {}, el('b', {}, msg), code ? el('code', {}, code) : null));
	t.classList.toggle('warn', !!warn);
	t.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => { t.hidden = true; }, warn ? 6000 : 3000);
}

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// older browsers: a hidden textarea and execCommand
		const t = el('textarea', { readonly: true });
		// a property, not a style attribute: the Content-Security-Policy blocks those
		t.style.cssText = 'position:absolute;left:-9999px';
		t.value = text;
		document.body.append(t);
		t.select();
		let ok = false;
		try { ok = document.execCommand('copy'); } catch { /* nothing left to try */ }
		t.remove();
		return ok;
	}
}

// ---------- paste (iOS "Copy & Delete" screenshots, Cmd+V on a Mac) ----------

async function pasteFromClipboard() {
	if (!navigator.clipboard || !navigator.clipboard.read) {
		banner('bad', 'This browser can\'t read images from the clipboard. Use Add screenshots instead.');
		return;
	}
	try {
		const files = [];
		for (const item of await navigator.clipboard.read()) {
			const type = item.types.find(t => t.startsWith('image/'));
			if (type) {
				const blob = await item.getType(type);
				files.push(new File([blob], `pasted-${new Date().toISOString().slice(11, 19)}.${type.split('/')[1]}`, { type }));
			}
		}
		if (files.length) addFiles(files);
		else banner('info', 'No image on the clipboard. Take a screenshot, then "Copy & Delete" (or copy it in Photos).');
	} catch (err) {
		if (err && err.name === 'NotAllowedError') return;	// user didn't confirm the paste
		banner('bad', `Paste failed: ${err.message || err}`);
	}
}

// ---------- editor ----------

let editing = null;

function openEditor(id) {
	const row = state.rows.find(r => r.id === id);
	if (!row || !state.ctx) return;
	editing = row;
	const e = evaluateRow(row.reading, state.ctx, row.edits);
	const r = row.reading, ed = row.edits;
	$('#ed-thumb').src = row.thumb || '';
	$('#ed-title').textContent = `${e.name || '?'}${e.formName ? ' ' + e.formName : ''}${e.xxl ? ' · XXL' : ''}`;
	$('#ed-score').textContent = e.score
		? `${e.score.total.toFixed(1)} ± ${e.score.band.toFixed(1)}  (height ${e.score.hPart.toFixed(1)} + weight ${e.score.wPart.toFixed(1)} + IV ${e.score.ivPart.toFixed(1)} + XXL ${e.score.bonus})`
		: 'No score yet: see below';
	$('#ed-issues').replaceChildren(...e.issues.map(i => el('li', { class: i.info ? 'info' : null }, i.msg)));
	$('#ed-species').value = e.name || r.species || '';
	$('#ed-form-sel').replaceChildren(
		el('option', { value: '' }, 'automatic'),
		...e.forms.map(f => el('option', { value: f === '' ? '-' : f, selected: ed.form != null && ed.form === f }, formLabel(f) || 'normal')));
	const val = (k, fallback) => ed[k] ?? fallback ?? '';
	// the values as used (repaired or corrected ones included); saving records them as edits
	$('#ed-cp').value = val('cp', e.cp);
	$('#ed-hp').value = val('hp', e.hp);
	$('#ed-height').value = val('height_m', e.height_m);
	$('#ed-weight').value = val('weight_kg', e.weight_kg);
	const iv = ed.ivs || e.ivs || {};
	$('#ed-a').value = iv.a ?? '';
	$('#ed-d').value = iv.d ?? '';
	$('#ed-s').value = iv.s ?? '';
	$('#ed-xxl').value = ed.xxl == null ? '' : ed.xxl ? '1' : '0';
	$('#ed-caught').value = val('caught', r.caught);
	$('#ed-ingame').value = ed.inGame ?? '';
	const cands = e.candidates || [];
	$('#ed-cands-wrap').hidden = cands.length < 2;
	$('#ed-cands').replaceChildren(...cands.map(c => el('li', {},
		el('button', { type: 'button', onclick: () => { $('#ed-a').value = c.a; $('#ed-d').value = c.d; $('#ed-s').value = c.s; } },
			`${c.a}/${c.d}/${c.s} L${c.level}`))));
	$('#editor').showModal();
	// focus the title, not the first input: no keyboard sliding up over the details on phones
	$('#ed-title').focus({ preventScroll: true });
}

const numOrNull = (s, int = false) => {
	const t = String(s).trim().replace(',', '.');
	if (t === '') return null;
	const n = Number(t);
	return Number.isFinite(n) ? (int ? Math.round(n) : n) : null;
};

async function closeEditor(ev) {
	const action = $('#editor').returnValue;
	const row = editing;
	editing = null;
	if (!row) return;
	if (action === 'delete') {
		if (!confirmDelete(row)) return;
		await rowStore.del(row.id);
		state.rows = state.rows.filter(r => r.id !== row.id);
		render();
		return;
	}
	if (action !== 'save') return;
	const r = row.reading;
	// a new object, complete before it is stored, never changed after (state.rows)
	const edits = {};
	const diff = (k, v, orig) => { if (v != null && v !== orig) edits[k] = v; };
	const name = $('#ed-species').value.trim();
	if (name && name !== (r.species || '')) {
		const dex = findDex(name, state.ctx.names);
		const id = dex != null ? (state.ctx.dex.get(dex) || [])[0] : null;
		if (id) edits.id = id;
	}
	const form = $('#ed-form-sel').value;
	if (form) edits.form = form === '-' ? '' : form;
	diff('cp', numOrNull($('#ed-cp').value, true), r.cp);
	diff('hp', numOrNull($('#ed-hp').value, true), r.hp);
	diff('height_m', numOrNull($('#ed-height').value), r.height_m);
	diff('weight_kg', numOrNull($('#ed-weight').value), r.weight_kg);
	const caught = $('#ed-caught').value.trim();
	if (caught && caught !== r.caught) edits.caught = caught;
	const a = numOrNull($('#ed-a').value, true), d = numOrNull($('#ed-d').value, true), s = numOrNull($('#ed-s').value, true);
	const auto = evaluateSafely(r, state.ctx, { ...edits, ivs: undefined }).ivs;
	if ([a, d, s].every(x => x != null && x >= 0 && x <= 15) && !(auto && auto.a === a && auto.d === d && auto.s === s)) edits.ivs = { a, d, s };
	const x = $('#ed-xxl').value;
	if (x) edits.xxl = x === '1';
	const ig = numOrNull($('#ed-ingame').value);
	if (ig != null) edits.inGame = ig;
	const next = { ...row, edits, updated: Date.now() };
	await rowStore.put(next);
	state.rows = state.rows.map(q => (q.id === row.id ? next : q));
	render();
}

function confirmDelete(row) {
	return window.confirm(`Delete this row${row.file ? ` (${row.file})` : ''}?`);
}

// ---------- backup ----------

async function exportRows() {
	const data = { app: 'xxl-scorer', v: 1, exported: new Date().toISOString(), rows: state.rows };
	// the "Name to copy" template goes along once it was set, so a restore brings it back
	if (state.nameTemplateAt >= 0) data.settings = { nameTemplate: state.nameTemplate, nameTemplateAt: state.nameTemplateAt };
	const d = new Date();	// the local date: a backup made after midnight is the new day's
	const name = `xxl-scorer-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.json`;
	const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
	let done = false;
	try {
		// The share sheet on phones and tablets ("Save to Files"); a plain download elsewhere: on
		// the Mac the share sheet's Copy pasted the file twice into the Finder.
		const touch = matchMedia('(pointer: coarse)').matches;
		if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
			await navigator.share({ files: [file] });
			done = true;
		}
	} catch (err) {
		if (err && err.name === 'AbortError') return;	// user closed the share sheet
	}
	if (!done) {
		const url = URL.createObjectURL(file);
		const a = el('a', { href: url, download: name });
		document.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10000);
	}
	state.lastExport = Date.now();
	await kv.set('lastExport', state.lastExport);
	render();
}

async function importRows(file) {
	let data;
	try {
		data = JSON.parse(await file.text());
		if (data.app !== 'xxl-scorer' || !Array.isArray(data.rows)) throw new Error('not an xxl-scorer export');
	} catch (err) {
		banner('bad', `Import failed: ${err.message}`);
		return;
	}
	try {
		const byId = new Map(state.rows.map(r => [r.id, r]));
		const byKey = new Map(state.rows.map(r => [keyOf(r), r]).filter(([k]) => k));
		let added = 0, updated = 0, bad = 0;
		const put = [];
		// only known fields of the expected types: a backup file can come from anywhere
		for (const raw of data.rows.slice(0, 50_000)) {
			const r = cleanRow(raw);
			if (!r) { bad++; continue; }
			const mine = byId.get(r.id) || byKey.get(state.ctx ? evaluateSafely(r.reading, state.ctx, r.edits).key : null);
			if (!mine) { put.push(r); added++; }
			else if ((r.updated || 0) > (mine.updated || 0)) { put.push({ ...r, id: mine.id }); updated++; }
		}
		await rowStore.putMany(put);
		state.rows = await rowStore.all();
		const tpl = await importSettings(data.settings);
		banner('info', `Imported: ${added} new, ${updated} updated, ${data.rows.length - added - updated - bad} already up to date${bad ? `, ${bad} not readable` : ''}.${tpl ? ` Name to copy: ${tpl}` : ''}`);
	} catch (err) {
		// storage full or refused, or anything else: say so rather than fail silently
		banner('bad', `Import failed: ${err.message || err}`);
	}
	render();
}

/**
 * A backup's "Name to copy" template, when it was set later than the one here. Returns the
 * template when it changed the list's nicknames, for the import's message.
 */
async function importSettings(raw) {
	const s = cleanSettings(raw);
	if (!s.nameTemplate || s.nameTemplateAt <= state.nameTemplateAt) return null;
	const changed = s.nameTemplate !== state.nameTemplate;
	await setTemplate(s.nameTemplate, s.nameTemplateAt);
	$('#name-tpl').value = state.nameTemplate;
	return changed ? state.nameTemplate : null;
}

/** The "Name to copy" template, kept with the time it was set (newer wins on import). */
async function setTemplate(t, at) {
	state.nameTemplate = t;
	state.nameTemplateAt = at;
	await kv.set('nameTemplate', t);
	await kv.set('nameTemplateAt', at);
}

// ---------- banners and settings ----------

const transient = [];
function banner(kind, text, action = null) {
	transient.push({ kind, text, action });
	renderBanners();
}

async function renderBanners() {
	const box = $('#banners');
	const out = [];
	const close = i => () => { transient.splice(i, 1); renderBanners(); };
	transient.forEach((b, i) => out.push(el('div', { class: `banner ${b.kind}` }, el('p', {}, b.text),
		b.action ? el('button', { class: 'btn', type: 'button', onclick: () => { close(i)(); b.action.run(); } }, b.action.label) : null,
		el('button', { class: 'btn ghost', type: 'button', onclick: close(i) }, 'OK'))));
	if (state.gmInfo && state.gmInfo.error && !state.ctx) {
		out.push(el('div', { class: 'banner bad' }, el('p', {}, `Game data could not be loaded: ${state.gmInfo.error}. Without it nothing can be scored.`),
			el('button', { class: 'btn', type: 'button', onclick: () => loadData(true) }, 'Try again')));
	}
	if (state.ctx && state.ctx.gm.coef.xxlAdj !== 1) {
		out.push(el('div', { class: 'banner bad' }, el('p', {}, `The game data changed a scoring factor this tool doesn't understand yet (xxlAdjustmentFactor = ${state.ctx.gm.coef.xxlAdj}). Scores may be off.`)));
	}
	// the game data lists a smallest-size showcase (ranking MIN): offer XXS mode once
	if (state.ctx && (state.ctx.gm.coef.rankings || []).includes('MIN') && state.mode !== 'xxs' && !state.minHintSeen) {
		const seen = async () => { state.minHintSeen = true; await kv.set('minHintSeen', true); };
		out.push(el('div', { class: 'banner info' }, el('p', {}, 'The game data now lists showcases for the smallest Pokémon. Switch to XXS mode, where the lowest score wins?'),
			el('button', { class: 'btn', type: 'button', onclick: async () => { await seen(); setMode('xxs'); } }, 'XXS mode'),
			el('button', { class: 'btn ghost', type: 'button', onclick: async () => { await seen(); renderBanners(); } }, 'Not now')));
	}
	if (state.pendingDup.length) {
		const n = state.pendingDup.length;
		out.push(el('div', { class: 'banner info' }, el('p', {}, `${n} screenshot${n > 1 ? 's match Pokémon' : ' matches a Pokémon'} already in the list (same species, catch date, height and weight).`),
			el('button', { class: 'btn', type: 'button', onclick: () => resolveDuplicates(true) }, 'Replace'),
			el('button', { class: 'btn ghost', type: 'button', onclick: () => resolveDuplicates(false) }, 'Keep both')));
	}
	if (state.errors.length) {
		const errs = state.errors.splice(0);
		transient.push({ kind: 'bad', text: `Could not read: ${errs.join('; ')}` });
		return renderBanners();
	}
	// Unexported changes: a dot on the Export button. A banner only once a change has waited
	// long enough that Safari's 7-day rule could take it.
	const last = state.lastExport || 0;
	const pending = state.rows.filter(r => (r.updated || 0) > last);
	const changes = pending.length + (state.nameTemplateAt > last ? 1 : 0);	// a new template counts too
	$('#export-dot').hidden = changes === 0;
	$('#backup > summary').title = changes ? `${changes} change${changes > 1 ? 's' : ''} not exported yet` : 'Export or import a backup';
	const oldest = pending.length ? Math.min(...pending.map(r => r.updated || 0)) : Infinity;
	if (Date.now() - oldest > EXPORT_NAG_DAYS * DAY) {
		out.push(el('div', { class: 'banner' }, el('p', {}, `Some changes are ${EXPORT_NAG_DAYS}+ days old and not exported. Safari deletes a site's data after 7 days without a visit.`),
			el('button', { class: 'btn', type: 'button', onclick: exportRows }, 'Export')));
	}
	box.replaceChildren(...out);
}

function setStatus(sel, text) { $(sel).textContent = text; }

/** Switch between the biggest (XXL) and the smallest (XXS) showcase; the score list re-sorts. */
async function setMode(mode) {
	state.mode = mode === 'xxs' ? 'xxs' : 'xxl';
	await kv.set('mode', state.mode);
	state.sort = { key: 'score', dir: MODES[state.mode].best };
	render();
}

function renderMode() {
	const xxs = state.mode === 'xxs';
	$('#mode-xxl').setAttribute('aria-pressed', String(!xxs));
	$('#mode-xxs').setAttribute('aria-pressed', String(xxs));
	$('#mode-line').hidden = !xxs;
	document.body.classList.toggle('mode-xxs', xxs);
	const th = document.querySelector('th[data-sort="score"]');
	if (th) th.title = xxs ? 'XXS mode: the lowest score wins' : 'The highest score wins';
}

function renderSettings() {
	renderMode();
	const i = state.gmInfo;
	if (state.ctx && i) {
		const n = Object.keys(state.ctx.gm.species).length;
		const date = i.changed ? new Date(i.changed).toLocaleDateString() : '?';
		const checked = i.checked ? new Date(i.checked).toLocaleString() : '?';
		setStatus('#gm-status', `${n} species from ${i.source}, changed ${date}, checked ${checked}${i.error ? ` (last check failed: ${i.error})` : ''}`);
	} else if (i && i.error) setStatus('#gm-status', `not loaded: ${i.error}`);
	setStatus('#store-status', `${state.rows.length} Pokémon`);
	setStatus('#export-status', state.lastExport ? new Date(state.lastExport).toLocaleString() : 'never');
	const sample = state.ctx && state.rows.length ? evaluateRow(state.rows[0].reading, state.ctx, state.rows[0].edits) : { name: 'Chansey', ivs: { a: 15, d: 14, s: 14 }, level: 20, xxl: true, score: { total: 1104.6 } };
	const n = formatName(state.nameTemplate, nameValues(sample));
	setStatus('#name-example', `${n.text}${n.tooLong ? ` (${n.length} characters: too long for the game)` : ''}`);
}

// ---------- help: searching the list, which screenshots to take ----------

/** The help dialog, at its top (the search terms) or, with 'shots', at which screenshots to take. */
function openHelp(section) {
	const d = $('#help'), h = $(section === 'shots' ? '#help-shots' : '#help-title');
	d.showModal();
	h.focus({ preventScroll: true });
	// the section's heading at the dialog's top (focus alone scrolls it just into view)
	d.scrollTop = section === 'shots' ? h.offsetTop - 12 : 0;
}

// ---------- wiring ----------

function wire() {
	$('#add').addEventListener('change', ev => { addFiles(ev.target.files); ev.target.value = ''; });
	// all engines started while the picker is open: choosing takes a while, starting them too
	const warmAll = () => warmUp(poolSize(state.config.ocrWorkers), tesseractLang());
	$('#add').addEventListener('click', warmAll);
	$('#import').addEventListener('change', ev => { const f = ev.target.files[0]; ev.target.value = ''; if (f) importRows(f); });
	$('#export').addEventListener('click', () => { $('#backup').open = false; exportRows(); });
	$('#import').addEventListener('click', () => { $('#backup').open = false; });
	document.addEventListener('click', ev => {
		if (!ev.target.closest('#backup')) $('#backup').open = false;
		if (!ev.target.closest('#sort')) $('#sort').open = false;
	});
	addEventListener('keydown', ev => {
		if (ev.key !== 'Escape') return;
		for (const m of ['#backup', '#sort']) if ($(m).open) { $(m).open = false; $(`${m} > summary`).focus(); }
	});
	// Measured again when a row's width changes (it follows the screen's; hiding a label doesn't
	// change it, so no loop) or what is in it does: the table with a longer name or a count with
	// another digit. Not at every render: each row measured is a layout of the whole list.
	if (window.ResizeObserver) {
		const ro = new ResizeObserver(fitRows);
		for (const r of document.querySelectorAll('.fit')) {
			ro.observe(r);
			for (const c of r.children) ro.observe(c);
		}
	} else addEventListener('resize', fitRows);
	$('#paste').addEventListener('click', pasteFromClipboard);
	$('#select-btn').addEventListener('click', () => setSelecting(true));
	$('#select-done').addEventListener('click', () => setSelecting(false));
	$('#select-delete').addEventListener('click', deleteSelected);
	$('#select-all').addEventListener('click', () => {
		if (state.shown.every(id => state.selected.has(id))) state.selected.clear();
		else for (const id of state.shown) state.selected.add(id);
		render();
	});
	const setSearch = q => {
		state.search = compileSearch(q);
		$('#search-clear').hidden = q === '';
		render();
	};
	$('#search').addEventListener('input', ev => setSearch(ev.target.value));
	$('#check-filter').addEventListener('click', () => {
		$('#search').value = 'check';
		setSearch('check');
	});
	// keep the keyboard as it was: a tap on the button doesn't take the focus from the field
	$('#search-clear').addEventListener('pointerdown', ev => ev.preventDefault());
	$('#search-clear').addEventListener('click', () => {
		$('#search').value = '';
		setSearch('');
	});
	addEventListener('keydown', ev => { if (ev.key === 'Escape' && state.selecting && !$('#editor').open) setSelecting(false); });
	addEventListener('paste', ev => {
		if (ev.target.closest && ev.target.closest('input, textarea')) return;
		const files = [...(ev.clipboardData ? ev.clipboardData.files : [])].filter(f => f.type.startsWith('image/'));
		if (files.length) { ev.preventDefault(); addFiles(files); }
	});
	// Every row's nickname follows the template, so a change draws the whole list again: once
	// typing pauses, not on each keystroke. Leaving the field takes it at once.
	let tplTimer = null;
	const takeTemplate = async () => {
		clearTimeout(tplTimer);
		const t = $('#name-tpl').value.trim() || DEFAULT_TEMPLATE;
		if (t === state.nameTemplate) return;
		await setTemplate(t, Date.now());
		render();
	};
	$('#name-tpl').addEventListener('input', () => {
		clearTimeout(tplTimer);
		tplTimer = setTimeout(takeTemplate, TEMPLATE_PAUSE);
	});
	$('#name-tpl').addEventListener('change', takeTemplate);
	for (const slot of document.querySelectorAll('.hf-slot')) slot.replaceChildren(phoneElement(slot.dataset.phone));
	$('#help-btn').addEventListener('click', () => openHelp());
	for (const b of document.querySelectorAll('[data-help]')) b.addEventListener('click', () => openHelp('shots'));
	$('#mode-xxl').addEventListener('click', () => setMode('xxl'));
	$('#mode-xxs').addEventListener('click', () => setMode('xxs'));
	$('#mode-chip').addEventListener('click', () => setMode('xxl'));
	$('#settings-btn').addEventListener('click', ev => {
		const s = $('#settings');
		s.hidden = !s.hidden;
		ev.currentTarget.setAttribute('aria-expanded', String(!s.hidden));
	});
	$('#gm-refresh').addEventListener('click', async () => { await dropImportedGameData(); await loadData(true); });
	$('#gm-import').addEventListener('change', async ev => {
		const f = ev.target.files[0];
		ev.target.value = '';
		if (!f) return;
		try { await importGameData(f); await loadData(false); banner('info', 'Game data imported.'); } catch (err) { banner('bad', `Game data import failed: ${err.message}`); }
	});
	$('#clear').addEventListener('click', async () => {
		if (!window.confirm(`Delete all ${state.rows.length} rows? Export first if you want to keep them.`)) return;
		await rowStore.clear();
		state.rows = [];
		render();
	});
	for (const th of document.querySelectorAll('th[data-sort]')) {
		th.tabIndex = 0;
		// first tap: the best first (score: highest, lowest in XXS mode), names A-Z
		const go = () => setSort(th.dataset.sort);
		th.addEventListener('click', go);
		th.addEventListener('keydown', ev => { if (ev.key === 'Enter') go(); });
	}
	$('#editor').addEventListener('close', closeEditor);
	// drag and drop anywhere on the page
	let depth = 0;
	const drop = $('#drop');
	addEventListener('dragenter', ev => { if ([...ev.dataTransfer.types].includes('Files')) { depth++; drop.hidden = false; warmAll(); } });
	addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
	addEventListener('dragover', ev => ev.preventDefault());
	addEventListener('drop', ev => {
		ev.preventDefault();
		depth = 0;
		drop.hidden = true;
		if (ev.dataTransfer.files.length) addFiles(ev.dataTransfer.files);
	});
}

/**
 * Shown instead of the page when another site puts it in a frame. Hosts that can send headers
 * forbid that with frame-ancestors (contrib/nginx); static hosts like GitHub Pages can't, and a
 * meta tag can't carry it. So the page refuses to run where it can't be seen whole.
 */
function framed() {
	document.body.replaceChildren(el('main', {},
		el('div', { class: 'banner bad' }, el('p', {},
			'xxl-scorer runs only as a page of its own, not inside another site. ',
			el('a', { href: location.href, target: '_blank', rel: 'noopener noreferrer' }, 'Open it directly'),
			'.'))));
}

if (window.top === window.self) boot();
else framed();
