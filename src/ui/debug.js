// The page's side of the debug report (src/core/debugreport.js): the error log kept on this
// device, the browser's facts, the layout as this browser drew it, and saving a file.
// Shared with catch-triage, which copies this file as it is; each app passes its own storage,
// selectors and feature list.
//
// Nothing here may break the page: every collector catches its own errors and reports them in
// the report instead, and the error hook never throws or shows anything.

import { addEntry, cleanLog } from '../core/debugreport.js';

/**
 * The error log: uncaught errors, rejected promises, and what the app logs itself (red banners).
 * Kept with the app's data through `load` and `save`, so it survives a reload.
 * @param {{load: () => Promise<unknown>, save: (log: Array) => Promise<void>}} store
 */
export function startErrorLog(store) {
	let log = [];
	let ready = false;
	const early = [];
	let saving = Promise.resolve();
	const persist = () => {
		const copy = log;
		saving = saving.then(() => store.save(copy)).catch(() => {});
	};
	const add = (source, message) => {
		try {
			if (!ready) { early.push([source, message, Date.now()]); return; }
			log = addEntry(log, source, message);
			persist();
		} catch { /* the log must never become the error */ }
	};
	addEventListener('error', ev => {
		// a resource that failed to load has no message; its element names it
		const t = ev.target;
		const what = ev.message || (t && t !== window && (t.src || t.href) ? `could not load ${t.tagName.toLowerCase()} ${t.src || t.href}` : 'error');
		add('error', ev.filename ? `${what} (${ev.filename.split('/').pop()}:${ev.lineno}:${ev.colno})` : what);
	}, true);
	addEventListener('unhandledrejection', ev => {
		const r = ev.reason;
		add('rejection', r && r.message ? `${r.name || 'Error'}: ${r.message}` : r);
	});
	(async () => {
		try {
			log = cleanLog(await store.load());
		} catch { log = []; }
		ready = true;
		for (const [s, m, at] of early.splice(0)) log = addEntry(log, s, m, at);
		if (log.length) persist();
	})();
	return {
		add,
		entries: () => log.slice(),
		async clear() { log = []; early.length = 0; persist(); await saving; },
	};
}

const tryOr = f => { try { return f(); } catch (err) { return { failed: String(err && err.message || err) }; } };
const round = n => Math.round(n * 10) / 10;

/** Browser, device and storage: what decides how the page runs. No time zone, no location. */
export async function environment() {
	const n = navigator;
	const env = {
		userAgent: n.userAgent,
		platform: n.userAgentData ? tryOr(() => ({ mobile: n.userAgentData.mobile, platform: n.userAgentData.platform, brands: n.userAgentData.brands.map(b => `${b.brand} ${b.version}`) })) : n.platform,
		languages: tryOr(() => [...(n.languages || [n.language])]),
		screen: tryOr(() => ({ width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, orientation: screen.orientation ? screen.orientation.type : null })),
		touchPoints: n.maxTouchPoints ?? null,
		cores: n.hardwareConcurrency ?? null,
		memoryGB: n.deviceMemory ?? null,
		online: n.onLine,
		cookies: n.cookieEnabled,
	};
	try {
		if (n.storage && n.storage.estimate) {
			const e = await n.storage.estimate();
			env.storage = { usageMB: round((e.usage || 0) / 1e6), quotaMB: round((e.quota || 0) / 1e6), persisted: n.storage.persisted ? await n.storage.persisted() : null };
		}
	} catch (err) { env.storage = { failed: String(err.message || err) }; }
	return env;
}

/** Whether these JavaScript features exist here; each app adds its own to the list. */
export function jsFeatures(extra = {}) {
	const g = globalThis;
	const has = {
		Worker: typeof g.Worker === 'function',
		WebAssembly: typeof g.WebAssembly === 'object',
		OffscreenCanvas: typeof g.OffscreenCanvas === 'function',
		createImageBitmap: typeof g.createImageBitmap === 'function',
		ImageDecoder: typeof g.ImageDecoder === 'function',
		structuredClone: typeof g.structuredClone === 'function',
		IndexedDB: typeof g.indexedDB === 'object',
		clipboardWrite: !!(navigator.clipboard && navigator.clipboard.writeText),
		share: typeof navigator.share === 'function',
		shareFiles: tryOr(() => !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'x.json', { type: 'application/json' })] }))),
		randomUUID: !!(g.crypto && g.crypto.randomUUID),
	};
	for (const [k, f] of Object.entries(extra)) has[k] = tryOr(f);
	return has;
}

