// List sync on made-up list screenshots (the reader's results, written by hand) and made-up game
// data: tiles matched to rows by CP, ties left "not sure", evolved rows, new tiles and their
// search, another search's screenshots, a list not seen whole. Also the list view test on drawn
// pixels, the search terms for the marks, and the level from HP alone ("28.5 or 29").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactGameMaster, formsOf } from '../src/core/gm.js';
import { compactText } from '../src/core/text.js';
import { makeContext, evaluate, levelText } from '../src/core/evaluate.js';
import { levelTable, cpOf, levelsForHp } from '../src/core/ivs.js';
import { runSync, cpFromList, markCounts, markOf, newLeft, newSearch, syncSearch, inListNow, MARKS } from '../src/core/listsync.js';
import { isListView } from '../src/core/listview.js';
import { compileSearch } from '../src/core/search.js';
import { formatName, nameValues } from '../src/core/nickname.js';
import { gameSearch } from '../src/core/gamesearch.js';
import { syntheticGameMaster, syntheticText } from './synthetic.js';

const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
// an evolution for the test: Testmon → Fakeon
gm.species.TESTMON.evo = { '': ['FAKEON'] };
const ctx = makeContext(gm, compactText(syntheticText('en')));
const lv = new Map(levelTable(gm.cpm).map(x => [x.level, x.m]));
const rowOf = id => formsOf(gm, id).find(f => f.form === '').row;

/** An evaluated row as syncRows reads it: a sure set of IVs (bars), a level and its CP. */
let n = 0;
function item(id, ivs, level, { cp, caught = null } = {}) {
	const r = rowOf(id);
	const e = {
		id, form: '', dex: gm.species[id].dex, name: id[0] + id.slice(1).toLowerCase(), xxl: true, mega: false,
		ivs: { a: ivs[0], d: ivs[1], s: ivs[2] }, ivSource: 'bars', level,
		cp: cp === undefined ? cpOf(r, ivs[0], ivs[1], ivs[2], lv.get(level)) : cp, hp: null, caught, score: null, inGame: null,
	};
	return { row: { id: `r${++n}`, created: 0, scanned: 0 }, e };
}

const tile = (cp, p = null) => ({ col: 0, name: p ? p.raw : null, p, cp, cut: false });
/** One screenshot holding the whole list: three tiles a row, the end shown by an empty place. */
function shot(tiles, { count = tiles.length, field = 'xxl' } = {}) {
	const rows = [];
	const all = [...tiles, 'empty'];
	while (all.length % 3) all.push('empty');
	for (let i = 0; i < all.length; i += 3) rows.push({ y: i * 100, slots: all.slice(i, i + 3).map((t, c) => (typeof t === 'object' ? { ...t, col: c } : t)) });
	return { count, field, rows, pill: null, num: false };
}

test('the whole list: matched by CP, a row with no tile gone, a tile with no row new', () => {
	const a = item('TESTMON', [15, 15, 15], 20), b = item('MR_FAKE', [10, 12, 14], 25), c = item('FAKEON', [1, 2, 3], 15);
	const res = runSync([shot([tile(a.e.cp), tile(b.e.cp), tile(4321)])], [a, b, c], ctx, { now: 1 });
	assert.equal(res.complete, true, res.why);
	assert.equal(res.matched, 2);
	assert.deepEqual(Object.keys(res.marks), [c.row.id]);
	assert.equal(res.marks[c.row.id].k, 'gone');
	assert.deepEqual(res.newCps, [4321]);
	assert.equal(res.newSearch, 'xxl&cp4321');
	assert.deepEqual(markCounts(res.marks), { gone: 1, evolved: 0, unsure: 0 });
});

