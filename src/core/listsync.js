// List sync: the game's list of the xxl search (xxs in XXS mode), from screenshots of it, matched
// to the rows. The game's list is the truth: a row with no tile is no longer in the game (traded,
// transferred), a row whose tile shows a later stage evolved, a tile with no row is new.
//
// A tile shows what every player has: its CP, and the species' name where the Pokémon was never
// renamed. That is what a tile matches by. Values a name gives ("Name to copy" names: the score,
// IV %, Attack, level; tilename.js) only narrow the rows a tile could be, or settle a tie;
// nothing depends on them. A tile that fits several rows leaves them all "not sure": never gone,
// never new. Nothing is marked gone unless the screenshots show the whole list: as many tiles as
// the game's count, none hidden, every one with its CP.
import { stitch, fieldIs } from './listview.js';
import { nameScore } from './tilename.js';
import { formsOf } from './gm.js';
import { levelTable, cpOf, levelsForHp } from './ivs.js';
import { evolveTargets, evolvedFrom } from './evolve.js';
import { findDexByName } from './text.js';
import { rowScore } from './score.js';

/** The search a sync lists: the mode's size class. */
export const syncSearch = mode => (mode === 'xxs' ? 'xxs' : 'xxl');

const rowOf = (gm, id, form) => {
	const f = formsOf(gm, id);
	return (f.find(x => x.form === (form || '')) || f.find(x => x.form === ''))?.row ?? null;
};

/** IVs known for sure: from the bars or typed in, not one of several sets CP and HP allow. */
const sureIvs = e => !!(e.ivs && (e.ivSource === 'bars+cp' || e.ivSource === 'bars' || e.ivSource === 'edit') && !(e.score && e.score.hi != null));

/**
 * The rows a sync matches: those of the mode's size class (e.xxl in XXL mode, e.xxs in XXS) with
 * a species. items: [{row, e}] (evaluated). → [{rowId, id, form, dex, name, cps: [{cp, level}],
 * ivs, atk, ivPct, score, caught, e}]: cps the CPs the row can show, one where it has a CP, the
 * ones its IVs and HP give at each level they allow where it has none (a CP the sprite hid).
 * Attack, IV % and the level only where the IVs are sure; the score as the name shows it.
 */
export function syncRows(items, ctx, mode = 'xxl') {
	const { gm } = ctx;
	const out = [];
	for (const { row, e } of items) {
		if (!e || !e.id || e.mega || e[mode === 'xxs' ? 'xxs' : 'xxl'] !== true) continue;
		const sure = sureIvs(e);
		const ivs = e.ivs ? [e.ivs.a, e.ivs.d, e.ivs.s] : null;
		let cps = [];
		if (e.cp != null) cps = [{ cp: e.cp, level: sure ? e.level : null }];
		else if (ivs && e.hp && sure) {
			const r = rowOf(gm, e.id, e.form);
			if (r) cps = levelsForHp(r, e.ivs, e.hp, gm.cpm).map(l => ({ cp: l.cp, level: l.level }));
		}
		const sc = rowScore(e);
		out.push({
			rowId: row.id, id: e.id, form: e.form || '', dex: e.dex ?? null, name: e.name || '',
			cps, ivs: sure ? ivs : null, atk: sure ? ivs[0] : null,
			ivPct: sure ? Math.round(((ivs[0] + ivs[1] + ivs[2]) / 45) * 100) : null,
			score: sc == null || (e.score && e.score.hi != null && e.inGame == null) ? null : Math.round(sc),
			caught: e.caught ?? null, e,
		});
	}
	return out;
}

/**
 * A tile's name and a row at one of its levels: nothing the name gives contradicts the row
 * (Attack and level the same, IV % and score within 1; a ½ the reader wasn't sure of lets the
 * half level agree too). A name that gives nothing agrees with anything.
 */
