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

/** Embedded JPEG, PNG or WebP only (what the page itself stores), at most ~200 KB. */
export function safeThumb(v) {
	return typeof v === 'string' && v.length <= 200_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(v) ? v : undefined;
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
	slid: bool,
	lucky: nullable(bool),
	covered: bool,
	merged: v => num(v, 1, 1000),
	ms: v => num(v, 0, 1e7),
};

const EDITS = {
	id: v => str(v, 60),
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
 * One row of a backup file, cleaned; null when it isn't a row at all (no id, no reading).
 * @returns {{id: string, created?: number, updated?: number, scanned?: number, scanIdx?: number, file?: string, reading: object, edits: object, thumb?: string} | null}
 */
export function cleanRow(r) {
	if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
	const id = str(r.id, 64);
	if (!id || !r.reading || typeof r.reading !== 'object') return null;
	const out = { id, reading: pick(r.reading, READING), edits: pick(r.edits, EDITS) };
	if (!out.reading.types) out.reading.types = [];
	for (const k of ['created', 'updated', 'scanned']) {
		const t = num(r[k], 0, 8.64e15);
		if (t !== undefined) out[k] = t;
	}
	// place in its batch; only with the batch's time it belongs to
	if (out.scanned !== undefined && Number.isInteger(r.scanIdx) && r.scanIdx >= 0 && r.scanIdx <= 1e6) out.scanIdx = r.scanIdx;
	const file = str(r.file, 255);
	if (file !== undefined) out.file = file;
	const thumb = safeThumb(r.thumb);
	if (thumb) out.thumb = thumb;
	return out;
}