/**
 * The layout as this browser drew it.
 * @param {{elements?: string[], css?: string[]}} opts CSS selectors to measure; CSS.supports() tests
 */
export function layoutFacts({ elements = [], css = [] } = {}) {
	const mq = q => tryOr(() => matchMedia(q).matches);
	const facts = {
		viewport: { width: innerWidth, height: innerHeight, scale: window.visualViewport ? round(visualViewport.scale) : null, scrollY: Math.round(scrollY) },
		pixelRatio: devicePixelRatio,
		colorScheme: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
		standalone: mq('(display-mode: standalone)') || navigator.standalone === true,
		pointer: mq('(pointer: coarse)') ? 'coarse' : 'fine',
		reducedMotion: mq('(prefers-reduced-motion: reduce)'),
		contrastMore: mq('(prefers-contrast: more)'),
		page: tryOr(() => ({ scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, clientWidth: document.documentElement.clientWidth })),
	};
	facts.safeArea = tryOr(probeSafeArea);
	facts.text = tryOr(() => {
		// iOS scales the system body font with its Text Size setting (Dynamic Type)
		const p = document.createElement('span');
		p.style.cssText = 'position:absolute;visibility:hidden;font:-apple-system-body';
		document.body.append(p);
		const sys = getComputedStyle(p).fontSize;
		p.remove();
		const root = getComputedStyle(document.documentElement);
		return { rootSize: root.fontSize, bodyFont: getComputedStyle(document.body).fontFamily, appleSystemBody: sys };
	});
	facts.fonts = tryOr(() => ({ status: document.fonts ? document.fonts.status : null, loaded: document.fonts ? [...document.fonts].filter(f => f.status === 'loaded').map(f => `${f.family} ${f.weight} ${f.style}`) : [] }));
	facts.elements = {};
	for (const sel of elements) {
		facts.elements[sel] = tryOr(() => {
			const list = [...document.querySelectorAll(sel)];
			if (!list.length) return 'none';
			const e = list[0];
			const r = e.getBoundingClientRect();
			const cs = getComputedStyle(e);
			const box = { x: round(r.x), y: round(r.y + scrollY), w: round(r.width), h: round(r.height), shown: !e.closest('[hidden]') && cs.display !== 'none' && cs.visibility !== 'hidden' };
			if (e.scrollWidth > e.clientWidth + 1) box.overflowX = e.scrollWidth - e.clientWidth;
			if (list.length > 1) box.count = list.length;
			return box;
		});
	}
	facts.css = {};
	for (const c of css) facts.css[c] = tryOr(() => CSS.supports(c));
	return facts;
}

/** The safe-area insets (notch, home bar) as this browser applies them, in px. */
function probeSafeArea() {
	const p = document.createElement('div');
	p.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
	document.body.append(p);
	const cs = getComputedStyle(p);
	const out = { top: cs.paddingTop, right: cs.paddingRight, bottom: cs.paddingBottom, left: cs.paddingLeft };
	p.remove();
	return out;
}

/**
 * Hand a file to the user: the share sheet on phones and tablets ("Save to Files"), a plain
 * download elsewhere (on the Mac the share sheet's Copy pasted the file twice into the Finder).
 * @param {File} file
 * @returns {Promise<boolean>} false when the user closed the share sheet
 */
export async function saveFile(file) {
	try {
		const touch = matchMedia('(pointer: coarse)').matches;
		if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
			await navigator.share({ files: [file] });
			return true;
		}
	} catch (err) {
		if (err && err.name === 'AbortError') return false;
	}
	const url = URL.createObjectURL(file);
	const a = document.createElement('a');
	a.href = url;
	a.download = file.name;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10000);
	return true;
}
