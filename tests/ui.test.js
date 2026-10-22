// The parts of src/ui that run without a page: how many engines to start and where they come
// from, how often to ask for new game data, the help drawing, ids and storage persistence.
// Browser objects (navigator, matchMedia, document, Tesseract) are stood in for, one test at a
// time. The DOM code in app.js is not tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { poolSize, getWorkers, getWorker, startWorkers, warmUp, readerFor, MODEL, dropOldModel } from '../src/ui/ocr.js';
import { makeRules } from '../src/core/read.js';
import { compactText } from '../src/core/text.js';
import { syntheticText } from './synthetic.js';
import { decode } from '../src/ui/decode.js';
import { encodePng } from './lib/png.js';
import { checkInterval, DEFAULT_CHECK_DAYS } from '../src/ui/gamedata.js';
import { phoneSvg, phoneElement } from '../src/ui/help.js';
import { newId, askPersist } from '../src/ui/db.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DAY = 24 * 3600 * 1000;

/** Run fn with these globals in place, then put the old ones back. */
async function withGlobals(globals, fn) {
	const old = Object.keys(globals).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
	for (const [k, v] of Object.entries(globals)) Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
	try {
		return await fn();
	} finally {
		for (const [k, d] of old) {
			if (d) Object.defineProperty(globalThis, k, d);
			else delete globalThis[k];
		}
	}
}

const device = (cores, touch) => ({
	navigator: { hardwareConcurrency: cores },
	matchMedia: q => ({ matches: touch && q === '(pointer: coarse)' }),
});

test('engines at once: all cores but one on a computer, at most 8; two on a touch device', async () => {
	const cases = [
		[12, false, 8], [4, false, 3], [2, false, 1], [1, false, 1], [undefined, false, 1],
		[6, true, 2], [1, true, 1], [undefined, true, 2],
	];
	for (const [cores, touch, want] of cases) {
		await withGlobals(device(cores, touch), () => assert.equal(poolSize(0), want, `${cores} cores, touch ${touch}`));
	}
});

test('engines at once: config.json "ocrWorkers" wins, whole numbers up to 16; 0 or less is automatic', async () => {
	await withGlobals(device(12, false), () => {
		assert.equal(poolSize(3), 3);
		assert.equal(poolSize(2.7), 2);
		assert.equal(poolSize(40), 16);
		assert.equal(poolSize(0), 8);
		assert.equal(poolSize(-1), 8);
		assert.equal(poolSize(undefined), 8);
	});
});

test('engines: from the site itself (vendor/), the first alone, kept for reuse, failed ones retried', async () => {
	const log = [];
	let started = 0;
	let fail = 0;	// how many of the next createWorker calls fail
	const Tesseract = {
		async createWorker(lang, oem, opts) {
			const n = ++started;
			log.push(`start ${n}`);
			await null;
			if (fail > 0) { fail--; log.push(`fail ${n}`); throw new Error(`worker ${n} failed`); }
			log.push(`end ${n}`);
			return { n, lang, oem, opts };
		},
	};
	await withGlobals({ Tesseract, document: { baseURI: 'https://xxl.example.org/xxl/' } }, async () => {
		// the very first one fails (no network for the model): an error, and nothing kept
		fail = 1;
		await assert.rejects(getWorkers(2, 'eng'), /worker 1 failed/);
		assert.deepEqual(log, ['start 1', 'fail 1'], 'the first one alone: the others would fetch the model again');

		log.length = 0;
		started = 0;
		const ws = await getWorkers(3, 'eng');
		assert.deepEqual(ws.map(w => w.n), [1, 2, 3]);
		assert.deepEqual(log, ['start 1', 'end 1', 'start 2', 'start 3', 'end 2', 'end 3'], 'then the rest in parallel');
		const { lang, oem, opts } = ws[0];
		assert.equal(lang, 'eng');
		assert.equal(oem, 1, 'LSTM engine only');
		assert.equal(opts.workerPath, 'https://xxl.example.org/xxl/vendor/tesseract/worker.min.js');
		assert.equal(opts.corePath, 'https://xxl.example.org/xxl/vendor/tesseract/core/');
		assert.equal(opts.langPath, 'https://xxl.example.org/xxl/vendor/tessdata');
		assert.equal(opts.gzip, true);
		assert.equal(opts.workerBlobURL, true, 'a blob: worker runs under the page\'s CSP');
		assert.equal(opts.cachePath, `xxl-scorer /xxl/ ${MODEL}`, 'the model cached under the site\'s path and its version');

		log.length = 0;
		assert.deepEqual((await getWorkers(2)).map(w => w.n), [1, 2], 'reused');
		assert.equal(await getWorker(), ws[0]);
		assert.deepEqual(log, [], 'nothing new started');

		// two more wanted, one of them fails: the ones that work are used, the failed one is
		// dropped and started again next time
		fail = 1;
		assert.deepEqual((await getWorkers(5)).map(w => w.n), [1, 2, 3, 5]);
		assert.deepEqual((await getWorkers(5)).map(w => w.n), [1, 2, 3, 5, 6]);

		// started ahead (warmUp): quietly, a failure only shows when an engine is needed
		log.length = 0;
		warmUp(6);
		await new Promise(r => setTimeout(r, 0));
		assert.deepEqual(log, ['start 7', 'end 7']);
		fail = 1;
		warmUp(8);
		await new Promise(r => setTimeout(r, 0));
		assert.deepEqual((await getWorkers(8)).map(w => w.n), [1, 2, 3, 5, 6, 7, 9, 10]);

		// each engine's own promise, to put the ready ones to work while the others start
		const ps = await startWorkers(10);
		assert.ok(ps.length === 10 && ps.every(p => p instanceof Promise));
		assert.equal(await ps[0], ws[0]);
		assert.deepEqual((await Promise.all(ps)).map(w => w.n).slice(-2), [11, 12]);
	});
});

