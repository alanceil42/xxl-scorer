// Screen shapes and the card's other readings: regions in units of the width,
// the year pill, the name line, lucky, covered stats rows, CP digits, merging 16:9 pairs.
// No game art: the images are drawn here, the game data is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGIONS, boxOf, findHpBar, isLucky, cardOffset, statsShift, findCpBox, cardColumn, columnOf, yearPillText, cpDigits, dropEdgeBlobs, HP_BAR_X0 } from '../src/core/image.js';
import { parseName, parseYearPill, dateParts, dateRelation, pillAsCaught, parseCrops, makeRules } from '../src/core/read.js';
import { compactGameMaster } from '../src/core/gm.js';
import { compactText, nameIndex, findDexByName } from '../src/core/text.js';
import { makeContext, evaluate, canMerge, mergeReadings, nameRelation } from '../src/core/evaluate.js';
import { isXXSByHeight, MODES } from '../src/core/score.js';
import { syntheticGameMaster, syntheticText } from './synthetic.js';

const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
const en = compactText(syntheticText('en'));
const ctx = makeContext(gm, en);

function canvas(W, H, rgb = [250, 250, 250]) {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let i = 0; i < data.length; i += 4) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
	const rect = (x0, y0, w, h, c) => {
		for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; }
	};
	return { img: { width: W, height: H, data }, rect };
}

test('regions are in units of the width: the same place on a 16:9 and a 19.5:9 screen', () => {
	for (const [W, H] of [[750, 1334], [1206, 2622]]) {
		const b = boxOf({ width: W, height: H }, REGIONS.cp);
		assert.equal(b.y, Math.round(W * 0.10));
		// the HP bar at 0.98 W is found on both
		const { img, rect } = canvas(W, H);
		rect(Math.round(W * HP_BAR_X0), Math.round(W * 0.98), Math.round(W * 0.49), Math.round(W * 0.012), [140, 225, 178]);
		const bar = findHpBar(img);
		assert.ok(bar && Math.abs(bar.y / W - 0.986) < 0.01, `${W}: ${JSON.stringify(bar)}`);
		assert.equal(isLucky(img, bar), false);
	}
});

test('HP bar: teal under the Mystic appraisal tint; lucky', () => {
	const W = 750, H = 1334;
	const { img, rect } = canvas(W, H, [136, 178, 196]);	// blue-tinted card
	rect(Math.round(W * HP_BAR_X0), Math.round(W * 1.03), Math.round(W * 0.49), 8, [90, 179, 172]);
	const bar = findHpBar(img);
	assert.ok(bar, 'teal bar on a blue card');
	assert.equal(isLucky(img, bar), false, 'the tint is bluer than green, and the bar\'s place says nothing');
	// "LUCKY POKÉMON": green letters above the bar
	for (let x = 0.36 * W; x < 0.64 * W; x += 0.03 * W) rect(Math.round(x), Math.round(W * 1.03) - 26, 9, 12, [110, 200, 150]);
	assert.equal(isLucky(img, findHpBar(img)), true);
});

test('card offset: the card moved up (scrolled, top cut off) or down (other phones), not a pixel or two', () => {
	const img = { width: 1000 };
	assert.equal(cardOffset(img, { y: 986 }, false), 0);
	assert.equal(cardOffset(img, { y: 990 }, false), 0, 'within 0.01 W');
	assert.equal(cardOffset(img, { y: 1036 }, true), 0);
	assert.equal(cardOffset(img, { y: 875 }, false), -111, 'cut off at the top');
	assert.equal(cardOffset(img, { y: 1017 }, false), 31, 'lower on some Android phones');
	assert.deepEqual(boxOf({ width: 1000, height: 2000 }, REGIONS.cp, -111), { x: 300, y: 0, w: 400, h: 99 }, 'clipped at the top');
	assert.deepEqual(boxOf({ width: 1000, height: 2000 }, REGIONS.name, 31), { x: 120, y: 909, w: 660, h: 74 });
});

test('the HP bar in a screenshot cut off at the top: higher up only where a bar starts', () => {
	const W = 600, H = 1100;
	const { img, rect } = canvas(W, H);
	rect(Math.round(W * HP_BAR_X0), 420, Math.round(W * 0.49), 8, [140, 225, 178]);	// 0.70 W
	assert.equal(findHpBar(img).y, 424);
	const other = canvas(W, H);
	other.rect(40, 420, 200, 8, [140, 225, 178]);	// green, thin, but not where a bar starts
	assert.equal(findHpBar(other.img), null);
});

