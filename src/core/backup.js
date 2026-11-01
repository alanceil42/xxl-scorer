// Rows from a backup file. A backup is a file anyone could have edited or made up,
// so only known fields of the expected types are taken; everything else is dropped. Two reasons:
// a thumbnail that is a URL instead of embedded image data would make the browser fetch it (a
// request the page promises not to make), and a field of the wrong type stored in the
// browser would break the page on every visit until the row is deleted.

import { TYPES } from './read.js';

const str = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined);
const bool = v => (typeof v === 'boolean' ? v : undefined);
const iv = v => (Number.isInteger(v) && v >= 0 && v <= 15 ? v : undefined);
const ivs = (v, exact) => {
	if (!v || typeof v !== 'object') return undefined;
	const f = exact ? iv : x => num(x, 0, 15);
	const o = { a: f(v.a), d: f(v.d), s: f(v.s) };
	return o.a === undefined || o.d === undefined || o.s === undefined ? undefined : o;
};
const nullable = f => v => (v === null ? null : f(v));

/**
 * An embedded JPEG, what the page itself stores, at most ~200 KB. Its bytes must start as a
 * JPEG does (FF D8 FF, "/9j/" in base64): the browser goes by the bytes, not the label, and
 * would decode a GIF or BMP labelled as JPEG all the same.
 */
export function safeThumb(v) {
	return typeof v === 'string' && v.length <= 200_000 && /^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*=*$/.test(v) ? v : undefined;
}

const READING = {
	species: nullable(v => str(v, 60)),
	caught: nullable(v => str(v, 30)),
	caughtPill: nullable(v => str(v, 20)),
	name: nullable(v => str(v, 60)),
	hp: nullable(v => num(v, 1, 9999)),
	cp: nullable(v => num(v, 1, 99999)),
	cpAlt: v => (Array.isArray(v) && v.length <= 20 ? v.filter(x => num(x, 1, 99999) !== undefined) : undefined),
	weight_kg: nullable(v => num(v, 0, 100000)),
	height_m: nullable(v => num(v, 0, 1000)),
	types: v => (Array.isArray(v) ? v.filter(t => TYPES.includes(t)).slice(0, 2) : undefined),
	bars: nullable(v => ivs(v, false)),
	badge: nullable(v => (['XXL', 'XL', 'XS', 'XXS'].includes(v) ? v : undefined)),
	lucky: nullable(bool),
	covered: bool,
	merged: v => num(v, 1, 1000),
	ms: v => num(v, 0, 1e7),
};

const EDITS = {
	// a species id of the game data (MR_MIME); anything else could name a property every object
	// has ("constructor") and pass for a species
	id: v => (typeof v === 'string' && /^[A-Z0-9_]{1,60}$/.test(v) ? v : undefined),
	form: v => str(v, 60),
	hp: v => num(v, 1, 9999),
	cp: v => num(v, 1, 99999),
	height_m: v => num(v, 0, 1000),
	weight_kg: v => num(v, 0, 100000),
	caught: v => str(v, 30),
	ivs: v => ivs(v, true),
	xxl: bool,
	inGame: v => num(v, 0, 100000),
};

function pick(src, schema) {
	const out = {};
	if (!src || typeof src !== 'object') return out;
	for (const [k, f] of Object.entries(schema)) {
		if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
		const v = f(src[k]);
		if (v !== undefined) out[k] = v;
	}
	return out;
}

/**
 * The settings a backup carries, each with the time it was set: the "Name to copy" template
 * and the backup's own file name. An import takes one only when it was set later than the one
 * in the browser, as rows go by "updated"; -1 stands for one never set (the default), so any
 * value set anywhere beats it. The page uses both only as text (formatName, backupFileName),
 * so any string will do; the caps keep a made-up file from storing megabytes.
 * @param {unknown} s
 * @param {number} [now]
 * @returns {{nameTemplate?: string, nameTemplateAt?: number, fileName?: string, fileNameAt?: number}}
 */
export function cleanSettings(s, now = Date.now()) {
	if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
	const out = {};
	// a backup from before the time was kept: as old as can be, but newer than never set
	const at = v => Math.min(num(v, 0, 8.64e15) ?? 0, now);
	const t = str(s.nameTemplate, 500);
	if (t && t.trim()) Object.assign(out, { nameTemplate: t.trim(), nameTemplateAt: at(s.nameTemplateAt) });
	const f = str(s.fileName, FILE_NAME_MAX);
	if (f && f.trim()) Object.assign(out, { fileName: f.trim(), fileNameAt: at(s.fileNameAt) });
	return out;
}

/**
 * What the browser holds that is in no backup file yet, for the Backup dot and the reminder
 * banner. Everything up to the last export is in a file; so is what an import brought in, at
 * the time the file had (`inFile`: per row id, and per setting). Without the second, a list
 * restored into a fresh browser, e.g. after Safari deleted the site's data, would count as
 * never exported, with times days old: the reminder would ask to export what was just read
 * from a file.
 * @param {{rows: {id: string, updated?: number}[], nameTemplateAt: number, fileNameAt: number}} state
 * @param {number} lastExport	0 for never
 * @param {{rows?: Map<string, number>, nameTemplateAt?: number, fileNameAt?: number} | null} [inFile]
 * @returns {{rows: {id: string, updated?: number}[], settings: number}} the rows, and how many settings
 */