test('the model\'s cache key: its file\'s SHA-256, as vendor/SHA256SUMS lists it', () => {
	const sums = readFileSync(join(root, 'vendor/SHA256SUMS'), 'utf8');
	const [, file, hash] = MODEL.match(/^(\S+) ([0-9a-f]{16})$/);
	assert.ok(sums.split('\n').some(l => l.startsWith(hash) && l.endsWith(`  tessdata/${file}`)), `${MODEL}: update it with the model`);
});

test('the model cached under tesseract.js\'s own key is deleted; its database never created', async () => {
	const log = [];
	const idb = exists => ({
		open(name) {
			log.push(`open ${name}`);
			const req = {};
			setTimeout(() => {
				if (!exists) {
					req.transaction = { abort: () => log.push('abort') };
					req.onupgradeneeded();
					req.onerror({ preventDefault: () => log.push('handled') });
					return;
				}
				req.result = {
					objectStoreNames: { contains: s => s === 'keyval' },
					transaction: (s, mode) => ({ objectStore: () => ({ delete: k => log.push(`delete ${s} ${mode} ${k}`) }) }),
					close: () => log.push('close'),
				};
				req.onsuccess();
			});
			return req;
		},
	});
	await withGlobals({ indexedDB: idb(true) }, async () => {
		dropOldModel();
		await new Promise(r => setTimeout(r, 5));
	});
	assert.deepEqual(log, ['open keyval-store', 'delete keyval readwrite ./eng.traineddata', 'close']);
	log.length = 0;
	await withGlobals({ indexedDB: idb(false) }, async () => {
		dropOldModel();
		await new Promise(r => setTimeout(r, 5));
	});
	assert.deepEqual(log, ['open keyval-store', 'abort', 'handled']);
	await withGlobals({ indexedDB: undefined }, () => dropOldModel());
});

// ---------- readers: a screenshot decoded, its crops handed to the engine ----------

const rules = makeRules(compactText(syntheticText('en')));
const W = 300, H = 650;

/** A stand-in file: its first bytes are no PNG or JPEG header, so it is decoded to be measured. */
const shot = name => ({ name, slice: () => new Blob(['not an image header']) });

/** Stand-ins for decoding: each file is a shot() whose pixels are a white screen of W × H. */
function decoding(log) {
	const canvas = () => {
		let bmp = null;
		const c = {
			getContext: () => ({
				drawImage: b => { bmp = b; },
				getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }),
				putImageData: img => { c.put = img; },
			}),
			toDataURL: (type, q) => `data:${type};q=${q};${c.put.width}x${c.put.height}`,
			convertToBlob: async ({ type, quality }) => ({ type, text: `${type};q=${quality};${c.put.width}x${c.put.height}` }),
			get bmp() { return bmp; },
		};
		return c;
	};
	return {
		createImageBitmap: async file => {
			log.push(`decode ${file.name}`);
			await null;
			if (file.name === 'huge') return { width: 8000, height: 6000, close() { log.push('closed'); } };
			return { width: file.name === 'wide' ? H : W, height: file.name === 'wide' ? W : H, close() {} };
		},
		ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
		canvas,
	};
}