test('stats row: one row lower per row of tags, from the weight\'s text or the pills', () => {
	const W = 600, H = 1300, by = 588;	// bar at 0.98 W
	const make = (textAt, pills = 0) => {
		const { img, rect } = canvas(W, H);
		rect(Math.round(W * HP_BAR_X0), by - 4, Math.round(W * 0.49), 8, [140, 225, 178]);
		for (let k = 0; k < pills; k++) rect(200, Math.round(by + (0.09 + k * 0.089) * W) + 2, 200, 32, [170, 90, 200]);
		if (textAt != null) for (let x = 60; x < 160; x += 20) rect(x, Math.round(by + textAt * W), 12, 22, [70, 80, 85]);
		return { img, bar: findHpBar(img) };
	};
	for (const [at, rows] of [[0.178, 0], [0.267, 1], [0.356, 2]]) {
		const { img, bar } = make(at, rows);
		assert.equal(statsShift(img, bar), Math.round(rows * 0.089 * W), `text at ${at}`);
	}
	const hidden = make(null, 2);
	assert.equal(statsShift(hidden.img, hidden.bar), Math.round(2 * 0.089 * W), 'weight covered: the pill rows counted');
	const bare = make(null, 0);
	assert.equal(statsShift(bare.img, bare.bar), 0);
	const ribbon = make(0.178, 0);
	// a "NEW RECORD" ribbon above the weight: saturated, not text
	for (let y = 0; y < 20; y++) for (let x = 60; x < 180; x++) { const i = ((by + 66 + y) * W + x) * 4; ribbon.img.data.set([200, 120, 220], i); }
	assert.equal(statsShift(ribbon.img, ribbon.bar), 0);
});

test('CP digits found where they are: a row of tall white glyphs near the top', () => {
	const W = 600, H = 1200;
	const { img, rect } = canvas(W, H, [40, 60, 90]);
	for (const x of [250, 280, 310]) rect(x, 12, 20, 36, [255, 255, 255]);
	rect(20, 5, 10, 14, [255, 255, 255]);	// the status bar's clock: small, at the side
	const b = findCpBox(img);
	assert.ok(b, 'found');
	assert.equal(b.x, Math.round(W * REGIONS.cp.x));
	assert.ok(b.y <= 12 && b.y + b.h >= 48, JSON.stringify(b));
	const one = canvas(W, H, [40, 60, 90]);
	one.rect(280, 100, 20, 36, [255, 255, 255]);
	assert.equal(findCpBox(one.img), null, 'a single glyph is no CP');
});

test('card column: the whole width on a phone, a centred 9:16 column on a wider screen', () => {
	for (const [W, H] of [[750, 1334], [1206, 2622], [1080, 2400], [640, 1136]]) {
		assert.deepEqual(cardColumn(W, H), { x: 0, w: W }, `${W} × ${H}`);
		const img = { width: W, height: H, data: new Uint8ClampedArray(0) };
		assert.equal(columnOf(img), img, 'a phone screenshot is used as it is');
	}
	// a 1640 × 2360 iPad: the HP bar measured at 0.300-0.699 of the width, row 1299
	assert.deepEqual(cardColumn(1640, 2360), { x: 156, w: 1328 });
	const W = 1640, H = 2360, c = cardColumn(W, H);
	const { img, rect } = canvas(W, H);
	rect(492, 1294, 654, 10, [140, 225, 178]);
	const col = columnOf(img);
	assert.equal(col.width, 1328);
	assert.equal(col.height, H);
	const bar = findHpBar(col);
	assert.ok(bar, 'found in the column');
	assert.ok(Math.abs(bar.y / c.w - 0.978) < 0.005, `bar at ${bar.y / c.w} column widths`);
	assert.ok(Math.abs(bar.x0 / c.w - HP_BAR_X0) < 0.01 && Math.abs((bar.x1 + 1) / c.w - 0.742) < 0.01, JSON.stringify(bar));
});

test('year pill: found by colour, white text kept; none on a plain card', () => {
	const { img, rect } = canvas(200, 140);
	rect(20, 20, 175, 90, [255, 188, 90]);	// the pill
	rect(120, 40, 30, 8, [255, 255, 255]);	// a stroke of "2024"
	rect(150, 115, 30, 8, [255, 255, 255]);	// white card below: not text
	const t = yearPillText(img);
	assert.ok(t);
	const black = [];
	for (let i = 0; i < t.data.length; i += 4) if (t.data[i] === 0) black.push(i / 4);
	assert.equal(black.length, 30 * 8, 'only the stroke inside the pill');
	assert.equal(yearPillText(canvas(200, 140).img), null);
});

test('year pill and catch dates', () => {
	assert.equal(parseYearPill('2024\n04/19'), '2024 04/19');
	assert.equal(parseYearPill('2021 10/22\n'), '2021 10/22');
	assert.equal(parseYearPill('20 4/19'), null);
	assert.equal(parseYearPill('2024 13/14'), null);
	assert.deepEqual(dateParts('4/19/2024'), { y: 2024, md: '4/19' });
	assert.equal(dateRelation('4/19/2024', '2024 04/19'), 'eq');
	assert.equal(dateRelation('19.4.2024', '2024 04/19'), 'eq', 'any date order');
	assert.equal(dateRelation('2/4/2019', '2024 02/04'), 'diff');
	assert.equal(dateRelation('2/4/2024', null), null);
	assert.equal(pillAsCaught('2024 04/04'), '4/4/2024');
});