function agrees(p, r, level) {
	if (!p || p.style === 'none') return true;
	if (p.atk != null && r.atk != null && p.atk !== r.atk) return false;
	if (p.level != null && level != null && p.level !== level && !(p.halfMaybe && level === p.level + 0.5)) return false;
	if (p.ivPct != null && r.ivPct != null && Math.abs(p.ivPct - r.ivPct) > 1) return false;
	const s = nameScore(p);
	if (s != null && r.score != null && Math.abs(s - r.score) > 1) return false;
	return true;
}

/**
 * A name that says another Pokémon: two of Attack, IV % and level differ from the row's. The
 * score alone never does (it changes with a rescan or a fix, the name stays as it was).
 */
function contradicts(p, r, level) {
	if (!p || p.style === 'none') return false;
	let n = 0;
	if (p.atk != null && r.atk != null && p.atk !== r.atk) n++;
	if (p.ivPct != null && r.ivPct != null && Math.abs(p.ivPct - r.ivPct) > 1) n++;
	if (p.level != null && level != null && p.level !== level && !(p.halfMaybe && level === p.level + 0.5)) n++;
	return n >= 2;
}

/** Values a name gives, for "settles a tie": Attack, level or a score. */
const named = p => !!p && p.style !== 'none' && (p.atk != null || p.level != null || nameScore(p) != null);
/** A name read for sure with every value: Attack, IV %, level and the score. */
const fullName = p => !!p && p.style === 'new' && p.atk != null && p.ivPct != null && p.level != null && nameScore(p) != null;

/** A plain species name (a Pokémon never renamed): its Pokédex number, else null. */
const plainDex = (t, ctx) => (t.p && t.p.style === 'none' && t.p.raw ? findDexByName(t.p.raw, ctx.names) : null);

/** Two CPs one misread digit apart: one digit different, or one more or less. */
function oneDigit(a, b) {
	const x = String(a), y = String(b);
	if (x === y) return false;
	if (x.length === y.length) return [...x].filter((c, i) => c !== y[i]).length === 1;
	const [s, l] = x.length < y.length ? [x, y] : [y, x];
	if (l.length - s.length !== 1) return false;
	for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
	return false;
}

/** Rows alike: one Pokémon scanned twice (same species, form, CPs, IVs). */
const alike = rs => rs.every(r => r.id === rs[0].id && r.form === rs[0].form && String(r.ivs) === String(rs[0].ivs) && String(r.cps.map(c => c.cp)) === String(rs[0].cps.map(c => c.cp)));

/**
 * The screenshots of the sync's search: those whose search field reads it, and those whose field
 * wasn't read with the same count. Others (another search) are left out and counted.
 * → {own, other, count}
 */
export function ownShots(shots, search) {
	const yes = shots.filter(s => fieldIs(s.field, search) === true);
	const counts = new Map();
	for (const s of yes) if (s.count != null) counts.set(s.count, (counts.get(s.count) || 0) + 1);
	let count = null, k = 0;
	for (const [c, n] of counts) if (n > k) { count = c; k = n; }
	const own = shots.filter(s => yes.includes(s) || (fieldIs(s.field, search) == null && s.count != null && s.count === count));
	return { own, other: shots.length - own.length, count, countsAgree: counts.size <= 1 };
}

/**
 * Tiles in list order matched to rows. → {tiles: [{...tile, match?, how?, target?}], used: Set
 * of rows, evolved: Map row → {tile, target}, could: tile → rows it could be}.
 *
 * A tile's options: a row its CP fits ('cp'), or a row whose IVs at its level give the tile's
 * CP as a species it evolves into ('evolved'; not for a row whose evolved scan is a row of its
 * own already). A plain species name keeps those of its species; a name that says another
 * Pokémon (contradicts) drops one. A tile takes a row when it has one option left and no other
 * tile has that row for one; else the place in the list (sorted by number) narrows both sides,
 * then the name's values (a tile whose name agrees over one that gives none), then rows of one
 * Pokémon scanned twice count as one. The place only narrows: one tile matched wrong must not
 * push the next one's row out. Last, a CP misread by one digit, with a name that gives every
 * value, all agreeing. how: 'cp', 'place', 'name', 'alike', 'evolved', 'digit'.
 */
