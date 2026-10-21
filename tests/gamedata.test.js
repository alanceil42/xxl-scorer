// Game data in the browser (src/ui/gamedata.js): which copy is used when (a fresh stored one,
// the source, an older stored one, an imported file) and when the source is asked. IndexedDB,
// fetch and the clock are stood in for; the game data is synthetic.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadGameData, importGameData, dropImportedGameData } from '../src/ui/gamedata.js';
import { GM_URL, compactGameMaster } from '../src/core/gm.js';
import { textUrl } from '../src/core/text.js';
import { syntheticGameMaster, syntheticText } from './synthetic.js';

const DAY = 24 * 3600 * 1000;
const HOST = 'https://xxl.example.org/xxl/';

/** An in-memory IndexedDB, just enough for src/ui/db.js: requests and transactions complete later, values are copied. */
function fakeIndexedDB() {
	const stores = new Map();
	const later = f => setTimeout(f);
	const request = get => {
		const q = {};
		later(() => { q.result = get(); q.onsuccess(); });
		return q;
	};
	const db = {
		objectStoreNames: { contains: n => stores.has(n) },
		createObjectStore: n => { stores.set(n, new Map()); },
		transaction(name) {
			const data = stores.get(name);
			const t = {
				objectStore: () => ({
					get: k => request(() => structuredClone(data.get(k))),
					put: (v, k) => { data.set(k, structuredClone(v)); },
				}),
			};
			later(() => later(() => t.oncomplete()));	// after the requests made now
			return t;
		},
	};
	return {
		stores,
		open() {
			const req = { result: db };
			later(() => { req.onupgradeneeded(); req.onsuccess(); });
			return req;
		},
	};
}

/** A game master with enough species to pass the format guard (900): the synthetic one plus fillers. */
function bigGameMaster(heightOfFirst = 1.0) {
	const all = syntheticGameMaster();
	all[1].data.pokemonSettings.pokedexHeightM = heightOfFirst;	// TESTMON: tells versions apart
	for (let i = 0; i < 900; i++) {
		const dex = String(i + 1).padStart(4, '0');
		all.push({ templateId: `V${dex}_POKEMON_FILLER${i}`, data: { pokemonSettings: {
			pokemonId: `FILLER${i}`, type: 'POKEMON_TYPE_NORMAL', pokedexHeightM: 1, pokedexWeightKg: 10, stats: { baseAttack: 100, baseDefense: 100, baseStamina: 100 },
		} } });
	}
	return all;
}

const idb = fakeIndexedDB();
globalThis.indexedDB = idb;
globalThis.location = { href: HOST };
let now = 1_800_000_000_000;
Date.now = () => now;

// what the source answers, by URL: a body, an HTTP status, or a network error
let net = {};
const fetched = [];
globalThis.fetch = async (url, opts) => {
	fetched.push({ url, opts });
	const r = net[url];
	if (r instanceof Error) throw r;
	if (typeof r === 'number') return { ok: false, status: r, text: async () => '' };
	if (r === undefined) return { ok: false, status: 404, text: async () => '' };
	return { ok: true, status: 200, text: async () => r };
};

const upstream = (gm = bigGameMaster()) => ({ [GM_URL]: JSON.stringify(gm), [textUrl('en')]: JSON.stringify(syntheticText('en')) });
const heightOf = gm => gm.species.TESTMON.f[''][0];

beforeEach(() => {
	for (const s of idb.stores.values()) s.clear();
	fetched.length = 0;
	net = {};
});

test('first visit: game master and text table fetched from PokeMiners, compacted, kept', async () => {
	net = upstream();
	const r = await loadGameData({ gm: 'upstream', lang: 'en' });
	assert.equal(r.info.state, 'new');
	assert.equal(r.info.source, 'PokeMiners (GitHub)');
	assert.equal(r.text.names['9001'], 'Testmon');
	assert.equal(heightOf(r.gm), 1.0);
	assert.deepEqual(fetched.map(f => f.url), [GM_URL, textUrl('en')]);
	for (const f of fetched) assert.equal(f.opts.cache, 'no-cache', 'the browser revalidates with its own cache');
	assert.equal(r.info.changed, now);
});

test('asked again only after "gmCheckDays"; an unchanged file is not compacted again', async () => {
	net = upstream();
	const t0 = now;
	await loadGameData({});
	now += 6 * DAY;
	assert.equal((await loadGameData({})).info.state, 'fresh');
	assert.equal(fetched.length, 2, 'within 7 days: not asked');
	now += 2 * DAY;
	const r = await loadGameData({});
	assert.equal(r.info.state, 'unchanged');
	assert.equal(fetched.length, 4);
	assert.equal(r.info.changed, t0, 'still the data of the first visit');
	assert.equal(r.info.checked, now);
	now += DAY;
	assert.equal((await loadGameData({ gmCheckDays: 1 })).info.state, 'unchanged', 'a shorter interval from config.json');
	now += DAY;
	assert.equal((await loadGameData({ gmCheckDays: 30 })).info.state, 'fresh');
});