export function notInFile(state, lastExport, inFile) {
	const filed = inFile?.rows instanceof Map ? inFile.rows : new Map();
	const has = (at, fileAt) => at <= lastExport || (typeof fileAt === 'number' && fileAt >= at);
	const rows = state.rows.filter(r => !has(r.updated || 0, filed.get(r.id)));
	const settings = (has(state.nameTemplateAt, inFile?.nameTemplateAt) ? 0 : 1) + (has(state.fileNameAt, inFile?.fileNameAt) ? 0 : 1);
	return { rows, settings };
}

/**
 * The `inFile` record of notInFile after an import: the times the file had for the rows it
 * brought in or matched (by the ids they have here) and for its settings, the later of old and
 * new. Entries for rows no longer here are dropped, so the record stays as big as the list.
 * A Map, not an object: ids come from files, and an id like "__proto__" must stay an id.
 * @param {{rows?: Map<string, number>, nameTemplateAt?: number, fileNameAt?: number} | null} old
 * @param {Map<string, number>} rows	id here -> the file's "updated" of that row
 * @param {{nameTemplate?: string, nameTemplateAt?: number, fileName?: string, fileNameAt?: number}} settings	cleaned (cleanSettings)
 * @param {Iterable<string>} ids	the ids of the rows here after the import
 */
export function filedAfterImport(old, rows, settings, ids) {
	const later = (a, b) => (typeof a === 'number' ? (typeof b === 'number' ? Math.max(a, b) : a) : b);
	const prev = old?.rows instanceof Map ? old.rows : new Map();
	const out = { rows: new Map() };
	for (const id of ids) {
		const t = later(prev.get(id), rows.get(id));
		if (t !== undefined) out.rows.set(id, t);
	}
	const tpl = later(old?.nameTemplateAt, settings.nameTemplate ? settings.nameTemplateAt : undefined);
	if (tpl !== undefined) out.nameTemplateAt = tpl;
	const fn = later(old?.fileNameAt, settings.fileName ? settings.fileNameAt : undefined);
	if (fn !== undefined) out.fileNameAt = fn;
	return out;
}

/**
 * Whether to show the reminder banner: some change in no file has waited `days` or more, close
 * to Safari's 7-day deletion. Once the banner is dismissed, only changes made after that bring
 * it back: it informs about a risk once, it doesn't push to export (the Backup dot stays).
 * @param {{updated?: number}[]} pending	rows in no file (notInFile)
 * @param {number} dismissedAt	when the banner was last dismissed, 0 for never
 * @param {number} days
 * @param {number} [now]
 */
export function remindExport(pending, dismissedAt, days, now = Date.now()) {
	return pending.some(r => (r.updated || 0) > dismissedAt && now - (r.updated || 0) > days * 24 * 3600 * 1000);
}

/** The backup's file name when none is set: the local date, so backups of different days differ. */
export const DEFAULT_FILE_NAME = 'xxl-scorer-{date}';
export const FILE_NAME_MAX = 100;

/**
 * The backup's file name from the name set in Settings: {date} becomes the local date
 * (2026-10-29), characters that Files, the Finder or Windows refuse or treat specially
 * become "-", and ".json" is added. A fixed name lets "Save to Files" find the same file
 * every time, e.g. one file per game account in a shared iCloud folder.
 * @param {string} [pattern]
 * @param {Date} [d]
 * @returns {string}
 */
export function backupFileName(pattern, d = new Date()) {
	const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	const make = p => p.replaceAll('{date}', date)
		.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '-')
		.replace(/\.json$/i, '')
		.slice(0, FILE_NAME_MAX)
		// a leading dot hides the file; trailing dots and spaces Windows drops
		.replace(/^[\s.]+|[\s.]+$/g, '');
	const base = make(typeof pattern === 'string' ? pattern.trim() : '') || make(DEFAULT_FILE_NAME);
	return `${base}.json`;
}

/**
 * One row of a backup file, cleaned; null when it isn't a row at all (no id, no reading).
 * Times after `now` are taken as `now`: a row from the future would stay "not exported" and
 * at the top of Newest for good.
 * @param {unknown} r
 * @param {number} [now]
 * @returns {{id: string, created?: number, updated?: number, scanned?: number, scanIdx?: number, file?: string, reading: object, edits: object, thumb?: string} | null}
 */
export function cleanRow(r, now = Date.now()) {
	if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
	const id = str(r.id, 64);
	if (!id || !r.reading || typeof r.reading !== 'object') return null;
	// new reading and edits, complete here: the page caches evaluated rows by these objects, so
	// they are never changed after this (src/ui/evalcache.js)
	const out = { id, reading: pick(r.reading, READING), edits: pick(r.edits, EDITS) };
	if (!out.reading.types) out.reading.types = [];
	for (const k of ['created', 'updated', 'scanned']) {
		const t = num(r[k], 0, 8.64e15);
		if (t !== undefined) out[k] = Math.min(t, now);
	}
	// place in its batch; only with the batch's time it belongs to
	if (out.scanned !== undefined && Number.isInteger(r.scanIdx) && r.scanIdx >= 0 && r.scanIdx <= 1e6) out.scanIdx = r.scanIdx;
	const file = str(r.file, 255);
	if (file !== undefined) out.file = file;
	const thumb = safeThumb(r.thumb);
	if (thumb) out.thumb = thumb;
	return out;
}
