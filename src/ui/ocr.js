// Browser side of reading a screenshot: decode, tesseract.js worker, thumbnail.
import { tesseractEngine, readScreenshot } from '../core/pipeline.js';
import { REGIONS, boxOf, crop, downscale, imageSize } from '../core/image.js';

const abs = p => new URL(p, document.baseURI).href;
let workerP = null;

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

function newWorker(lang, onProgress) {
	const p = (async () => {
		if (!globalThis.Tesseract) await loadScript(abs('vendor/tesseract/tesseract.min.js'));
		return globalThis.Tesseract.createWorker(lang, 1, {
			workerPath: abs('vendor/tesseract/worker.min.js'),
			corePath: abs('vendor/tesseract/core/'),
			langPath: abs('vendor/tessdata'),
			gzip: true,
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

/** n workers (engine and model from vendor/, same origin), started in parallel; kept for reuse. */
export async function getWorkers(n = 1, lang = 'eng', onProgress) {
	if (!pool.length) {
		// the first one alone: it loads the script and stores the model in IndexedDB
		pool.push(newWorker(lang, onProgress));
		await pool[0];
	}
	while (pool.length < n) pool.push(newWorker(lang, onProgress));
	const ok = await Promise.allSettled(pool.slice(0, n));
	const got = ok.filter(r => r.status === 'fulfilled').map(r => r.value);
	if (!got.length) throw ok[0].reason;
	return got;
}

export const getWorker = async (lang = 'eng', onProgress) => (await getWorkers(1, lang, onProgress))[0];

function toCanvas(img) {
	const c = document.createElement('canvas');
	c.width = img.width;
	c.height = img.height;
	c.getContext('2d').putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
	return c;
}

// a phone screenshot is 1-4 megapixels; refuse what would only exhaust the tab's memory
const MAX_PIXELS = 40e6;
const TOO_LARGE = 'image too large for a screenshot';

async function decode(file) {
	// PNG and JPEG by the size in their header, before anything is decoded; other kinds (and a
	// JPEG whose metadata runs past the first 256 KB) once decoded
	const size = imageSize(new Uint8Array(await file.slice(0, 1 << 18).arrayBuffer()));
	if (size && size.width * size.height > MAX_PIXELS) throw new Error(TOO_LARGE);
	const bmp = await createImageBitmap(file);
	if (bmp.width * bmp.height > MAX_PIXELS) { bmp.close && bmp.close(); throw new Error(TOO_LARGE); }
	const c = document.createElement('canvas');
	c.width = bmp.width;
	c.height = bmp.height;
	const ctx = c.getContext('2d', { willReadFrequently: true });
	ctx.drawImage(bmp, 0, 0);
	bmp.close && bmp.close();
	const d = ctx.getImageData(0, 0, c.width, c.height);
	return { width: d.width, height: d.height, data: d.data };
}

/** Sprite crop only: no info-line text is ever stored. */
function thumbnail(img) {
	const small = downscale(crop(img, boxOf(img, REGIONS.sprite)), 112);
	return toCanvas(small).toDataURL('image/jpeg', 0.72);
}

/**
 * @param {File} file
 * @param {ReturnType<import('../core/read.js').makeRules>} rules
 * @param {string} lang     Tesseract language code
 * @param {object} [worker] one from getWorkers; calls on one worker must not overlap
 */
export async function readFile(file, rules, lang = 'eng', worker = null) {
	const img = await decode(file);
	if (img.width > img.height) throw new Error('landscape image: not a Pokémon screenshot?');
	worker = worker || await getWorker(lang);
	const engine = tesseractEngine(worker, async px => toCanvas(px));
	const reading = await readScreenshot(img, file, engine, rules);
	return { reading, thumb: thumbnail(img), size: [img.width, img.height] };
}