test('new data upstream replaces the stored copy; "Check for new game data" asks at once', async () => {
	net = upstream();
	await loadGameData({});
	net = upstream(bigGameMaster(1.1));
	assert.equal(heightOf((await loadGameData({})).gm), 1.0, 'fresh: not asked');
	const r = await loadGameData({}, { force: true });
	assert.equal(r.info.state, 'updated');
	assert.equal(heightOf(r.gm), 1.1);
});

test('the source unreachable: the stored copy of any age, with the error; none stored, an error', async () => {
	net = { [GM_URL]: new Error('offline'), [textUrl('en')]: 503 };
	await assert.rejects(loadGameData({}), /offline/);
	net = upstream();
	await loadGameData({});
	now += 100 * DAY;
	net = { [GM_URL]: new Error('offline'), [textUrl('en')]: 503 };
	const r = await loadGameData({});
	assert.equal(r.info.state, 'stale');
	assert.equal(r.info.error, 'offline');
	assert.equal(r.text.names['9001'], 'Testmon');
	net = { [GM_URL]: JSON.stringify([{ templateId: 'NOTHING' }]), [textUrl('en')]: 503 };
	assert.match((await loadGameData({}, { force: true })).info.error, /only 0 species/, 'a changed format is an error too');
});

test('"gm": "off": no request at all, the stored copy of any age, or a request to import', async () => {
	await assert.rejects(loadGameData({ gm: 'off' }), /No game data stored yet; import a file/);
	assert.equal(fetched.length, 0);
	net = upstream();
	await loadGameData({});
	fetched.length = 0;
	now += 100 * DAY;
	const r = await loadGameData({ gm: 'off' }, { force: true });
	assert.equal(r.info.state, 'stale');
	assert.equal(fetched.length, 0);
});

test('an imported game master is used instead of the source until it is dropped', async () => {
	net = upstream();
	await assert.rejects(importGameData({ name: 'notes.json', text: async () => '{"a": 1}' }), /Neither a game master/);
	const gm = await importGameData({ name: 'latest.json', text: async () => JSON.stringify(bigGameMaster(1.2)) });
	assert.equal(heightOf(gm), 1.2);
	assert.deepEqual(gm.source, { url: 'latest.json', etag: 'import' });
	const r = await loadGameData({});
	assert.equal(r.info.source, 'imported file');
	assert.equal(r.info.state, 'imported');
	assert.equal(heightOf(r.gm), 1.2);
	assert.deepEqual(fetched.map(f => f.url), [textUrl('en')], 'the text table still comes from the source');
	assert.equal(heightOf((await loadGameData({}, { force: true })).gm), 1.0, 'Check for new game data: the source');
	await dropImportedGameData();
	assert.equal((await loadGameData({})).info.source, 'PokeMiners (GitHub)');
	// a compact gm.json is taken as it is
	const compact = compactGameMaster(bigGameMaster(1.3));
	assert.equal(heightOf(await importGameData({ name: 'gm.json', text: async () => JSON.stringify(compact) })), 1.3);
});

test('a self-hosted gm.json: relative to the page, text tables included, checked', async () => {
	const url = `${HOST}local/data/gm.json`;
	const gm = { ...compactGameMaster(bigGameMaster(1.4)), text: { en: { names: { 9001: 'Testmon' }, caught: {}, hp: 'HP', kg: 'kg', m: 'm' } } };
	net = { [url]: JSON.stringify(gm) };
	const r = await loadGameData({ gm: 'local/data/gm.json', lang: 'en' });
	assert.equal(r.info.source, url);
	assert.equal(r.info.state, 'new');
	assert.equal(heightOf(r.gm), 1.4);
	assert.equal(r.text.names['9001'], 'Testmon');
	assert.deepEqual(fetched.map(f => f.url), [url], 'nothing from PokeMiners');
	await assert.rejects(loadGameData({ gm: 'local/data/gm.json', lang: 'de' }), /has no text table for "de" \(build it with -l de\)/);
});

test('a self-hosted file that is not a gm.json is refused', async () => {
	net = { [`${HOST}other.json`]: JSON.stringify({ v: 1 }) };
	await assert.rejects(loadGameData({ gm: 'other.json' }), /not a gm\.json/);
});
