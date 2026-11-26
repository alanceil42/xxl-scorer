// The list tile reader on list screenshots drawn in code (tests/lib/drawlist.js), with an engine
// that reads the drawn block font back: the header's count and search field, tiles by their
// bars, CP and name, a tile cut by the header, the scroll pill over a tile, the floating buttons,
// the sort button's "#"; then stitching screenshots of one list in any order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	readListShot, findBars, isListView, gridRows, partBox, headerBottom, scrollPill, searchField, readSearchField,
	fieldIs, parseTileCp, parseCount, sortedByNumber, slotState, sameName, sameValues, sameByName, stitch, cropBesidePill,
} from '../src/core/listview.js';
import { drawShot, fakeEngine, blank, rect, BAR, WHITE } from './lib/drawlist.js';

const nm = (prefix, sup, disc, ring, more = {}) => ({ prefix, sup, disc, ring, ...more });
const T = (cp, name, more = {}) => ({ cp, name, ...more });
const W = 1206, PITCH = 0.361;

/** The readings in short: [cp, the name as parsed (raw), cut] per tile, the rest as it is. */
const brief = r => r.rows.map(x => x.slots.map(t => (typeof t === 'object' ? [t.cp, t.name, t.cut, ...(t.partial ? ['partial'] : []), ...(t.under ? ['under'] : [])] : t)));

test('one drawn screenshot: count, search field, each tile\'s CP and name, sorted by number', async () => {
	const img = drawShot({ count: 5, rows: [
		{ y: 0.82, tiles: [T(512, nm('XX512', '80', '15', '29')), T(1480, nm('XX990', '91', '7', '31')), T(77, nm('XX77', '64', '3', '12'))] },
		{ y: 0.82 + PITCH, tiles: [T(300, nm('XX300', '100', '15', '40')), T(401, nm('', '0', '0', '1')), null] },
	] });
	assert.ok(isListView(img));
	assert.equal(headerBottom(img), Math.round(0.5 * W));
	const e = fakeEngine();
	const r = await readListShot(img, e);
	assert.equal(r.count, 5);
	assert.equal(r.field, 'XXL');
	assert.equal(fieldIs(r.field, 'xxl'), true);
	assert.equal(r.pill, null);
	assert.equal(r.num, true);
	assert.deepEqual(brief(r), [
		[[512, 'XX512^80(15)[29]', false], [1480, 'XX990^91(7)[31]', false], [77, 'XX77^64(3)[12]', false]],
		[[300, 'XX300^100(15)[40]', false], [401, '^0(0)[1]', false], 'empty'],
	]);
	const p = r.rows[0].slots[0].p;
	assert.deepEqual([p.style, p.prefix, p.ivPct, p.total, p.atk, p.level], ['new', 'XX512', 80, 36, 15, 29]);
	// the engine gave nothing for the circles (not its font): the templates read them
	assert.ok(e.calls.some(c => c.whitelist === '0123456789'));
});

test('a tile whose CP lies under the header: cut, its name still read; a tile under a button: covered', async () => {
	const top = 0.5, y0 = top + 0.2;
	const rows = [
		{ y: y0, tiles: [T(null, nm('XX512', '80', '15', '29')), T(null, nm('XX990', '91', '7', '31')), T(null, nm('XX77', '64', '3', '12'))] },
		{ y: y0 + PITCH, tiles: [T(300, nm('XX300', '100', '15', '40')), T(401, nm('XX401', '0', '0', '1')), T(150, nm('XX150', '51', '9', '20'))] },
	];
	// the bottom row: the close and tag buttons lie over the middle and right tiles
	const H = Math.round((y0 + 2 * PITCH + 0.131 + 0.01) * W);
	rows.push({ y: y0 + 2 * PITCH, tiles: [T(220, nm('XX220', '40', '2', '18')), null, null] });
	const img = drawShot({ H, count: 9, rows, sort: 'other' });
	const r = await readListShot(img, fakeEngine());
	const b = brief(r);
	assert.deepEqual(b[0].map(t => [t[0], t[2]]), [[null, true], [null, true], [null, true]], 'no CP: cut');
	assert.equal(b[0][0][1], 'XX512^80(15)[29]');
	assert.deepEqual(b[2].slice(1), ['covered', 'covered']);
	assert.equal(b[2][0][0], 220);
	assert.equal(r.num, false, 'another sort icon');
	assert.equal(slotState(img, Math.round((y0 + 2 * PITCH) * W), 1), 'covered');
	assert.equal(slotState(img, Math.round((y0 + PITCH) * W), 1), 'empty');
});

