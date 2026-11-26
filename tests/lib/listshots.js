// List screenshots read for the local tests (listsync-real.test.js): the engine as fixtures.test.js
// builds it, with the OCR cache when XXL_OCR_CACHE is set.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tesseractEngine } from '../../src/core/pipeline.js';
import { pam } from '../../src/core/image.js';
import { readListShot } from '../../src/core/listview.js';
import { decodePng } from './png.js';
import { openCache, engineId } from './ocrcache.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const tessdata = join(root, 'vendor/tessdata');

/**
 * Engines for reading, cached when XXL_OCR_CACHE is set. → {engines, done()}: done() saves the
 * cache and ends the workers.
 */
export async function listEngines(Tesseract, n = Math.max(1, Number(process.env.XXL_WORKERS) || 2)) {
	const version = p => JSON.parse(readFileSync(join(root, 'node_modules', p, 'package.json'), 'utf8')).version;
	const model = readFileSync(join(tessdata, 'eng.traineddata.gz'));
	const id = engineId(version('tesseract.js'), version('tesseract.js-core'), model, 'oem 1', tesseractEngine.toString());
	const cache = process.env.XXL_OCR_CACHE ? openCache(process.env.XXL_OCR_CACHE, id) : null;
	const workers = [], engines = [];
	for (let i = 0; i < n; i++) {
		const w = await Tesseract.createWorker('eng', 1, { langPath: tessdata, gzip: true, cacheMethod: 'none' });
		workers.push(w);
		const e = tesseractEngine(w, pam);
		engines.push(cache ? cache.wrap(e) : e);
	}
	return { engines, cache, done: async () => { cache?.save(); await Promise.all(workers.map(w => w.terminate())); } };
}

/** Files (paths) → Map file → readListShot's result, several engines at a time. */
export async function readShots(files, engines) {
	const out = new Map();
	let next = 0;
	await Promise.all(engines.map(async engine => {
		while (next < files.length) {
			const f = files[next++];
			out.set(f, await readListShot(decodePng(readFileSync(f)), engine));
		}
	}));
	return out;
}