export function matchTiles(tiles, rows, ctx, { window: useWindow = true } = {}) {
	const { gm } = ctx;
	const used = new Set();
	const out = tiles.map(t => ({ ...t }));
	const dexOf = t => (t.target ? t.target.dex : t.match ? t.match.dex : null);
	// the species' place in the list: between the matched tiles above and below, never across an
	// edge between screenshots whose order isn't proven (brk)
	const window = i => {
		if (!useWindow) return [-Infinity, Infinity];
		let lo = -Infinity, hi = Infinity;
		for (let j = i - 1; j >= 0 && !out[j + 1].brk; j--) if (dexOf(out[j]) != null) { lo = dexOf(out[j]); break; }
		for (let j = i + 1; j < out.length && !out[j].brk; j++) if (dexOf(out[j]) != null) { hi = dexOf(out[j]); break; }
		return [lo, hi];
	};
	const inWindow = (dex, i) => { const [lo, hi] = window(i); return dex == null || (dex >= lo && dex <= hi); };
	// rows by the CPs they can show, as they are and evolved
	const byCp = new Map();
	const add = (cp, o) => byCp.set(cp, [...(byCp.get(cp) || []), o]);
	for (const r of rows) for (const c of r.cps) add(c.cp, { r, kind: 'cp', level: c.level, dex: r.dex });
	const rescanned = evolvedScans(rows, ctx);
	const lv = new Map(levelTable(gm.cpm).map(x => [x.level, x.m]));
	for (const r of rows) {
		if (!r.ivs || rescanned.has(r)) continue;
		const ls = [...new Set(r.cps.map(c => c.level).filter(l => l != null))];
		if (!ls.length) continue;
		for (const x of evolveTargets(gm, r.id, r.form)) {
			const row = rowOf(gm, x.id, x.form);
			if (!row) continue;
			const target = { id: x.id, form: x.form, dex: gm.species[x.id].dex };
			for (const l of ls) if (lv.has(l)) add(cpOf(row, r.ivs[0], r.ivs[1], r.ivs[2], lv.get(l)), { r, kind: 'evolved', level: l, dex: target.dex, target });
		}
	}
	const options = t => {
		if (t.cp == null) return [];
		const pd = plainDex(t, ctx);
		return (byCp.get(t.cp) || []).filter(o => !used.has(o.r) && (pd == null || o.dex === pd) && !contradicts(t.p, o.r, o.level));
	};
	const rowsOf = os => [...new Set(os.map(o => o.r))];
	const says = (t, o) => named(t.p) && agrees(t.p, o.r, o.level);
	// a tile's options narrowed (pass 1: by the place, then the name)
	const narrowed = (i, pass) => {
		let os = options(out[i]);
		if (!pass || rowsOf(os).length < 2) return os;
		const w = os.filter(o => inWindow(o.dex, i));
		if (w.length) os = w;
		if (rowsOf(os).length < 2) return os;
		const n = os.filter(o => says(out[i], o));
		return rowsOf(n).length === 1 ? n : os;
	};
	// the tiles that could take row r, narrowed the same way from the row's side
	const tilesByCp = new Map();
	out.forEach((t, i) => { if (t.cp != null) tilesByCp.set(t.cp, [...(tilesByCp.get(t.cp) || []), i]); });
	const rowCps = new Map();
	for (const [cp, os] of byCp) for (const o of os) rowCps.set(o.r, [...(rowCps.get(o.r) || []), cp]);
	const wanting = (r, pass) => {
		let w = [];
		for (const cp of new Set(rowCps.get(r) || [])) for (const i of tilesByCp.get(cp) || []) {
			if (out[i].match) continue;
			const os = options(out[i]).filter(o => o.r === r);
			if (os.length) w.push({ i, os });
		}
		if (!pass || w.length < 2) return w.map(x => x.i);
		const p = w.filter(x => x.os.some(o => inWindow(o.dex, x.i)));
		if (p.length) w = p;
		if (w.length < 2) return w.map(x => x.i);
		const n = w.filter(x => x.os.some(o => says(out[x.i], o)));
		return (n.length === 1 ? n : w).map(x => x.i);
	};
	const take = (i, os, how) => {
		const r = os[0].r;
		// one row into two forms (Grimer: Muk or Alolan Muk by CP): the row's own form
		const evo = os.filter(o => o.kind === 'evolved');
		const o = os.find(x => x.kind === 'cp') || evo.find(x => (x.target.form || '') === r.form) || evo[0];
		used.add(r);
		Object.assign(out[i], { match: r, how: o.kind === 'evolved' ? 'evolved' : how, level: o.level });
		if (o.kind === 'evolved') out[i].target = o.target;
	};
	for (let pass = 0; pass < 2; pass++) {
		let moved = true;
		while (moved) {
			moved = false;
			out.forEach((t, i) => {
				if (t.match || t.cp == null) return;
				const os = narrowed(i, pass);
				const rs = rowsOf(os);
				if (!rs.length) return;
				// a row with one CP and its evolution both fitting: no guess
				if (rs.length === 1 && new Set(os.map(o => o.kind)).size > 1) return;
				if (rs.length === 1) {
					const w = wanting(rs[0], pass);
					if (w.length === 1 && w[0] === i) {
						const how = !pass ? 'cp' : options(t).length > os.length && rowsOf(options(t).filter(o => inWindow(o.dex, i))).length === 1 ? 'place' : 'name';
						take(i, os, how); moved = true;
					}
					return;
				}
				if (pass && os.every(o => o.kind === 'cp') && alike(rs)) { take(i, os.filter(o => o.r === rs[0]), 'alike'); moved = true; }
			});
		}
	}
	// last, a CP misread by one digit
	out.forEach((t, i) => {
		if (t.match || t.cp == null || !fullName(t.p)) return;
		const c = rows.filter(r => !used.has(r) && inWindow(r.dex, i) && r.cps.length === 1 && oneDigit(r.cps[0].cp, t.cp) && r.atk != null && r.score != null && agrees(t.p, r, r.cps[0].level));
		if (c.length === 1) { used.add(c[0]); Object.assign(t, { match: c[0], how: 'digit', level: c[0].cps[0].level }); }
	});
	const evolved = new Map();
	for (const t of out) if (t.how === 'evolved') evolved.set(t.match, { tile: t, target: t.target });
	// what a tile no row took could be: the rows of its options, and by a name with every value
	const could = t => {
		const rs = new Set(rowsOf((byCp.get(t.cp) || []).filter(o => !used.has(o.r))));
		if (fullName(t.p) || (t.cp == null && named(t.p))) for (const r of rows) if (!used.has(r) && r.atk != null && r.cps.some(c => c.level != null && agrees(t.p, r, c.level))) rs.add(r);
		return [...rs];
	};
	return { tiles: out, used, evolved, could };
}