test('the scroll pill: a name running under it is partial, a CP under it unread, one clear of it read', async () => {
	const y = 0.82;
	const pill = { y0: y - 0.09, y1: y + 0.03 };
	const img = drawShot({ count: 3, pill, rows: [
		{ y, tiles: [T(512, nm('XX512', '80', '15', '29')), T(1480, nm('XX990', '91', '7', '31')), T(77, nm('XX77', '64', '3', '12'))] },
		{ y: y + PITCH, tiles: [T(300, nm('XX300', '100', '15', '40')), null, null] },
	] });
	const p = scrollPill(img);
	assert.ok(p && Math.abs(p.y0 - pill.y0 * W) <= 1 && p.x0 <= 0.9 * W + 1);
	const r = await readListShot(img, fakeEngine());
	assert.equal(r.pill, p.y0);
	const t = r.rows[0].slots[2];
	assert.equal(t.cp, 77, 'the CP ends short of the pill');
	assert.ok(t.partial && t.under && t.name == null, 'the name runs under the pill');

	// a CP reaching into the pill, and a short name beside it with its circles in the halo
	const img2 = drawShot({ count: 1, pill: { y0: y - 0.3, y1: y + 0.03 }, rows: [{ y, tiles: [null, null, T(123456, nm('', '', '7', '29'))] }] });
	const r2 = await readListShot(img2, fakeEngine());
	const t2 = r2.rows[0].slots[2];
	assert.equal(t2.cp, null);
	assert.equal(t2.cut, true);
	assert.equal(t2.name, '(7)[29]', 'read by the templates at the halo\'s lighter levels');
});

test('cropBesidePill: without a pill the crop as it is; ink right at the pill blocks a CP', () => {
	const img = blank(W, W);
	const box = { x: 900, y: 600, w: 200, h: 40 };
	assert.equal(cropBesidePill(img, box, null).width, 200);
	rect(img, 1080, 600, 1, 40, [0, 0, 0]);
	rect(img, Math.round(0.9 * W), 560, 70, 200, WHITE);
	const pill = scrollPill(img, 0);
	assert.ok(pill);
	assert.equal(cropBesidePill(img, box, pill, 'cp'), null);
	assert.ok(cropBesidePill(img, { x: 700, y: 600, w: 100, h: 40 }, pill, 'cp'), 'a box clear of the pill');
});

test('not a list: a blank page, a lone bar out of place; one tile alone where the first row sits is', () => {
	const img = blank(W, 2 * W);
	assert.equal(isListView(img), false);
	assert.equal(headerBottom(img), null);
	assert.equal(searchField(img), null);
	assert.equal(scrollPill(img), null);
	assert.equal(sortedByNumber(img), false, 'light all over: no "#"');
	rect(img, 0.183 * W - 0.0675 * W, 0.3 * W, 0.135 * W, 10, BAR);
	assert.equal(isListView(img), false, 'too high up');
	const one = blank(W, 2 * W);
	rect(one, 0.183 * W - 0.0675 * W, 0.8 * W, 0.135 * W, 10, BAR);
	assert.equal(isListView(one), true);
	const bars = findBars(one);
	assert.deepEqual(gridRows(bars, W).map(r => r.slots.map(Boolean)), [[true, false, false]]);
	assert.equal(partBox(one, { x: 10, y: 5 }, 'cp'), null, 'off the screenshot');
	assert.equal(sortedByNumber(blank(W, 50)), null, 'the button off the screenshot');
	assert.equal(sortedByNumber(blank(W, 2 * W, [80, 80, 80])), null, 'no icon on the button');
});

test('the search field: empty, a long search one letter off, a dimmed one too short', async () => {
	const e = fakeEngine();
	assert.equal(await readSearchField(drawShot({ field: '' }), e), '');
	assert.equal(await readSearchField(blank(W, W), e), null);
	assert.equal(fieldIs('XXL&CP512,CP148', 'xxl&cp512,cp1480'), true);
	assert.equal(fieldIs('XXL&CP512,CP14', 'xxl&cp512,cp1480'), false);
	assert.equal(fieldIs('XXS', 'xxl'), false);
	assert.equal(fieldIs('!Ixxs', '!xxs'), true);
	assert.equal(fieldIs('', 'xxl'), null);
	assert.equal(fieldIs(null, 'xxl'), null);
});

