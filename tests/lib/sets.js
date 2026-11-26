// Sets of screenshots for the local tests (fixtures.test.js): finding them, numbering their
// files, comparing the rows they puzzle into with truth.json.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE = /\.(png|jpe?g)$/i;

/**
 * Every folder with screenshots or a truth.json in it, as paths relative to `top` with /. A
 * folder with a sync.json holds list screenshots (listsync-real.test.js), not a set: left out.
 */
export function findSets(top, rel = '') {
	const here = join(top, ...rel.split('/').filter(Boolean));
	const names = readdirSync(here).filter(n => !n.startsWith('.'));
	const out = [];
	if (names.includes('sync.json')) return out;
	if (names.some(n => IMAGE.test(n)) || names.includes('truth.json')) out.push(rel);
	for (const n of names.sort((x, y) => x.localeCompare(y, 'en', { numeric: true }))) {
		if (statSync(join(here, n)).isDirectory()) out.push(...findSets(top, rel ? `${rel}/${n}` : n));
	}
	return out;
}

/** The number a file goes by in truth.json: the first number in its name. */
export const fileNumber = n => { const m = n.match(/\d+/); return m ? Number(m[0]) : null; };

/**
 * Rows got against rows expected, by their files: rows missing, rows that shouldn't be there
 * (a row of loose screenshots only is fine) and, for the rows found, the fields that differ.
 */
export function compareRows(got, want, loose = []) {
	const keyOf = files => files.slice().sort((x, y) => x - y).join('+');
	const byFiles = new Map(got.map(g => [keyOf(g.files), g]));
	const wanted = new Set(want.map(w => keyOf(w.files)));
	const missing = want.filter(w => !byFiles.has(keyOf(w.files))).map(w => keyOf(w.files));
	const extra = got.filter(g => !wanted.has(keyOf(g.files)) && !g.files.every(f => loose.includes(f))).map(g => keyOf(g.files));
	const fields = [];
	for (const w of want) {
		const g = byFiles.get(keyOf(w.files));
		if (!g) continue;
		for (const k of ['species', 'cp', 'ivs', 'xxl', 'xxs', 'mega']) {
			const v = k === 'mega' ? g[k] ?? false : g[k];
			if (k in w && JSON.stringify(v) !== JSON.stringify(w[k])) fields.push(`${keyOf(w.files)}: ${k} ${JSON.stringify(v)}, expected ${JSON.stringify(w[k])}`);
		}
	}
	return { missing, extra, fields };
}