test('a CP two rows share: both not sure, neither gone, no tile new', () => {
	const a = item('TESTMON', [15, 15, 15], 20), b = item('MR_FAKE', [10, 12, 14], 25, { cp: a.e.cp });
	const res = runSync([shot([tile(a.e.cp)])], [a, b], ctx, { now: 1 });
	assert.equal(res.marks[a.row.id].k, 'unsure');
	assert.equal(res.marks[b.row.id].k, 'unsure');
	assert.deepEqual(res.newCps, []);
	// the species' plain name (never renamed) settles it
	const named = runSync([shot([tile(a.e.cp, { style: 'none', raw: 'Mr. Fake' })])], [a, b], ctx, { now: 1 });
	assert.equal(named.matched, 1);
	assert.equal(named.marks[a.row.id].k, 'gone');
	assert.equal(named.marks[b.row.id], undefined);
});

test('a tile showing the evolved species: "evolved, scan again", not gone', () => {
	const a = item('TESTMON', [12, 13, 14], 22.5);
	const evolvedCp = cpOf(rowOf('FAKEON'), 12, 13, 14, lv.get(22.5));
	assert.notEqual(evolvedCp, a.e.cp);
	const res = runSync([shot([tile(evolvedCp)])], [a], ctx, { now: 1 });
	assert.equal(res.complete, true, res.why);
	assert.equal(res.marks[a.row.id].k, 'evolved');
	assert.match(res.marks[a.row.id].why, /Fakeon/);
	assert.deepEqual(res.newCps, []);
	// Find in game while marked: the evolved species with the tile's CP (the row's own search
	// finds nothing in the game now); IVs stay, HP doesn't
	const as = res.marks[a.row.id].as;
	assert.deepEqual(as, { dex: gm.species.FAKEON.dex, name: 'Fakeon', cp: evolvedCp });
	const e = { ...a.e, hp: 90, caught: '5/1/2024' };
	assert.equal(gameSearch(e), `${a.e.dex}&xxl&cp${a.e.cp}&hp90&3attack&3defense&3hp&year2024`);
	assert.equal(gameSearch(e, as), `${as.dex}&xxl&cp${evolvedCp}&3attack&3defense&3hp&year2024`);
});

test('"n of them in this list" follows the rescans: evolved, not sure and new ones count once scanned', () => {
	const a = item('TESTMON', [12, 13, 14], 22.5), b = item('MR_FAKE', [10, 12, 14], 25), c = item('FAKEON', [1, 2, 3], 15, { cp: b.e.cp });
	const evolvedCp = cpOf(rowOf('FAKEON'), 12, 13, 14, lv.get(22.5));
	const res = runSync([shot([tile(evolvedCp), tile(b.e.cp), tile(4321)])], [a, b, c], ctx, { now: 1 });
	assert.deepEqual(markCounts(res.marks), { gone: 0, evolved: 1, unsure: 2 });
	assert.equal(res.matched, 0);
	assert.equal(inListNow(res, markCounts(res.marks), [4321]), 0);
	// the evolved row scanned again, one of the two not-sure rows too: its tile still open
	assert.equal(inListNow(res, { gone: 0, evolved: 0, unsure: 1 }, [4321]), 1);
	// both not-sure rows settled, the new one added
	assert.equal(inListNow(res, { gone: 0, evolved: 0, unsure: 0 }, []), 3);
});

test('a name that says another Pokémon (Attack and IV % off): not matched, the row not sure, never gone', () => {
	const a = item('TESTMON', [15, 15, 15], 20);
	const p = { style: 'new', raw: 'XX1000^20(3)[20]', prefix: 'XX1000', atk: 3, ivPct: 20, level: 20 };
	const res = runSync([shot([tile(a.e.cp, p)])], [a], ctx, { now: 1 });
	assert.equal(res.matched, 0);
	assert.equal(res.marks[a.row.id].k, 'unsure');
	assert.deepEqual(res.newCps, []);
});

test('another search\'s screenshots: left out and counted; none of the search: nothing marked', () => {
	const a = item('TESTMON', [15, 15, 15], 20), b = item('MR_FAKE', [10, 12, 14], 25);
	const res = runSync([shot([tile(a.e.cp), tile(b.e.cp)]), shot([tile(a.e.cp)], { field: 'xxl&!XX' })], [a, b], ctx, { now: 1 });
	assert.equal(res.other, 1);
	assert.equal(res.matched, 2);
	const none = runSync([shot([tile(a.e.cp)], { field: 'xxs' })], [a, b], ctx, { now: 1 });
	assert.equal(none.shots, 0);
	assert.deepEqual(none.marks, {});
	assert.match(none.why, /xxl/);
	assert.equal(syncSearch('xxs'), 'xxs');
});