test('name line: pencil cut off; a species name only when it is one', () => {
	assert.equal(parseName('Testmon #'), 'Testmon');
	assert.equal(parseName('  ? 7'), '?');
	assert.equal(parseName('Mr. Fake /'), 'Mr. Fake');
	const idx = nameIndex(en);
	assert.equal(findDexByName('Testmon', idx), 9001);
	assert.equal(findDexByName('Testmom', idx), 9001, 'one character off, long name');
	assert.equal(findDexByName('Xxl', idx), null);
	assert.equal(findDexByName('Fakeom', idx), 9002);
	assert.equal(nameRelation('XX11171+t', 'XX11171t'), 'eq', 'punctuation ignored');
	assert.equal(nameRelation('h XX11171t Nv.', 'XX11171t'), 'like', 'the trainer adds a fringe');
	assert.equal(nameRelation('Xxl', 'Xxl.'), 'eq');
	assert.equal(nameRelation('Xx', 'Xx'), null, 'too short to say anything');
});

test('HP crop: the label may be cut off by the trainer', () => {
	const rules = makeRules(en);
	assert.equal(parseCrops({ hp: '131 / 131 H' }, rules).hp, 131);
	assert.equal(parseCrops({ hp: '131 / 131' }, rules).hp, 131);
	assert.equal(parseCrops({ hp: '131 / 1314' }, rules).hp, null, 'a digit is not a cut-off label');
});

test('CP digits: the smaller "CP" and specks dropped; blobs at the edge removed', () => {
	const { img, rect } = canvas(300, 80, [255, 255, 255]);
	const black = [0, 0, 0];
	rect(20, 40, 14, 22, black);	// "C", smaller
	rect(40, 40, 14, 22, black);	// "P"
	for (const x of [70, 110, 150]) rect(x, 20, 26, 42, black);	// three digits
	rect(200, 10, 4, 4, black);	// a speck
	rect(260, 0, 30, 80, black);	// something touching top and bottom
	const d = cpDigits(img);
	assert.ok(d);
	let n = 0;
	for (let i = 0; i < d.data.length; i += 4) if (d.data[i] === 0) n++;
	assert.equal(n, 3 * 26 * 42);
	const e = dropEdgeBlobs(img);
	assert.equal(e.data[(40 * 300 + 270) * 4], 255, 'edge blob gone');
	assert.equal(e.data[(30 * 300 + 80) * 4], 0, 'digit kept');
});

test('16:9 pair: appraisal (no sizes) + plain (no "was caught" line) merge by date, HP, CP', () => {
	const row = gm.species.TESTMON.f[''];
	const appraisal = { species: 'Testmon', caught: '4/19/2024', caughtPill: '2024 04/19', hp: 80, cp: 500, bars: null, weight_kg: null, height_m: null, types: [], covered: true, lucky: false, name: 'XX¹Q' };
	const plain = { species: null, caught: null, caughtPill: '2024 04/19', hp: 80, cp: 500, bars: null, weight_kg: 21.5, height_m: 1.6, types: ['NORMAL'], badge: 'XXL', lucky: false, name: 'XX¹Q' };
	assert.ok(canMerge(appraisal, plain, ctx));
	const m = mergeReadings(appraisal, plain, ctx);
	assert.equal(m.weight_kg, 21.5);
	assert.equal(m.covered, undefined);
	// another Pokémon: same HP and CP, other catch day → no
	assert.ok(!canMerge(appraisal, { ...plain, caughtPill: '2024 04/20' }, ctx));
	// lucky and not lucky → no
	assert.ok(!canMerge(appraisal, { ...plain, lucky: true }, ctx));
	// without a year pill (caught this year), the name line as a species name carries it
	const a2 = { ...appraisal, caughtPill: null, caught: '8/13/2026', name: 'Testmon' };
	const p2 = { ...plain, caughtPill: null, name: 'Testmon' };
	assert.ok(canMerge(a2, p2, ctx));
	assert.ok(!canMerge(a2, { ...p2, name: 'Fakeon' }, ctx), 'two different species names');
	// a plain screenshot alone gets its species from the name line and its date from the pill
	const e = evaluate({ ...plain, name: 'Testmon' }, ctx);
	assert.equal(e.name, 'Testmon');
	assert.equal(e.caught, '4/19/2024');
	assert.equal(row[9], 0.5);
});

test('XXS from the height', () => {
	const row = gm.species.TESTMON.f[''];	// h̄ 1.0, XS min 0.5
	assert.equal(isXXSByHeight(row, 0.49), true);
	assert.equal(isXXSByHeight(row, 0.5), null, 'at the boundary: the badge decides');
	assert.equal(isXXSByHeight(row, 0.52), false);
	assert.equal(isXXSByHeight(row.slice(0, 9), 0.49), true, 'a stored copy without XS min');
	assert.equal(MODES.xxs.best, 1);
	assert.equal(MODES.xxl.best, -1);
	const e = evaluate({ species: 'Testmon', hp: null, cp: null, height_m: 0.49, weight_kg: 5, bars: { a: 1, d: 2, s: 3 }, types: [] }, ctx);
	assert.equal(e.xxs, true);
	assert.equal(e.xxl, false);
});
