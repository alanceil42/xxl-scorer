// IndexedDB: rows (one per Pokémon) and kv (game data cache, settings).
const DB = 'xxl-scorer';
const VERSION = 1;

let dbp = null;
function open() {
	if (dbp) return dbp;
	dbp = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains('rows')) db.createObjectStore('rows', { keyPath: 'id' });
			if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbp;
}

async function tx(store, mode, fn) {
	const db = await open();
	return new Promise((resolve, reject) => {
		const t = db.transaction(store, mode);
		const s = t.objectStore(store);
		let out;
		Promise.resolve(fn(s)).then(v => { out = v; });
		t.oncomplete = () => resolve(out);
		t.onerror = () => reject(t.error);
		t.onabort = () => reject(t.error || new Error('transaction aborted'));
	});
}

const req2p = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

export const rows = {
	all: () => tx('rows', 'readonly', s => req2p(s.getAll())),
	put: row => tx('rows', 'readwrite', s => { s.put(row); }),
	putMany: list => tx('rows', 'readwrite', s => { for (const r of list) s.put(r); }),
	del: id => tx('rows', 'readwrite', s => { s.delete(id); }),
	delMany: ids => tx('rows', 'readwrite', s => { for (const id of ids) s.delete(id); }),
	clear: () => tx('rows', 'readwrite', s => { s.clear(); }),
};

export const kv = {
	get: key => tx('kv', 'readonly', s => req2p(s.get(key))),
	set: (key, val) => tx('kv', 'readwrite', s => { s.put(val, key); }),
};

export function newId() {
	if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
	return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/** Ask the browser to keep our data (Safari decides by heuristics). */
export async function askPersist() {
	try {
		if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
		return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
	} catch {
		return false;
	}
}
