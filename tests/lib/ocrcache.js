// A cache of text recognition for the local screenshot tests: the same crop read with the same
// engine gives the same text, so a run after a change to reading only asks the engine about the
// crops that changed. Thousands of screenshots then take minutes once and seconds after.
//
// Key: what goes in (the crop's pixels, or the whole screenshot's bytes), how it is read
// (whitelist, page mode) and the engine: tesseract.js and its core, the language model, and
// the source of the adapter that sets the engine's parameters (pipeline.js). Change any of
// these and the cache file changes with it (the name carries a hash of the engine part), so
// nothing stale is ever used.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const sha = (...parts) => {
	const h = createHash('sha256');
	for (const p of parts) h.update(typeof p === 'string' ? p : Buffer.from(p.buffer, p.byteOffset, p.byteLength)).update('\0');
	return h.digest('hex');
};

/**
 * What identifies the engine: anything that can change a reading for the same input.
 * @param {string[]} parts  e.g. package versions, the model file's bytes, the adapter's source
 */
export const engineId = (...parts) => sha(...parts).slice(0, 12);

/**
 * The cache file for one engine, shared by any number of engines of that kind.
 * @param {string} dir  folder for the cache file
 * @param {string} id   engineId(...)
 * @returns {{stats: {hits: number, misses: number, file: string}, save: () => void,
 *            wrap: (engine: ReturnType<import('../../src/core/pipeline.js').tesseractEngine>) => typeof engine}}
 */
export function openCache(dir, id) {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `ocr-${id}.json`);
	const map = existsSync(file) ? new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')))) : new Map();
	const stats = { hits: 0, misses: 0, file };
	let unsaved = 0;
	const save = () => {
		if (!unsaved) return;
		// whole file, then rename: a run cut off mid-write leaves the old cache intact
		writeFileSync(file + '.tmp', JSON.stringify(Object.fromEntries(map)));
		renameSync(file + '.tmp', file);
		unsaved = 0;
	};
	const through = async (key, ask) => {
		if (map.has(key)) { stats.hits++; return map.get(key); }
		stats.misses++;
		const v = await ask();
		map.set(key, v);
		// often enough that a run stopped from outside loses little
		if (++unsaved >= 25) save();
		return v;
	};
	return {
		stats, save,
		wrap: engine => ({
			words: input => through(sha('words', input), () => engine.words(input)),
			line: (img, whitelist, psm = '7') =>
				through(sha('line', whitelist, psm, `${img.width}x${img.height}`, img.data), () => engine.line(img, whitelist, psm)),
		}),
	};
}
