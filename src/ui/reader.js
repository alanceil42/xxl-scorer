// Screenshots read in a worker of their own, started by ocr.js (Chromium only, see there):
// decoding, the pixel work on the crops and the thumbnail run here, off the page's main thread.
// The text recognition engine stays with the page, which passes this worker's requests on to it.
//
// From the page: {rules} the reading rules (read.js makeRules), once; {read: key, file, next?:
// {key, file}} read a screenshot, and decode `next` meanwhile, while the engine works;
// {answer: id, value | error} an engine call's result. To the page: {ready}, {ask: id, words:
// key} or {ask: id, line, whitelist, psm} for the engine, {done: key, result | error}.
import { decode, readImage, workerCanvas } from './decode.js';
import { pam } from '../core/image.js';

let rules = null;
const decoded = new Map();	// key -> promise of the pixels
const waiting = new Map();	// engine call id -> {resolve, reject}
let calls = 0;

function ask(msg, transfer = []) {
	return new Promise((resolve, reject) => {
		const id = ++calls;
		waiting.set(id, { resolve, reject });
		postMessage({ ask: id, ...msg }, transfer);
	});
}

function start(key, file) {
	const p = decode(file, workerCanvas);
	p.catch(() => {});	// reported by the read that takes it
	decoded.set(key, p);
}

async function read({ read: key, file, next }) {
	try {
		if (!decoded.has(key)) start(key, file);
		const img = await decoded.get(key);
		decoded.delete(key);
		if (next) start(next.key, next.file);
		const engine = {
			// the whole screenshot: the page reads its own copy of the file
			words() {
				return ask({ words: key });
			},
			// a crop, as a PAM file
			line(px, whitelist, psm) {
				const b = pam(px);
				return ask({ line: b, whitelist, psm }, [b.buffer]);
			},
		};
		postMessage({ done: key, result: await readImage(img, null, engine, rules, workerCanvas) });
	} catch (err) {
		decoded.delete(key);
		postMessage({ done: key, error: String(err && err.message || err) });
	}
}

onmessage = ({ data: m }) => {
	if (m.answer) {
		const w = waiting.get(m.answer);
		waiting.delete(m.answer);
		if ('error' in m) w.reject(new Error(m.error));
		else w.resolve(m.value);
	} else if (m.rules) rules = m.rules;
	else if (m.read) read(m);
};
postMessage({ ready: true });
