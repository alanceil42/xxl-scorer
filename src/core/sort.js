// Orders of the list. Pure, so the tests run them in Node; the page's sort menu and
// column headers both use them.
//
// Each sort has a key (from the evaluated row `e` and the stored row), the direction of its
// first tap (1 ascending, -1 descending, 'best' = the showcase mode's: highest score first, or
// lowest in XXS mode), and the words for each direction in the menu. A key of null (no
// score, no CP read) sorts last in either direction. Ties go to the score, best first, then to
// the newest scan, so e.g. the Pokédex order lists each species' best one first.

const higher = { [-1]: 'highest first', 1: 'lowest first' };
const newer = { [-1]: 'newest first', 1: 'oldest first' };

/**
 * When a screenshot last came in for this row: the batch it came with (its start time) and its
 * place in that batch. Newest batch first, but within a batch in screenshot order, so the list
 * runs the way the storage was swiped. Rows from older versions have no `scanned`: their creation
 * time stands in.
 */
export const scanKey = row => [row.scanned ?? row.created ?? 0, -(row.scanIdx ?? 0)];

export const SORTS = {
	score: { label: 'Score', first: 'best', dirs: higher, key: e => (e.score ? e.score.total : null) },
	newest: { label: 'Newest', first: -1, dirs: newer, key: (e, row) => scanKey(row) },
	cp: { label: 'CP', first: -1, dirs: higher, key: e => e.cp ?? null },
	dex: { label: 'Pokédex', first: 1, dirs: { 1: '#1 first', [-1]: 'highest # first' }, key: e => (e.dex != null ? [e.dex, e.formName || ''] : null) },
	name: { label: 'Name', first: 1, dirs: { 1: 'A–Z', [-1]: 'Z–A' }, key: e => `${e.name || ''} ${e.formName || ''}`.trim().toLowerCase() || null },
	iv: { label: 'IVs', first: -1, dirs: higher, key: e => (e.ivs ? e.ivs.a + e.ivs.d + e.ivs.s : null) },
	caught: { label: 'Caught', first: -1, dirs: newer, key: e => caughtSortKey(e.caught) },
	// column headers only (the table on wider screens), not in the menu
	types: { first: 1, key: e => e.types || null },
	level: { first: -1, key: e => e.level ?? null },
	height: { first: -1, key: e => e.height_m ?? null },
	weight: { first: -1, key: e => e.weight_kg ?? null },
	status: { first: -1, key: e => e.issues.filter(i => !i.info).length },
};

/** The sorts offered in the menu, in menu order. */
export const MENU = Object.keys(SORTS).filter(k => SORTS[k].label);

/** Direction of the first tap on a sort; `best` is the mode's (MODES[mode].best). */
export const firstDir = (key, best) => (SORTS[key].first === 'best' ? best : SORTS[key].first);

/** The default order: by score, best first. */
export const isDefault = (sort, best) => sort.key === 'score' && sort.dir === best;

/**
 * A catch date as read ("4/19/2024" in the English client, "19.4.2024" elsewhere) as
 * YYYY-MM-DD, for sorting only, so a guess at the order of day and month is fine.
 */
export function caughtSortKey(s) {
	const m = /^(\d{1,4})\D(\d{1,2})\D(\d{1,4})$/.exec(s || '');
	if (!m) return null;
	const [a, b, c] = m.slice(1).map(Number);
	const [y, mo, d] = c > 31 ? [c, a > 12 ? b : a, a > 12 ? a : b] : [a, b, c];
	return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Compare two keys: numbers, strings, or arrays of them (element by element). */
export function cmp(a, b) {
	if (Array.isArray(a)) {
		for (let i = 0; i < Math.max(a.length, b.length); i++) {
			const c = cmp(a[i], b[i]);
			if (c) return c;
		}
		return 0;
	}
	if (a === b || a == null || b == null) return 0;
	if (typeof a === 'string') return a.localeCompare(b);
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort `list` ({row, e} items) in place by `sort` ({key, dir}); `best` is the mode's direction
 * for scores. Rows without a key go last; ties: score best first, then the newest scan.
 */
export function sortList(list, sort, best) {
	const s = SORTS[sort.key] || SORTS.score;
	const score = SORTS.score.key;
	const keyed = list.map(x => ({ x, k: s.key(x.e, x.row), sc: score(x.e), n: scanKey(x.row) }));
	keyed.sort((p, q) => {
		if ((p.k == null) !== (q.k == null)) return p.k == null ? 1 : -1;
		const c = cmp(p.k, q.k) * sort.dir;
		if (c) return c;
		if ((p.sc == null) !== (q.sc == null)) return p.sc == null ? 1 : -1;
		return cmp(p.sc, q.sc) * best || cmp(q.n, p.n);
	});
	keyed.forEach((k, i) => { list[i] = k.x; });
	return list;
}