test('a list not seen whole: nothing marked gone, and it says why', () => {
	const a = item('TESTMON', [15, 15, 15], 20), b = item('MR_FAKE', [10, 12, 14], 25);
	const res = runSync([shot([tile(a.e.cp)], { count: 2 })], [a, b], ctx, { now: 1 });
	assert.equal(res.complete, false);
	assert.match(res.why, /1 of the 2 Pokémon are on no screenshot/);
	assert.deepEqual(res.marks, {});
	const noCp = runSync([shot([tile(a.e.cp), tile(null)])], [a, b], ctx, { now: 1 });
	assert.equal(noCp.complete, false);
	assert.equal(markCounts(noCp.marks).gone, 0);
});

test('screenshots in any order read the same', () => {
	const its = [item('TESTMON', [15, 15, 15], 20), item('MR_FAKE', [10, 12, 14], 25), item('FAKEON', [1, 2, 3], 15), item('MR_FAKE', [0, 0, 0], 30)];
	const [s1, s2] = [shot([tile(its[0].e.cp), tile(its[1].e.cp), tile(its[2].e.cp)], { count: 4 }), shot([tile(its[2].e.cp), tile(its[3].e.cp)], { count: 4 })];
	// two screenshots overlapping in one tile: the first without the list's end
	s1.rows = s1.rows.map(r => ({ ...r, slots: r.slots.map(x => (x === 'empty' ? 'covered' : x)) }));
	const one = runSync([s1, s2], its, ctx, { now: 1 }), two = runSync([s2, s1], its, ctx, { now: 1 });
	assert.deepEqual(one.marks, two.marks);
	assert.equal(one.matched, two.matched);
});

test('a mark holds until the row is scanned again; new Pokémon counted until scanned', () => {
	const sync = { at: 100, search: 'xxl', marks: { r: { k: 'gone', why: 'Not in the game' } }, newCps: [500, 700] };
	assert.equal(markOf(sync, { id: 'r', scanned: 50 }).k, 'gone');
	assert.equal(markOf(sync, { id: 'r', scanned: 150 }), null);
	assert.equal(markOf(null, { id: 'r' }), null);
	const left = newLeft(sync, [{ row: { created: 150 }, e: { cp: 700 } }, { row: { created: 50 }, e: { cp: 500 } }]);
	assert.deepEqual(left, [500]);
	assert.equal(newSearch('xxl', [700, 512, 700]), 'xxl&cp512,cp700');
	assert.equal(newSearch('xxl', []), '');
	assert.deepEqual(Object.keys(MARKS), ['gone', 'evolved', 'unsure']);
});

test('search terms gone, evolved, unsure read the marks; without them nothing matches', () => {
	const marks = { a: 'gone', b: 'evolved', c: 'unsure' };
	const mark = row => marks[row.id] ?? null;
	const e = { name: 'Testmon', formName: '', types: 'Normal' };
	for (const [q, id] of [['gone', 'a'], ['evolved', 'b'], ['unsure', 'c']]) {
		const p = compileSearch(q, null, { mark });
		assert.deepEqual(['a', 'b', 'c', 'd'].filter(x => p(e, { id: x })), [id], q);
	}
	assert.equal(compileSearch('!gone', null, { mark })(e, { id: 'b' }), true);
	assert.equal(compileSearch('gone')(e, { id: 'a' }), false);
});

