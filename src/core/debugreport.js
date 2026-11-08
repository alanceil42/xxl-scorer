// The debug report: one JSON file with what the page saw, for a bug report. The user saves it
// and decides where it goes (a chat, an issue); the page never sends it anywhere.
//
// It carries state, not input: no screenshots, no thumbnails, no embedded images of any kind.
// Every string that is a data: URL is replaced, whatever the field, so a new field that holds
// a picture can't slip in unnoticed. Error messages are cut short, since an error can quote
// what it failed on (a backup's text, say).
//
// Pure functions only; the page collects the browser's facts (src/ui/debug.js). Shared with
// catch-triage, which copies this file as it is: nothing here knows about Pokémon rows.

export const REPORT_VERSION = 1;
export const LOG_MAX = 50;	// errors kept, the newest last
export const MESSAGE_MAX = 200;	// characters of one error message
const STRING_MAX = 2000;	// any other string in the report
const DATA_URL = /^\s*data:/i;	// a whole string that is one
const EMBEDDED = /\bdata:[\w.+-]*\/?[\w.+-]*[;,][^\s)"']*/gi;	// one inside a longer string

/**
 * An error message as the log keeps it: one line, no data: URLs, at most MESSAGE_MAX characters.
 * @param {unknown} msg
 */
export function cleanMessage(msg) {
	let s = String(msg ?? '').replace(/\s+/g, ' ').trim();
	s = s.replace(EMBEDDED, '[data URL]');
	return s.length > MESSAGE_MAX ? `${s.slice(0, MESSAGE_MAX - 1)}…` : s;
}

/**
 * The log with one entry added: {at, source, message}, the oldest dropped beyond LOG_MAX. The
 * same message from the same source within a second counts once (an error in a loop).
 * @param {Array<{at: number, source: string, message: string, n?: number}>} log
 * @param {string} source e.g. 'error', 'rejection', 'banner'
 * @param {unknown} message
 * @param {number} [now]
 */
export function addEntry(log, source, message, now = Date.now()) {
	const list = Array.isArray(log) ? log.filter(isEntry) : [];
	const entry = { at: now, source: cleanMessage(source).slice(0, 20) || 'error', message: cleanMessage(message) };
	const last = list[list.length - 1];
	if (last && last.source === entry.source && last.message === entry.message && now - last.at < 1000) {
		return [...list.slice(0, -1), { ...last, at: now, n: (last.n || 1) + 1 }];
	}
	list.push(entry);
	return list.slice(-LOG_MAX);
}

/**
 * A log as read back from storage, which may hold anything: entries of the expected shape, the
 * newest LOG_MAX.
 * @param {unknown} list
 */
export function cleanLog(list) {
	return Array.isArray(list) ? list.filter(isEntry).slice(-LOG_MAX) : [];
}

/** A stored log entry of the expected shape. */
function isEntry(e) {
	return !!e && typeof e === 'object' && Number.isFinite(e.at) && typeof e.source === 'string' && typeof e.message === 'string';
}

/**
 * A copy with every data: URL replaced, keys named in `drop` left out, long strings cut,
 * non-JSON values (functions, undefined) left out, Sets and Maps as arrays and objects.
 * @param {unknown} value
 * @param {{drop?: string[]}} [opts]
 */
export function scrub(value, opts = {}) {
	const drop = new Set(opts.drop || []);
	// only the objects on the path from the root: one object shared by two fields (a row's
	// reading and what the page showed both hold the same bars) is copied twice, a cycle is cut
	const path = new WeakSet();
	const walk = v => {
		if (typeof v === 'string') {
			if (DATA_URL.test(v)) return '[data URL removed]';
			const w = v.replace(EMBEDDED, '[data URL]');
			return w.length > STRING_MAX ? `${w.slice(0, STRING_MAX)}…` : w;
		}
		if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
		if (v === null || typeof v === 'boolean') return v;
		if (typeof v !== 'object') return undefined;
		if (path.has(v)) return '[cycle]';
		path.add(v);
		let out;
		if (v instanceof Set) out = [...v].map(walk);
		else if (Array.isArray(v)) out = v.map(x => { const w = walk(x); return w === undefined ? null : w; });
		else {
			out = {};
			for (const [k, x] of Object.entries(v instanceof Map ? Object.fromEntries(v) : v)) {
				if (drop.has(k)) continue;
				const w = walk(x);
				if (w !== undefined) out[k] = w;
			}
		}
		path.delete(v);
		return out;
	};
	return walk(value);
}

/**
 * The report. `sections` are the app's own (settings, rows, …), scrubbed like everything else.
 * @param {{app: string, build?: object|null, env?: object, layout?: object, errors?: Array,
 *   sections?: object, drop?: string[], now?: Date}} p
 */
export function makeReport({ app, build = null, env = {}, layout = {}, errors = [], sections = {}, drop = [], now = new Date() }) {
	return scrub({
		app,
		kind: 'debug-report',
		v: REPORT_VERSION,
		made: now.toISOString(),
		build,
		env,
		layout,
		...sections,
		errors: cleanLog(errors),
	}, { drop });
}

/**
 * Which rows go in: the ticked ones, or all when none is ticked.
 * @template R
 * @param {R[]} rows
 * @param {Set<string>|string[]} ticked ids
 * @param {(r: R) => string} [idOf]
 * @returns {{included: 'ticked'|'all', total: number, list: R[]}}
 */
export function pickRows(rows, ticked, idOf = r => r.id) {
	const ids = new Set(ticked || []);
	const list = ids.size ? rows.filter(r => ids.has(idOf(r))) : rows;
	return { included: ids.size ? 'ticked' : 'all', total: rows.length, list };
}

/**
 * The file's name: <app>-debug-<local date>.json.
 * @param {string} app
 * @param {Date} [d]
 */
export function reportFileName(app, d = new Date()) {
	const p = n => String(n).padStart(2, '0');
	return `${app}-debug-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}