test('text: tile CP, the header\'s count, a plain name read twice', () => {
	assert.equal(parseTileCp('CP 1234'), 1234);
	assert.equal(parseTileCp('cp1O5'), 105);
	assert.equal(parseTileCp(''), null);
	assert.equal(parseTileCp(null), null);
	assert.equal(parseCount(null), null);
	assert.equal(fieldIs('XXL', ''), null);
	assert.equal(parseCount('Pokémon ( 50 )'), 50);
	assert.equal(parseCount('50'), null);
	assert.ok(sameName('Pidove', 'Pidove 7'));
	assert.ok(sameName('Pidove', 'Pidave'));
	assert.ok(!sameName('Pidove', ''));
	assert.ok(!sameName('Abra', 'Kadabra'));
	const p = (atk, ivPct, level, maxCp = null) => ({ style: 'new', atk, ivPct, level, maxCp });
	assert.ok(sameValues(p(15, 80, 29), p(15, 80, 30)));
	assert.ok(!sameValues(p(15, 80, 29), p(14, 81, 29)));
	assert.ok(sameByName({ p: p(15, 80, 29, 2650) }, { p: p(15, 80, 29) }));
	assert.ok(!sameByName({ p: p(15, 80, 29, 2650) }, { p: p(15, 80, 29, 2651) }));
	assert.ok(!sameByName('covered', { p: p(15, 80, 29) }));
});

// ---------- stitching ----------

const name = (atk, ivPct, level, maxCp) => ({ style: 'new', atk, ivPct, level, maxCp: maxCp ?? null, raw: `^${ivPct}(${atk})[${level}]${maxCp ?? ''}`, prefix: '' });
const tile = (cp, p = null, more = {}) => ({ col: 0, name: p ? p.raw : null, p, cp, cut: false, ...more });
/** A list of n tiles, three a row, made-up values; shots of `size` rows from `at`. */
function list(n) {
	return Array.from({ length: n }, (_, i) => tile(100 + 37 * i, name(i % 16, Math.round((100 * (i % 46)) / 45), 1 + (i % 50))));
}
function shotOf(tiles, from, size, { end = false } = {}) {
	const rows = [];
	for (let r = from; r < from + size; r++) {
		const slots = [0, 1, 2].map(c => tiles[3 * r + c] ? { ...tiles[3 * r + c], col: c } : 'empty');
		rows.push({ y: r, slots });
		if (slots.includes('empty')) break;
	}
	if (end && !rows.some(r => r.slots.includes('empty'))) rows.push({ y: from + size, slots: ['empty', 'empty', 'empty'] });
	return { rows };
}
const cps = s => s.tiles.map(t => t.cp);

test('stitch: overlapping screenshots in any order give the list once, in order', () => {
	const all = list(20);
	const shots = [shotOf(all, 0, 4), shotOf(all, 2, 4), shotOf(all, 4, 4, { end: true })];
	const want = all.map(t => t.cp);
	for (const order of [[0, 1, 2], [2, 0, 1], [1, 2, 0]]) {
		const s = stitch(order.map(i => shots[i]));
		assert.deepEqual(cps(s), want);
		assert.equal(s.gaps, 0);
	}
});

test('stitch: a misread CP among tiles seen alike, a covered place, a cut tile joined by its name', () => {
	const all = list(15);
	const a = shotOf(all, 0, 3), b = shotOf(all, 1, 4, { end: true });
	// b misreads one CP ("4182" for 418); a's place under a button is covered
	b.rows[1].slots[1] = { ...b.rows[1].slots[1], cp: 9999 };
	a.rows[2].slots[2] = 'covered';
	// b's first row cut by the header: no CP, the names say who they are
	b.rows[0].slots = b.rows[0].slots.map(t => ({ ...t, cp: null, cut: true }));
	const s = stitch([b, a]);
	const want = all.map(t => t.cp);
	assert.ok([359, 9999].includes(s.tiles[7].cp), 'two readings of one place: a tie, either');
	s.tiles[7].cp = 359;
	assert.deepEqual(cps(s), want, 'the covered place read from the other screenshot');
	assert.equal(s.covered, 0);
});