/** A white screen with tile bars drawn (iPhone 17 green) at [col, y in W]. */
function screen(bars, W = 400, H = 870) {
	const data = new Uint8ClampedArray(W * H * 4).fill(255);
	const COLS = [0.183, 0.5, 0.815];
	for (const [c, yw] of bars) {
		const x0 = Math.round((COLS[c] - 0.07) * W), x1 = Math.round((COLS[c] + 0.07) * W), y0 = Math.round(yw * W);
		for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x1; x++) data.set([110, 238, 184, 255], (y * W + x) * 4);
	}
	return { width: W, height: H, data };
}

test('a list view: a row of tile bars, or one tile alone where the first row sits; not a lone bar elsewhere', () => {
	assert.equal(isListView(screen([[0, 0.86], [1, 0.86], [2, 0.86]])), true);
	assert.equal(isListView(screen([[0, 0.86], [0, 1.22]])), true);
	assert.equal(isListView(screen([[0, 0.86]])), true);
	// a Pokémon's page: its move's energy bar, low on the screen
	assert.equal(isListView(screen([[0, 1.74]])), false);
	// two shapes at the top, closer than a tile
	assert.equal(isListView(screen([[1, 0.05], [1, 0.07]])), false);
	assert.equal(isListView(screen([])), false);
});

test('level from the HP alone: "a or b", the lower one with a ? in the name; the CP settles it', () => {
	const r = rowOf('TESTMON');
	// IVs and an HP that two levels share
	let found = null;
	for (let hp = 10; hp < 300 && !found; hp++) {
		const l = levelsForHp(r, { a: 7, d: 10, s: 3 }, hp, gm.cpm);
		if (l.length === 2) found = { hp, l };
	}
	assert.ok(found, 'an HP two levels share');
	const reading = { species: 'Testmon', caught: '7/28/2024', hp: found.hp, cp: null, height_m: 1.7, weight_kg: 30, bars: { a: 7, d: 10, s: 3 } };
	// the normal form (the Giant one gives one CP at this HP, which would settle it)
	const e = evaluate(reading, ctx, { form: '' });
	assert.deepEqual(e.levels, found.l.map(x => x.level));
	assert.equal(e.level, found.l[0].level);
	assert.deepEqual(e.cpExpected, found.l.map(x => x.cp));
	assert.equal(levelText(e), `${found.l[0].level} or ${found.l[1].level}`);
	assert.ok(e.issues.some(i => i.code === 'level' && !i.info));
	assert.match(formatName('{lvl:circ}', nameValues(e)).text, /\?$/);
	assert.equal(formatName('{lvlMaybe}', nameValues(e)).text, '{lvlMaybe}');
	// the search for the game: a CP range for the bars one IV off, both levels' CPs in it, and the
	// page's search finds the row at either CP
	const m = /&cp(\d+)-(\d+)&hp(\d+)&/.exec(gameSearch(e));
	assert.ok(m, gameSearch(e));
	assert.ok(+m[1] <= found.l[0].cp && found.l[1].cp <= +m[2] && +m[3] === found.hp);
	for (const l of found.l) assert.ok(compileSearch(gameSearch(e))({ ...e, cp: l.cp }));
	const typed = evaluate(reading, ctx, { form: '', cp: found.l[1].cp });
	assert.equal(typed.levels, null);
	assert.equal(typed.level, found.l[1].level);
	assert.equal(levelText(typed), found.l[1].level);
	assert.doesNotMatch(formatName('{lvl:circ}', nameValues(typed)).text, /\?/);
	assert.match(gameSearch(typed), new RegExp(`&cp${found.l[1].cp}&`));
});

