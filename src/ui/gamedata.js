// Game data in the browser: fetch from PokeMiners (or the host's gm.json), compact, cache.
import { compactGameMaster, isCompactGm, GM_URL } from '../core/gm.js';
import { compactText, textUrl } from '../core/text.js';
import { kv } from './db.js';

const DAY = 24 * 3600 * 1000;
export const DEFAULT_CHECK_DAYS = 7;

/** config.json "gmCheckDays": how often to ask upstream for new game data. */
export function checkInterval(config) {
	const d = Number(config.gmCheckDays ?? DEFAULT_CHECK_DAYS);
	return (Number.isFinite(d) && d > 0 ? d : DEFAULT_CHECK_DAYS) * DAY;
}

/** Cheap fingerprint of a response body, to skip re-compacting an unchanged file. */
function fingerprint(s) {
	let h = 0x811c9dc5;
	const step = Math.max(1, Math.floor(s.length / 200000));	// sample ~200k chars
	for (let i = 0; i < s.length; i += step) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return `${s.length}:${(h >>> 0).toString(16)}`;
}

/**
 * The browser revalidates with its own HTTP cache (ETag, If-None-Match): cache: 'no-cache' costs a
 * 304 when nothing changed. Pages can't read GitHub's ETag cross-origin, hence the fingerprint.
 */
async function fetchText(url) {
	const r = await fetch(url, { cache: 'no-cache' });
	if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
	return r.text();
}

async function cached(key, url, compact, { force = false, offline = false, maxAge = DEFAULT_CHECK_DAYS * DAY } = {}) {
	// a copy from another source (config.json's "gm" changed to another gm.json) counts as none,
	// fresh or not: it is not what the site is set to use
	const stored = await kv.get(key);
	const c = stored && stored.url === url ? stored : null;
	if (c && !force && Date.now() - c.checked < maxAge) return { ...c, state: 'fresh' };
	if (offline) return c ? { ...c, state: 'stale' } : null;
	try {
		const body = await fetchText(url);
		const fp = fingerprint(body);
		const now = Date.now();
		if (c && c.fp === fp) {
			const next = { ...c, checked: now };
			await kv.set(key, next);
			return { ...next, state: 'unchanged' };
		}
		const data = compact(JSON.parse(body));
		const next = { data, fp, url, checked: now, changed: now };
		await kv.set(key, next);
		return { ...next, state: c ? 'updated' : 'new' };
	} catch (err) {
		if (c) return { ...c, state: 'stale', error: String(err.message || err) };
		throw err;
	}
}

/**
 * @param {{gm: string, lang: string, gmCheckDays?: number}} config  gm: "upstream" | "off" | URL of a gm.json
 * @returns {Promise<{gm: object, text: object, info: object}>}
 */
export async function loadGameData(config, { force = false } = {}) {
	const lang = config.lang || 'en';
	const mode = config.gm || 'upstream';
	const offline = mode === 'off';
	const maxAge = checkInterval(config);
	if (mode !== 'upstream' && !offline) {
		// Self-hosted gm.json with text tables included (tools/build-gm.sh -l)
		const url = new URL(mode, location.href).href;
		const r = await cached('gm-host', url, x => {
			if (!isCompactGm(x)) throw new Error('not a gm.json');
			return x;
		}, { force, maxAge });
		if (!r.data.text || !r.data.text[lang]) throw new Error(`${url} has no text table for "${lang}" (build it with -l ${lang})`);
		return { gm: r.data, text: r.data.text[lang], info: { source: url, state: r.state, changed: r.changed, checked: r.checked, error: r.error } };
	}
	const imported = await kv.get('gm-import');
	const g = imported && !force ? { ...imported, state: 'imported' }
		: await cached('gm', GM_URL, x => compactGameMaster(x), { force, offline, maxAge });
	const t = await cached(`text-${lang}`, textUrl(lang), x => compactText(x), { force, offline, maxAge });
	if (!g || !t) throw new Error(offline ? 'No game data stored yet; import a file' : 'Game data unavailable');
	const text = (g.data.text && g.data.text[lang]) || t.data;
	return {
		gm: g.data, text,
		info: { source: imported ? 'imported file' : 'PokeMiners (GitHub)', state: g.state, changed: g.changed, checked: g.checked, error: g.error || t.error },
	};
}

/** A file picked by the user: full latest.json, or a compact gm.json. */
export async function importGameData(file) {
	const json = JSON.parse(await file.text());
	const data = Array.isArray(json) ? compactGameMaster(json, { source: { url: file.name, etag: 'import' } }) : json;
	if (!isCompactGm(data)) throw new Error('Neither a game master (latest.json) nor a gm.json');
	const now = Date.now();
	await kv.set('gm-import', { data, fp: 'import', url: file.name, checked: now, changed: now });
	return data;
}

export async function dropImportedGameData() {
	await kv.set('gm-import', null);
}
