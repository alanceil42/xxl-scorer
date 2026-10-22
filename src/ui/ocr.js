// Browser side of reading screenshots: the tesseract.js engines, and for each engine a reader that
// decodes the screenshots, does the pixel work and hands the engine its crops.
import { tesseractEngine } from '../core/pipeline.js';
import { pam } from '../core/image.js';
import { decode, readImage, pageCanvas } from './decode.js';

const abs = p => new URL(p, document.baseURI).href;

function loadScript(src) {
	return new Promise((resolve, reject) => {
		const s = document.createElement('script');
		s.src = src;
		s.onload = resolve;
		s.onerror = () => reject(new Error(`could not load ${src}`));
		document.head.append(s);
	});
}

let pool = [];	// promises of tesseract.js workers, created on first use

/**
 * How many screenshots to read at once. Each tesseract.js worker is a Web Worker, i.e. its own
 * thread, with its own copy of the engine (~30-60 MB of memory). On a computer all cores but
 * one (that one decodes the screenshots and merges the readings), at most 8; on a touch device
 * 2, where the browser has less memory to give a tab.
 */
export function poolSize(configured) {
	if (configured > 0) return Math.min(16, Math.floor(configured));
	const cores = navigator.hardwareConcurrency || 2;
	const touch = matchMedia('(pointer: coarse)').matches;
	return Math.max(1, touch ? Math.min(2, cores) : Math.min(8, cores - 1));
}

/**
 * The model in vendor/tessdata: its file's SHA-256, first 16 digits (vendor/SHA256SUMS; a test
 * keeps the two equal). Part of the key the engine caches the model under in IndexedDB, with
 * the site's path: an updated model is fetched instead of the old one being used for good, and
 * another site on the same host and port keeps its own.
 */
export const MODEL = 'eng.traineddata.gz 45b4cb346724ac17';
export const modelCacheKey = () => `xxl-scorer ${new URL('.', document.baseURI).pathname} ${MODEL}`;

/**
 * The model as cached under tesseract.js's own key before it had one of its own: deleted, or it
 * would take up the space for good. tesseract.js keeps it in IndexedDB "keyval-store"; a
 * database that isn't there is not created.
 */
export function dropOldModel() {
	try {
		const req = indexedDB.open('keyval-store');
		req.onupgradeneeded = () => req.transaction.abort();
		req.onerror = e => e.preventDefault();
		req.onsuccess = () => {
			const db = req.result;
			if (db.objectStoreNames.contains('keyval')) db.transaction('keyval', 'readwrite').objectStore('keyval').delete('./eng.traineddata');
			db.close();
		};
	} catch { /* no IndexedDB: nothing stored either */ }
}

function newWorker(lang, onProgress) {
	const p = (async () => {
		if (!globalThis.Tesseract) await loadScript(abs('vendor/tesseract/tesseract.min.js'));
		return globalThis.Tesseract.createWorker(lang, 1, {
			workerPath: abs('vendor/tesseract/worker.min.js'),
			corePath: abs('vendor/tesseract/core/'),
			langPath: abs('vendor/tessdata'),
			gzip: true,
			cachePath: modelCacheKey(),
			// The worker starts from a blob: URL, so it runs under the page's own
			// Content-Security-Policy (a worker from a file of the site would get only that
			// file's response headers, i.e. none on GitHub Pages): the engine, too, may load
			// only from this site
			workerBlobURL: true,
			logger: m => onProgress && onProgress(m),
		});
	})();
	p.catch(() => { pool = pool.filter(x => x !== p); });
	return p;
}

/**
 * n workers (engine and model from vendor/, same origin), started in parallel and kept for reuse:
 * a promise of each, to put each to work as soon as it is ready. Fails when the first fails.
 */
export async function startWorkers(n = 1, lang = 'eng', onProgress) {
	// the first one alone: it loads the script and stores the model in IndexedDB (also when it
	// was started ahead, by warmUp, and is still starting)
	if (!pool.length) pool.push(newWorker(lang, onProgress));
	await pool[0];
	while (pool.length < n) pool.push(newWorker(lang, onProgress));
	return pool.slice(0, n);
}

/** n workers, once all have started; those that failed left out (and started again next time). */
export async function getWorkers(n = 1, lang = 'eng', onProgress) {
	const ok = await Promise.allSettled(await startWorkers(n, lang, onProgress));
	const got = ok.filter(r => r.status === 'fulfilled').map(r => r.value);
	if (!got.length) throw ok[0].reason;
	return got;
}

export const getWorker = async (lang = 'eng', onProgress) => (await getWorkers(1, lang, onProgress))[0];