/** A tesseract.js stand-in: the whole screenshot reads as nothing, every crop as nothing. */
function engineLog(log) {
	return {
		async setParameters() {},
		async recognize(input) {
			if (input instanceof Uint8Array) {
				const head = new TextDecoder().decode(input.subarray(0, 600));
				log.push(`line ${head.match(/WIDTH (\d+)/)[1]}x${head.match(/HEIGHT (\d+)/)[1]}`);
				assert.ok(head.startsWith('P7\n'), 'a crop as raw pixels (PAM), not a PNG');
				return { data: { text: '' } };
			}
			log.push(`words ${input.name}`);
			return { data: { blocks: [] } };
		},
	};
}

test('reader on the page: the next screenshot decoded while the engine reads; crops as raw pixels', async () => {
	const log = [];
	const d = decoding(log);
	const document = { baseURI: 'https://xxl.example.org/xxl/', createElement: tag => { assert.equal(tag, 'canvas'); return d.canvas(); } };
	await withGlobals({ document, createImageBitmap: d.createImageBitmap, ImageData: d.ImageData, navigator: {} }, async () => {
		const w = engineLog(log);
		const reader = readerFor(w);
		assert.equal(readerFor(w), reader, 'one reader per engine, kept with it');
		const fb = shot('b');
		const a = await reader.read(shot('a'), fb, rules);
		assert.equal(log[0], 'decode a');
		assert.ok(log.indexOf('decode b') > 0 && log.indexOf('decode b') < log.findIndex(l => l.startsWith('line ')), `b decoded while the engine reads a: ${log}`);
		assert.ok(log.filter(l => l.startsWith('line ')).length >= 2, 'the crops (CP and name: nothing else on a white screen)');
		assert.deepEqual(a.size, [W, H]);
		assert.equal(a.thumb, 'data:image/jpeg;q=0.72;112x90', 'the sprite\'s thumbnail, as a JPEG');
		assert.equal(a.reading.species, null);
		log.length = 0;
		await reader.read(fb, null, rules);
		assert.deepEqual(log.slice(0, 1), ['words b'], 'b not decoded again');
		log.length = 0;
		await assert.rejects(reader.read(shot('wide'), null, rules), /landscape/);
		await assert.rejects(reader.read(shot('huge'), null, rules), /too large/);
		assert.deepEqual(log, ['decode wide', 'decode huge', 'closed'], 'refused before the engine is asked');
	});
});

test('reader in a worker of its own (Chromium): the same readings, the engine asked from the page', async () => {
	const log = [];
	const d = decoding(log);
	let worker = null;
	class Worker {
		constructor(url, opts) {
			worker = this;
			assert.deepEqual(opts, { type: 'module' });
			this.url = url;
			this.sent = [];
			// the worker's side (reader.js), in this process: messages cloned as the browser would
			globalThis.postMessage = (m, transfer) => {
				for (const t of transfer || []) assert.ok(t instanceof ArrayBuffer, 'only buffers handed over');
				setTimeout(() => this.onmessage({ data: structuredClone(m) }));
			};
			// a module runs once per process: a second worker gets its "ready" from here
			const again = Worker.started;
			Worker.started = true;
			import('../src/ui/reader.js').then(() => again && globalThis.postMessage({ ready: true }));
		}
		postMessage(m) {
			this.sent.push(Object.keys(m)[0]);
			// the rest cloned; a browser clones a File whole, Node's clone would drop its name
			const c = structuredClone({ ...m, file: undefined, next: m.next && { ...m.next, file: undefined } });
			if (m.file) c.file = m.file;
			if (m.next) c.next.file = m.next.file;
			setTimeout(() => globalThis.onmessage({ data: c }));
		}
	}
	const blobs = [];
	const URL_ = class extends URL {
		static createObjectURL(b) { blobs.push(b); return 'blob:x'; }
	};
	const globals = {
		document: { baseURI: 'https://xxl.example.org/xxl/' },
		navigator: { userAgentData: { brands: [{ brand: 'Not A Brand' }, { brand: 'Chromium' }] } },
		createImageBitmap: d.createImageBitmap, ImageData: d.ImageData, Worker, URL: URL_,
		OffscreenCanvas: function OffscreenCanvas(w, h) { return Object.assign(d.canvas(), { width: w, height: h, toDataURL: undefined }); },
		FileReaderSync: class { readAsDataURL(b) { return `data:${b.text}`; } },
		postMessage: null, onmessage: null,
	};
	await withGlobals(globals, async () => {
		const reader = readerFor(engineLog(log));
		assert.match(await blobs[0].text(), /^import\("https:\/\/xxl\.example\.org\/xxl\/src\/ui\/reader\.js"\)/, 'a module from the site, started from a blob: URL');
		const fb = shot('b');
		const a = await reader.read(shot('a'), fb, rules);
		assert.equal(log[0], 'decode a');
		assert.ok(log.indexOf('decode b') > 0 && log.indexOf('decode b') < log.findIndex(l => l.startsWith('line ')), `b decoded while the engine reads a: ${log}`);
		assert.ok(log.filter(l => l.startsWith('line ')).length >= 2, 'the crops (CP and name: nothing else on a white screen)');
		assert.equal(a.thumb, 'data:image/jpeg;q=0.72;112x90', 'the same thumbnail, from an OffscreenCanvas');
		assert.deepEqual(a.size, [W, H]);
		log.length = 0;
		const b = await reader.read(fb, null, rules);
		assert.deepEqual(log.slice(0, 1), ['words b'], 'decoded ahead in the worker, not again');
		assert.deepEqual({ ...b.reading, ms: 0 }, { ...a.reading, ms: 0 });
		await assert.rejects(reader.read(shot('huge'), null, rules), /too large/);
		assert.equal(worker.sent.filter(k => k === 'rules').length, 1, 'the rules sent once');
		// an engine call that fails reaches the read
		const failing = readerFor({ async setParameters() {}, async recognize() { throw new Error('engine gone'); } });
		await assert.rejects(failing.read(shot('c'), null, rules), /engine gone/);
	});
});