test('a CP from a list screenshot of any search, for a row without one, where only it fits', () => {
	// a row whose CP wasn't read: two levels by the HP, a range for the bars one IV off
	const open = (id, cps, o = {}) => {
		const x = item(id, [7, 10, 3], 20, { cp: null });
		x.e = { ...x.e, levels: [20, 20.5], cpExpected: cps, near: { cp: { lo: cps[0] - 20, hi: cps[1] + 20 } }, ...o };
		return x;
	};
	const a = open('TESTMON', [500, 510]), b = item('MR_FAKE', [10, 12, 14], 25);
	const plain = name => ({ style: 'none', raw: name });
	const find = '641&xxl&cp480-530&hp93&2attack&2defense&1hp';
	assert.deepEqual(cpFromList([shot([tile(510, plain('Testmon'))], { field: find })], [a, b], ctx), [{ rowId: a.row.id, cp: 510 }]);
	// inside the range for the bars one IV off, not a level's CP: taken too
	assert.deepEqual(cpFromList([shot([tile(522, plain('Testmon'))], { field: find })], [a, b], ctx), [{ rowId: a.row.id, cp: 522 }]);
	// outside it, another species, a cut tile: not
	assert.deepEqual(cpFromList([shot([tile(560, plain('Testmon'))])], [a, b], ctx), []);
	assert.deepEqual(cpFromList([shot([tile(510, plain('Mr. Fake'))])], [a, b], ctx), []);
	assert.deepEqual(cpFromList([shot([{ ...tile(510, plain('Testmon')), cut: true }])], [a, b], ctx), []);
	// a "Name to copy" whose values agree (Attack 7), or contradict it (Attack 3)
	assert.deepEqual(cpFromList([shot([tile(505, { style: 'new', atk: 7, raw: 'x' })])], [a, b], ctx), [{ rowId: a.row.id, cp: 505 }]);
	assert.deepEqual(cpFromList([shot([tile(505, { style: 'new', atk: 3, raw: 'x' })])], [a, b], ctx), []);
	// a name that says nothing: could be any Pokémon of that CP
	assert.deepEqual(cpFromList([shot([tile(505, plain('Xyz'))])], [a, b], ctx), []);
	// two rows without a CP it could be: neither
	const a2 = open('TESTMON', [505, 515]);
	assert.deepEqual(cpFromList([shot([tile(510, plain('Testmon'))])], [a, a2, b], ctx), []);
	// a row that has this CP and fits the tile: it is that one's
	const c = item('TESTMON', [1, 2, 3], 30, { cp: 510 });
	assert.deepEqual(cpFromList([shot([tile(510, plain('Testmon'))])], [a, b, c], ctx), []);
	// the same tile on two screenshots: once; two tiles with different CPs for the row: none
	assert.deepEqual(cpFromList([shot([tile(510, plain('Testmon'))]), shot([tile(510, plain('Testmon'))])], [a, b], ctx), [{ rowId: a.row.id, cp: 510 }]);
	assert.deepEqual(cpFromList([shot([tile(500, plain('Testmon')), tile(510, plain('Testmon'))])], [a, b], ctx), []);
	// rows with a CP only: nothing to do
	assert.deepEqual(cpFromList([shot([tile(510, plain('Testmon'))])], [b, c], ctx), []);
});

test('a tile without its CP: named, its rows not sure and the rest gone; else it blocks and its screenshot is named', () => {
	const a = item('TESTMON', [15, 15, 15], 20), b = item('MR_FAKE', [10, 12, 14], 25), c = item('FAKEON', [1, 2, 3], 15);
	// a name that says nothing: any row could be it, nothing gone, the file to take again
	const blind = runSync([{ ...shot([tile(a.e.cp), tile(null, { style: 'none', raw: 'Xyz' })], { count: 3 }), file: 'shot-7.png' }], [a, b, c], ctx, { now: 1 });
	assert.equal(blind.complete, false);
	assert.match(blind.why, /a CP wasn't read \(shot-7\.png: take it again\)/);
	assert.equal(markCounts(blind.marks).gone, 0);
	// a name whose values point to one row (Attack 10, level 25: Mr. Fake): that row not sure,
	// the other gone
	const named = runSync([shot([tile(a.e.cp), tile(null, { style: 'new', atk: 10, level: 25, ivPct: 80, raw: 'x' })], { count: 2 })], [a, b, c], ctx, { now: 1 });
	assert.equal(named.complete, true, named.why);
	assert.equal(named.marks[b.row.id].k, 'unsure');
	assert.equal(named.marks[c.row.id].k, 'gone');
	assert.equal(named.marks[a.row.id], undefined);
});
