// What a change did to the local screenshot tests: two result files (XXL_RESULTS of
// tests/fixtures.test.js, one per version) compared set by set.
//   node tools/results-diff.mjs before.json after.json        rows that changed, readings too
//   node tools/results-diff.mjs before.json after.json -r     rows only
// Rows are compared by their files (which screenshots puzzled into one Pokémon), then by species,
// CP, IVs and size class; readings field by field. Exit code 0 either way: this reports.
import { readFileSync } from 'node:fs';

const [a, b, flag] = process.argv.slice(2);
if (!a || !b) {
	console.error('usage: node tools/results-diff.mjs before.json after.json [-r]');
	process.exit(2);
}
const before = JSON.parse(readFileSync(a, 'utf8')).sets;
const after = JSON.parse(readFileSync(b, 'utf8')).sets;
const show = v => (v === undefined ? '-' : JSON.stringify(v));
const keyOf = r => r.files.slice().sort((x, y) => x - y).join('+');
const ROW_FIELDS = ['species', 'cp', 'ivs', 'xxl', 'xxs', 'issues'];
const READING_FIELDS = ['species', 'caught', 'cp', 'cpAlt', 'hp', 'weight_kg', 'height_m', 'types', 'badge', 'lucky', 'name', 'caughtPill'];

/** Lines for one set: rows gone, rows new, rows with other values; readings that changed. */
function diffSet(x = { rows: [], readings: {} }, y = { rows: [], readings: {} }, rowsOnly = false) {
	const out = [];
	const X = new Map(x.rows.map(r => [keyOf(r), r])), Y = new Map(y.rows.map(r => [keyOf(r), r]));
	for (const [k, r] of X) if (!Y.has(k)) out.push(`  - row ${k}  ${r.species} CP ${r.cp}`);
	for (const [k, r] of Y) if (!X.has(k)) out.push(`  + row ${k}  ${r.species} CP ${r.cp}`);
	for (const [k, r] of Y) {
		const o = X.get(k);
		if (!o) continue;
		const d = ROW_FIELDS.filter(f => show(o[f]) !== show(r[f])).map(f => `${f} ${show(o[f])} -> ${show(r[f])}`);
		if (d.length) out.push(`  ~ row ${k}  ${d.join(', ')}`);
	}
	if (!rowsOnly) {
		for (const f of new Set([...Object.keys(x.readings), ...Object.keys(y.readings)])) {
			const o = x.readings[f] || {}, n = y.readings[f] || {};
			const d = READING_FIELDS.filter(k => show(o[k]) !== show(n[k])).map(k => `${k} ${show(o[k])} -> ${show(n[k])}`);
			if (d.length) out.push(`    ${f}: ${d.join(', ')}`);
		}
	}
	return out;
}

let changed = 0;
for (const set of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
	const lines = diffSet(before[set], after[set], flag === '-r');
	if (!lines.length) continue;
	changed++;
	console.log(`${set || '.'}${!before[set] ? ' (new)' : !after[set] ? ' (gone)' : ''}`);
	for (const l of lines) console.log(l);
}
if (!changed) console.log('no differences');