test('a screenshot over 40 megapixels refused by its header, before it is decoded', async () => {
	const decoded = [];
	const file = buf => ({ slice: (a, b) => ({ arrayBuffer: async () => Uint8Array.from(buf.subarray(a, b)).buffer }) });
	const png = (w, h) => {
		const b = Buffer.from(encodePng({ width: 1, height: 1, data: new Uint8ClampedArray(4) }));
		b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
		return b;
	};
	const createImageBitmap = async f => { decoded.push(f); return { width: 8000, height: 6000, close() {} }; };
	await withGlobals({ createImageBitmap }, async () => {
		await assert.rejects(decode(file(png(8000, 6000))), /too large/);
		assert.equal(decoded.length, 0, 'nothing decoded');
		// a header that says less, or none that can be read: checked once decoded, as before
		await assert.rejects(decode(file(png(100, 100))), /too large/);
		await assert.rejects(decode(file(Buffer.from('GIF89a'))), /too large/);
		assert.equal(decoded.length, 2);
	});
});

test('game data: asked for again after "gmCheckDays", 7 by default', () => {
	assert.equal(DEFAULT_CHECK_DAYS, 7);
	assert.equal(checkInterval({}), 7 * DAY);
	assert.equal(checkInterval({ gmCheckDays: 3 }), 3 * DAY);
	assert.equal(checkInterval({ gmCheckDays: '14' }), 14 * DAY);
	assert.equal(checkInterval({ gmCheckDays: 0.5 }), DAY / 2);
	for (const bad of [0, -2, 'weekly', null, Infinity]) assert.equal(checkInterval({ gmCheckDays: bad }), 7 * DAY, String(bad));
});