test('stitch: screenshots that don\'t overlap stay apart, ordered by the Pokédex numbers', () => {
	const all = list(30);
	const a = shotOf(all, 0, 3), b = shotOf(all, 6, 4, { end: true });
	const at = t => 1 + Math.floor((t.cp - 100) / 37);
	const s = stitch([b, a], { at });
	assert.equal(s.gaps, 1);
	assert.deepEqual(s.proven, [true]);
	assert.deepEqual(s.groups.map(g => [g.lo, g.end]), [[1, false], [19, true]]);
	assert.ok(s.tiles.find(t => t.cp === all[18].cp).brk === undefined, 'a proven edge');
	// without numbers, neither holding the end: apart, the edge not proven
	const c = shotOf(all, 5, 2);
	const s2 = stitch([c, a]);
	assert.equal(s2.gaps, 1);
	assert.deepEqual(s2.proven, [false]);
	assert.equal(s2.tiles.filter(t => t.brk).length, 1, 'the first tile after the edge');
});

test('stitch: a rename between two screenshots: the later reading\'s name wins; a max CP misread loses', () => {
	const all = list(6);
	const a = shotOf(all, 0, 2, { end: true }), b = shotOf(all, 0, 2, { end: true });
	const t = b.rows[0].slots[0];
	b.rows[0].slots[0] = { ...t, p: { ...t.p, level: t.p.level + 1 }, name: 'renamed' };
	const junk = { ...a.rows[0].slots[1].p, maxCp: null, raw: '^0(1)[2]284¢' };
	a.rows[0].slots[1] = { ...a.rows[0].slots[1], p: junk, name: junk.raw };
	b.rows[0].slots[1] = { ...b.rows[0].slots[1], p: { ...junk, maxCp: 2846, raw: '^0(1)[2]2846' }, name: '^0(1)[2]2846' };
	const s = stitch([a, b]);
	assert.equal(s.tiles[1].p.maxCp, 2846);
	assert.equal(s.tiles.length, 6);
	assert.ok([t.p.level, t.p.level + 1].includes(s.tiles[0].p.level));
});

test('stitch: one place read cut and whole, its Max CP misread on either side, a name under a button', () => {
	const all = list(6);
	const at = (s, r, c, f) => { s.rows[r].slots[c] = f(s.rows[r].slots[c]); };
	for (const flip of [false, true]) {
		const a = shotOf(all, 0, 2, { end: true }), b = shotOf(all, 0, 2, { end: true });
		const [x, y] = flip ? [b, a] : [a, b];
		at(x, 0, 0, t => ({ ...t, cp: null, cut: true }));
		const junk = t => ({ ...t, p: { ...t.p, raw: `${t.p.raw}284¢` }, name: `${t.p.raw}284¢` });
		at(x, 0, 1, junk);
		at(y, 0, 1, t => ({ ...t, p: { ...t.p, maxCp: 2846 } }));
		at(x, 0, 2, t => ({ ...t, name: null, p: null, under: true }));
		at(y, 0, 2, t => ({ ...t, name: null, p: null }));
		const s = stitch([a, b]);
		assert.equal(s.tiles.length, 6);
		assert.equal(s.tiles[0].cp, all[0].cp, 'the whole reading\'s CP');
		assert.equal(s.tiles[0].cut, false);
		assert.equal(s.tiles[1].p.maxCp, 2846);
		assert.equal(s.tiles[2].under, true);
	}
});

test('stitch: a plain reading and a sure one; a name read for sure taken over a partial one', () => {
	const all = list(6);
	const a = shotOf(all, 0, 2, { end: true }), b = shotOf(all, 0, 2, { end: true }), c = shotOf(all, 0, 2, { end: true });
	a.rows[0].slots[0] = { ...a.rows[0].slots[0], p: null, name: 'Pidove' };
	c.rows[0].slots[0] = { ...c.rows[0].slots[0], p: { style: 'none', raw: 'Pidove' }, name: 'Pidove' };
	const s = stitch([a, b, c]);
	assert.equal(s.tiles[0].p.atk, all[0].p.atk, 'the one read for sure wins the vote');
});