/** Engines started ahead of the first screenshot, quietly: a failure shows when one is needed. */
export function warmUp(n, lang = 'eng') {
	if (!pool.length) dropOldModel();
	getWorkers(n, lang).then(ws => ws.forEach(readerFor), () => {});
}

const readers = new WeakMap();	// engine -> its reader, kept with it for the next batch

/**
 * The reader of one engine: read(file, next, rules) gives the readings, thumbnail and size of a
 * screenshot, and decodes `next`, the one this engine reads after it, while the engine works.
 * One read at a time per reader, like the engine's own calls.
 */
export function readerFor(worker) {
	let r = readers.get(worker);
	if (!r) readers.set(worker, r = inWorker() ? workerReader(worker) : pageReader(worker));
	return r;
}

/**
 * Decoding and pixel work off the main thread, in a worker of the reader's own (reader.js): only
 * in Chromium, where its pixels were shown to be the page's, byte for byte (OffscreenCanvas and
 * an HTML canvas; PNG at 8 and 16 bits, with a colour profile, and JPEG: tests/browser/smoke.js).
 * Untested in WebKit and Gecko, so Safari and Firefox decode on the page as before.
 * navigator.userAgentData exists in Chromium-based browsers only.
 */
function inWorker() {
	const ua = globalThis.navigator && navigator.userAgentData;
	return !!(ua && ua.brands && ua.brands.some(b => b.brand === 'Chromium')) && typeof OffscreenCanvas === 'function';
}

/** On the page's main thread: crops handed to the engine as raw pixels (pam), not as PNG. */
function pageReader(worker) {
	const engine = tesseractEngine(worker, pam);
	let ahead = null;	// {file, pixels: promise}
	return {
		async read(file, next, rules) {
			const pixels = ahead && ahead.file === file ? ahead.pixels : decode(file, pageCanvas);
			ahead = null;
			const img = await pixels;
			if (next) {
				ahead = { file: next, pixels: decode(next, pageCanvas) };
				ahead.pixels.catch(() => {});	// reported by the read that takes it
			}
			return readImage(img, file, engine, rules, pageCanvas);
		},
	};
}

/** In a worker of its own; this side passes its requests on to the engine. */
function workerReader(worker) {
	const engine = tesseractEngine(worker, b => b);	// the crops come as PAM files already
	// Started from a blob: URL, like the engine, so it runs under the page's own policy. That
	// policy refuses a static import there (Chromium 141), not a dynamic one from the site.
	const src = `import(${JSON.stringify(abs('src/ui/reader.js'))}).catch(err => postMessage({ failed: String(err) }));`;
	const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), { type: 'module' });
	let fallback = null, broken = false, sentRules = null, keys = 0;
	const files = new Map();	// key -> file
	const keyOf = new Map();	// file decoded ahead -> its key
	const done = new Map();	// key -> {resolve, reject}
	const ready = new Promise((resolve, reject) => {
		// it didn't start (an older browser), or it stopped (out of memory): the reads waiting
		// fail, and the next ones are done on the page
		w.onerror = e => {
			const err = new Error(e.message || e.failed || 'the reader worker stopped');
			broken = true;
			reject(err);
			for (const d of done.values()) d.reject(err);
			done.clear();
		};
		w.onmessage = async ({ data: m }) => {
			if (m.ready) resolve();
			else if (m.failed) w.onerror(m);
			else if (m.ask) {
				try {
					const value = m.words ? await engine.words(m.image || files.get(m.words)) : await engine.line(m.line, m.whitelist, m.psm);
					w.postMessage({ answer: m.ask, value });
				} catch (err) {
					w.postMessage({ answer: m.ask, error: String(err && err.message || err) });
				}
			} else if (m.done) {
				const d = done.get(m.done);
				done.delete(m.done);
				files.delete(m.done);
				if (m.error) d.reject(new Error(m.error));
				else d.resolve(m.result);
			}
		};
	});
	ready.catch(() => {});
	return {
		async read(file, next, rules) {
			await ready.catch(() => {});
			if (broken) {
				fallback = fallback || pageReader(worker);
				return fallback.read(file, next, rules);
			}
			if (rules !== sentRules) w.postMessage({ rules: sentRules = rules });
			const key = keyOf.get(file) || ++keys;
			keyOf.delete(file);
			files.set(key, file);
			const msg = { read: key, file };
			if (next) {
				msg.next = { key: ++keys, file: next };
				keyOf.set(next, msg.next.key);
			}
			return new Promise((resolve, reject) => {
				done.set(key, { resolve, reject });
				w.postMessage(msg);
			});
		},
	};
}