test('help drawing: two phones, what each screenshot gives marked, nothing fetched', () => {
	const css = readFileSync(join(root, 'app.css'), 'utf8');
	const appraisal = phoneSvg('appraisal'), plain = phoneSvg('plain');
	for (const svg of [appraisal, plain]) {
		assert.match(svg, /^<svg class="hf" viewBox="0 0 200 420" role="img" aria-label="[^"<>]+">.*<\/svg>$/s);
		for (const tag of ['svg', 'text', 'tspan']) {
			assert.equal(svg.split(`<${tag}`).length, svg.split(`</${tag}>`).length, `<${tag}> closed`);
		}
		// drawn shapes only: no picture and no other file referenced (CSP, no game art)
		assert.doesNotMatch(svg, /<image|href=|url\(|https?:/);
		for (const cls of new Set([...svg.matchAll(/class="([^"]+)"/g)].map(m => m[1]))) {
			assert.match(css, new RegExp(`\\.${cls}(?![\\w-])`), `.${cls} styled in app.css (light and dark)`);
		}
	}
	const marks = svg => [...svg.matchAll(/class="hf-num-t"[^>]*>(\d)</g)].map(m => m[1]);
	assert.deepEqual(marks(appraisal), ['1', '2'], 'bars and the "was caught" line');
	assert.deepEqual(marks(plain), ['1'], 'the stats row');
	assert.match(appraisal, /aria-label="[^"]*three bars \(1\)[^"]*caught \(2\)/);
	assert.match(plain, /aria-label="[^"]*weight and height \(1\)/);
	for (const label of ['Attack', 'Defense', 'HP']) assert.ok(appraisal.includes(`>${label}</text>`), label);
	assert.ok(appraisal.includes('was caught on'));
	assert.ok(!plain.includes('class="hf-bar"'), 'no bars without the appraisal');
	assert.ok(!plain.includes('was caught'));
	assert.equal(phoneSvg('anything else'), plain);
});

test('help drawing in the page: built element by element, the same as its markup', () => {
	// a stand-in document that writes what it is given as markup
	const esc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	const doc = {
		createTextNode: text => ({ html: () => esc(text) }),
		createElementNS: (ns, tag) => {
			assert.equal(ns, 'http://www.w3.org/2000/svg');
			const attrs = [], kids = [];
			return {
				setAttribute: (k, v) => { assert.equal(typeof v, 'string'); attrs.push(` ${k}="${esc(v)}"`); },
				append: (...k) => kids.push(...k),
				html: () => `<${tag}${attrs.join('')}${kids.length ? `>${kids.map(k => k.html()).join('')}</${tag}>` : '/>'}`,
			};
		},
	};
	for (const kind of ['appraisal', 'plain']) assert.equal(phoneElement(kind, doc).html(), phoneSvg(kind), kind);
});

test('row ids: random UUIDs, with a fallback where the browser has none', async () => {
	const a = newId(), b = newId();
	assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	assert.notEqual(a, b);
	await withGlobals({ crypto: {} }, () => {
		const c = newId(), d = newId();
		assert.match(c, /^[0-9a-z]{10,}$/);
		assert.notEqual(c, d);
	});
});

test('storage: persistence asked for once, its answer returned, never an error', async () => {
	const storage = granted => {
		const s = { asked: 0, async persisted() { return granted; }, async persist() { s.asked++; granted = true; return true; } };
		return s;
	};
	const no = storage(false);
	assert.equal(await withGlobals({ navigator: { storage: no } }, askPersist), true);
	assert.equal(no.asked, 1);
	const yes = storage(true);
	assert.equal(await withGlobals({ navigator: { storage: yes } }, askPersist), true);
	assert.equal(yes.asked, 0, 'already persistent: not asked again');
	const refused = { async persisted() { return false; }, async persist() { return false; } };
	assert.equal(await withGlobals({ navigator: { storage: refused } }, askPersist), false);
	assert.equal(await withGlobals({ navigator: {} }, askPersist), false, 'no storage API');
	const broken = { async persisted() { throw new Error('SecurityError'); } };
	assert.equal(await withGlobals({ navigator: { storage: broken } }, askPersist), false);
});

test('reader worker that doesn\'t start or stops: reads waiting fail, the next ones are done on the page', async () => {
	const log = [];
	const d = decoding(log);
	class Worker {
		constructor() {
			// "start": fails at once; "stop": ready, then gone at the first read
			this.mode = Worker.mode;
			setTimeout(() => (this.mode === 'start' ? this.onerror({ message: 'blocked' }) : this.onmessage({ data: { ready: true } })));
		}
		postMessage(m) {
			if (m.read) setTimeout(() => this.onerror({}));
		}
	}
	const globals = {
		document: { baseURI: 'https://xxl.example.org/xxl/', createElement: () => d.canvas() },
		navigator: { userAgentData: { brands: [{ brand: 'Chromium' }] } },
		createImageBitmap: d.createImageBitmap, ImageData: d.ImageData, Worker, OffscreenCanvas: function () {},
	};
	await withGlobals(globals, async () => {
		Worker.mode = 'start';
		const a = readerFor(engineLog(log));
		assert.deepEqual((await a.read(shot('a'), null, rules)).size, [W, H], 'on the page');
		Worker.mode = 'stop';
		const b = readerFor(engineLog(log));
		await assert.rejects(b.read(shot('b'), null, rules), /the reader worker stopped/);
		assert.deepEqual((await b.read(shot('c'), null, rules)).size, [W, H], 'the next one on the page');
	});
});