test('stitch: places only a covered or blank tile proves, CPs that differ where names can\'t tell', () => {
	const all = list(9);
	const cov = { y: 9, slots: ['covered', 'covered', 'covered'] };
	const a = shotOf(all, 0, 2), b = shotOf(all, 2, 2, { end: true });
	a.rows.push(cov);
	b.rows.unshift({ ...cov });
	const s = stitch([a, b]);
	assert.equal(s.gaps, 0, 'joined end to end, without proof');
	assert.deepEqual(cps(s), all.map(t => t.cp));
	// a blank tile against the list's end; two soft CPs: too many to pass as misreads
	const e = shotOf(all, 0, 3, { end: true }), f = shotOf(all, 0, 3, { end: true });
	e.rows[3] = { y: 3, slots: [{ col: 0, cp: null, name: null, p: null, cut: false }, 'empty', 'empty'] };
	f.rows[0].slots = f.rows[0].slots.map(t => ({ ...t, p: null, name: null, cp: t.cp + 1 }));
	const s2 = stitch([e, f]);
	assert.equal(s2.gaps, 1, 'not joined');
	assert.equal(s2.tiles.length, 19);
	// a cut tile whose name clashes with the place's: refused without proof
	const g = shotOf(all, 0, 2), h = shotOf(all, 1, 2, { end: true });
	h.rows[0].slots = h.rows[0].slots.map(t => ({ ...t, cp: null, cut: true, p: { ...t.p, atk: (t.p.atk + 1) % 16, level: t.p.level + 2 } }));
	const s3 = stitch([g, h]);
	assert.equal(s3.gaps, 1, 'not joined');
});

test('stitch: a list that repeats itself: joined where the end allows one offset; two alike, no join', () => {
	const t = (cp, i) => tile(cp, name(i, 80, 20));
	const row = i => [0, 1, 2].map(c => ({ ...t(500 + c, i), col: c }));
	const a = { rows: [{ slots: row(1) }, { slots: row(1) }, { slots: row(1) }] };
	const b = { rows: [{ slots: row(1) }, { slots: row(1) }, { slots: ['empty', 'empty', 'empty'] }] };
	const s = stitch([a, b]);
	assert.deepEqual([s.tiles.length, s.gaps], [9, 0]);
	const c = { rows: [{ slots: row(1) }, { slots: row(1) }] };
	assert.equal(stitch([a, c]).gaps, 1, 'one row down or two: can\'t tell');
});

test('stitch: a name without its IV % taken over a plain reading; a cut tile with no name read', () => {
	const all = list(6);
	const a = shotOf(all, 0, 2, { end: true }), b = shotOf(all, 0, 2, { end: true }), c = shotOf(all, 0, 2, { end: true });
	const t = a.rows[0].slots[0];
	a.rows[0].slots[0] = { ...t, p: { style: 'old', ivPct: 80, level: 20 }, name: 'old' };
	b.rows[0].slots[0] = { ...t, p: { style: 'new', noPct: true, atk: 7, level: 20, raw: '(7)[20]' }, name: '(7)[20]' };
	c.rows[0].slots[0] = { ...t, p: { style: 'new', atk: 7, level: 20, raw: '(7)[20]x' }, name: '(7)[20]x' };
	// row 1 cut by the header in c, nothing of its names read
	c.rows[1].slots = c.rows[1].slots.map(x => (typeof x === 'object' ? { ...x, cp: null, cut: true, p: null, name: 'XX' } : x));
	const s = stitch([a, b, c]);
	assert.equal(s.tiles.length, 6);
	assert.equal(s.tiles[0].p.noPct, true, 'the one without IV % is usable, the others not');
	assert.equal(s.tiles[3].cp, all[3].cp);
});

test('cropBesidePill: the pill\'s rounded end, a name box only partly beside it, no ink; the screen\'s bottom', () => {
	const img = blank(W, W);
	// the pill, its top rows narrower (a rounded end): its edge found rightwards there
	rect(img, Math.round(0.9 * W), 600, 70, 150, WHITE);
	rect(img, Math.round(0.93 * W), 590, 40, 10, WHITE);
	const pill = scrollPill(img, 0);
	assert.ok(pill);
	const box = { x: 900, y: 570, w: 200, h: 60 };
	const c = cropBesidePill(img, box, pill, 'name');
	assert.ok(c, 'no ink: nothing hidden');
	const px = (x, y) => Array.from(c.data.subarray(((y - box.y) * box.w + x - box.x) * 4, ((y - box.y) * box.w + x - box.x) * 4 + 3));
	assert.deepEqual(px(1099, 620), [255, 255, 255], 'the pill painted white');
	assert.deepEqual(px(1099, 575), [244, 255, 240], 'above the pill: as it was');
	// a short name, centred, well clear of the pill: read; one whose mirrored end lies under it: hidden
	rect(img, 960, 610, 80, 10, [0, 0, 0]);
	assert.ok(cropBesidePill(img, box, pill, 'name'));
	rect(img, 905, 600, 40, 10, [0, 0, 0]);
	assert.equal(cropBesidePill(img, box, pill, 'name'), null);
	assert.equal(slotState(blank(W, 2 * W), 2 * W - 10, 0), 'covered', 'at the screen\'s bottom edge');
});