/** Rows whose evolved scan is a row of its own (same catch date and IVs, X67's test). */
function evolvedScans(rows, ctx) {
	const by = new Map();
	for (const r of rows) if (r.caught && r.e) by.set(r.caught, [...(by.get(r.caught) || []), r]);
	const out = new Set();
	for (const g of by.values()) if (g.length > 1) for (const r of g) if (g.some(s => s !== r && evolvedFrom(r.e, s.e, ctx))) out.add(r);
	return out;
}

/**
 * The sync. shots: readListShot's results (any order, overlapping or not); items: the rows,
 * evaluated ([{row, e}]). → {at, mode, search, shots, other, count, read, complete, why,
 * matched, marks: {rowId: {k: 'gone' | 'evolved' | 'unsure', why}}, newCps, newSearch, unsure}
 * newSearch: a search for the new tiles ("xxl&cp512,cp1480"), '' when there are none.
 */
export function runSync(shots, items, ctx, { mode = 'xxl', now = Date.now() } = {}) {
	const search = syncSearch(mode);
	const rows = syncRows(items, ctx, mode);
	const { own, other, count, countsAgree } = ownShots(shots, search);
	const res = { at: now, mode, search, shots: own.length, other, count, read: 0, complete: false, why: '', matched: 0, marks: {}, newCps: [], newSearch: '', unsure: 0 };
	if (!own.length) { res.why = `None of these screenshots shows the search ${search}.`; return res; }
	// the list's order helps only where every screenshot shows it sorted by number
	const numbered = own.every(s => s.num === true);
	const at = numbered ? dexAt(rows, ctx) : null;
	const st = stitch(own, { at });
	res.read = st.tiles.length;
	const { tiles, used, evolved, could } = matchTiles(st.tiles, rows, ctx, { window: numbered });
	res.matched = tiles.filter(t => t.match && t.how !== 'evolved').length;
	const marks = {};
	for (const [r, { target }] of evolved) marks[r.rowId] = { k: 'evolved', why: `Evolved into ${ctx.text.names[String(target.dex)] || target.id}: scan it again` };
	// tiles no row took: the rows they could be are not sure; a tile no row could be is new
	const unsureTiles = [];
	for (const t of tiles) {
		if (t.match) continue;
		const rs = could(t);
		if (rs.length || t.cp == null) {
			unsureTiles.push(t);
			for (const r of rs) marks[r.rowId] = { k: 'unsure', why: t.cp == null ? 'A tile without its CP could be this one' : `A tile of CP ${t.cp} could be this one` };
		} else res.newCps.push(t.cp);
	}
	res.unsure = unsureTiles.length;
	if (res.newCps.length) res.newSearch = `${search}&${[...new Set(res.newCps)].sort((a, b) => a - b).map(c => `cp${c}`).join(',')}`;
	// gone: only from the whole list
	const why = [];
	if (count == null) why.push('the count in the header wasn\'t read');
	else if (!countsAgree) why.push('the screenshots show different counts');
	else if (st.tiles.length < count) why.push(`${count - st.tiles.length} of the ${count} Pokémon are on no screenshot`);
	else if (st.tiles.length > count) why.push(`${st.tiles.length} Pokémon read, the game counts ${count}`);
	if (st.covered - st.trailing > 0) why.push(`${st.covered - st.trailing} hidden under the buttons`);
	if (st.tiles.some(t => t.cp == null)) why.push('a CP wasn\'t read');
	res.complete = !why.length;
	res.why = why.length ? `Nothing marked as not in the game: ${why.join('; ')}.` : '';
	if (res.complete) {
		const seenRows = rows.filter(r => used.has(r) && !evolved.has(r));
		for (const r of rows.filter(x => !used.has(x))) {
			if (marks[r.rowId]) continue;
			// scanned twice: the other scan has the tile
			const twin = seenRows.find(s => alike([r, s]));
			// evolved and scanned again: its new row has the tile
			const next = seenRows.find(s => s.e && r.e && evolvedFrom(r.e, s.e, ctx));
			marks[r.rowId] = { k: 'gone', why: twin ? 'Not in the game: a second row of a Pokémon that is' : next ? `Not in the game: evolved, its new row ${next.name} is` : 'Not in the game' };
		}
	}
	res.marks = marks;
	return res;
}

/**
 * The Pokédex number a tile gives for sure (to put screenshots without an overlap in order): the
 * rows its CP fits (and its name, where it gives values) all of one species. → tile → number | null
 */
export function dexAt(rows, ctx) {
	const byCp = new Map();
	for (const r of rows) for (const c of r.cps) byCp.set(c.cp, [...(byCp.get(c.cp) || []), { r, level: c.level }]);
	return t => {
		if (!t || t.cp == null || t.cut) return null;
		const pd = plainDex(t, ctx);
		if (pd != null) return pd;
		const hit = (byCp.get(t.cp) || []).filter(x => x.r.dex != null && agrees(t.p, x.r, x.level));
		return hit.length && hit.every(x => x.r.dex === hit[0].r.dex) ? hit[0].r.dex : null;
	};
}

/** Counts by mark, for the banner and the debug report. */
export function markCounts(marks) {
	const n = { gone: 0, evolved: 0, unsure: 0 };
	for (const m of Object.values(marks || {})) if (Object.hasOwn(n, m.k)) n[m.k]++;
	return n;
}
