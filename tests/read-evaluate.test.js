import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactGameMaster, ROW } from '../src/core/gm.js';
import { compactText } from '../src/core/text.js';
import { makeRules, parseWords, parseCp, parseCrops, parseTypes, parseName, parseYearPill, dateParts, pillAsCaught } from '../src/core/read.js';
import { makeContext, evaluate, duplicateKey, formLabel } from '../src/core/evaluate.js';
import { levelTable, cpOf, hpOf } from '../src/core/ivs.js';
import { syntheticGameMaster, syntheticText, CPM } from './synthetic.js';

const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
const en = compactText(syntheticText('en'));
const ctx = makeContext(gm, en);
const W = 1184;
const word = (text, x) => ({ text, bbox: { x0: x - 20, y0: 0, x1: x + 20, y1: 10 } });

test('OCR words → readings', () => {
	const words = [
		word('CP', 600), word('XX1143', 600),
		word('121', 600), word('/', 600), word('121', 600), word('HP', 600),
		word('109.32', 200), word('2.3m', 1000), word('WEIGHT', 200), word('HEIGHT', 1000),
		...'This Testmon was caught on 7/28/2024 around Somewhere.'.split(' ').map(t => word(t, 500)),
	];
	assert.deepEqual(parseWords(words, W, makeRules(en)), {
		species: 'Testmon', caught: '7/28/2024', hp: 121, weight_kg: 109.32, height_m: 2.3, types: [],
	});
	// decimal comma and German HP label
	const de = compactText(syntheticText('de'));
	const r = parseWords([word('59,26kg', 200), word('1,84m', 1000), word('299/299', 600), word('KP', 600)], W, makeRules(de));
	assert.equal(r.weight_kg, 59.26);
	assert.equal(r.height_m, 1.84);
	assert.equal(r.hp, 299);
});

test('OCR words: more than two type names is not the stats row; no "was caught" line', () => {
	const r = parseWords([word('FIRE', 400), word('WATER', 500), word('GRASS', 600), word('0,980', 200), word('22.38kg', 300)], W, makeRules(en));
	assert.deepEqual(r.types, [], 'a type chart or a move list, not the labels');
	assert.equal(r.weight_kg, 22.38, 'a number with its unit before a bare one (a stardust count)');
	assert.equal(r.species, null);
	assert.equal(r.caught, null);
});

test('crop texts: nothing read, an HP of 0 or 1000+, three type names, an empty name line', () => {
	const rules = makeRules(en);
	assert.deepEqual(parseCrops({}, rules), { hp: null, weight_kg: null, height_m: null, badge: null });
	assert.equal(parseCrops({ hp: '0 / 0 HP' }, rules).hp, null);
	assert.equal(parseCrops({ hp: '1314 / 1314 HP' }, rules).hp, null, '"131 / 131 H" with the H read as a digit');
	assert.equal(parseCrops({ height: '1.6 2m' }, rules).height_m, 1.62, 'a space inside a size');
	assert.deepEqual(parseTypes('FIRE WATER GRASS'), []);
	assert.deepEqual(parseTypes(null), []);
	assert.equal(parseName(null), null);
	assert.equal(parseName(' — '), null, 'only punctuation');
});

test('year pill and catch dates: what is not a date', () => {
	assert.equal(parseYearPill(null), null);
	assert.equal(parseYearPill('2015 04/19'), null, 'before the game');
	assert.equal(parseYearPill('2100 04/19'), null);
	assert.equal(parseYearPill('2024 00/19'), null);
	assert.equal(parseYearPill('2024 32/01'), null);
	assert.equal(parseYearPill('2024 4/9'), '2024 04/09', 'single digits padded');
	assert.equal(dateParts('4/19'), null, 'two numbers');
	assert.equal(dateParts('04/19/24'), null, 'no four-digit year');
	assert.equal(dateParts(undefined), null);
	assert.equal(pillAsCaught('2024 4/19'), null, 'not a pill as parseYearPill gives it');
	assert.equal(pillAsCaught(null), null);
});

test('CP text', () => {
	assert.equal(parseCp('CP1900'), 1900);
	assert.equal(parseCp('CP 217\n'), 217);
	assert.equal(parseCp(''), null);
	assert.equal(parseCp('7'), null);
});

/** CP/HP the game would show for these IVs at this level. */
function shown(row, ivs, level) {
	const m = levelTable(CPM).find(x => x.level === level).m;
	return { cp: cpOf(row, ivs.a, ivs.d, ivs.s, m), hp: hpOf(row, ivs.s, m) };
}

test('evaluate: species, IVs from bars + CP/HP, XXL, score, key', () => {
	const row = gm.species.TESTMON.f[''];
	const ivs = { a: 15, d: 13, s: 15 };
	const { cp, hp } = shown(row, ivs, 20);
	const r = evaluate({ species: 'Testmon', caught: '7/28/2024', hp, cp, height_m: 1.7, weight_kg: 30, bars: { a: 14.85, d: 12.99, s: 14.85 } }, ctx);
	assert.equal(r.id, 'TESTMON');
	assert.equal(r.form, '');
	assert.deepEqual(r.ivs, ivs);
	assert.equal(r.level, 20);
	assert.equal(r.xxl, true);
	assert.ok(Math.abs(r.score.total - (800 * 1.7 / 1.75 + 100 + 50 * 43 / 45 + 178)) < 1e-9);
	// "30kg" under the appraisal: the trainer may hide the rest of it
	assert.deepEqual(r.issues.map(i => i.code), ['size-whole']);
	assert.equal(r.key, 'TESTMON||d:7/28/2024|1.70|30.00|iv:15/13/15');
	assert.equal(duplicateKey({ ...r, caught: null }), `TESTMON||cp:${cp}|1.70|30.00|iv:15/13/15`);
	assert.equal(duplicateKey({ ...r, ivSource: 'cp' }), 'TESTMON||d:7/28/2024|1.70|30.00', 'IVs guessed from CP/HP: left out');
});

test('evaluate: the form is picked by which one solves CP/HP', () => {
	const giant = gm.species.TESTMON.f.GIANT;
	const ivs = { a: 10, d: 10, s: 10 };
	const { cp, hp } = shown(giant, ivs, 25);
	const r = evaluate({ species: 'Testmon', hp, cp, height_m: 2.5, weight_kg: 60, bars: { a: 10, d: 10, s: 10 } }, ctx);
	assert.equal(r.form, 'GIANT');
	assert.equal(formLabel(r.form), 'Giant');
	assert.equal(r.types, 'NORMAL/FLYING');
});

test('evaluate: misread CP is flagged, IVs from bars still score', () => {
	const row = gm.species.FAKEON.f[''];
	const { hp } = shown(row, { a: 1, d: 14, s: 11 }, 7);
	const r = evaluate({ species: 'Fakeon', hp, cp: 99999, height_m: 0.8, weight_kg: 9, bars: { a: 1, d: 14.03, s: 10.93 } }, ctx);
	assert.deepEqual(r.ivs, { a: 1, d: 14, s: 11 });
	assert.ok(r.issues.some(i => i.code === 'cp'));
	assert.ok(r.score.total > 0);
});

test('evaluate: unknown species, XXL boundary, user edits, in-game check', () => {
	assert.equal(evaluate({ species: 'Nonexistmon' }, ctx).issues[0].code, 'species');
	const b = evaluate({ species: 'Testmon', height_m: 1.5, weight_kg: 20, bars: null }, ctx, { ivs: { a: 0, d: 0, s: 0 } });
	assert.equal(b.xxl, null);
	assert.ok(b.issues.some(i => i.code === 'xxl'));
	assert.equal(b.score, null);
	const e = evaluate({ species: 'Testmon', height_m: 1.5, weight_kg: 20 }, ctx, { ivs: { a: 0, d: 0, s: 0 }, xxl: true, inGame: 1500 });
	assert.ok(e.score.total > 0);
	assert.ok(e.issues.some(i => i.code === 'ingame'));
});

test('evaluate: a CP that lost a digit is replaced by the one the bars and HP allow', () => {
	const row = gm.species.FAKEON.f[''];
	const ivs = { a: 1, d: 14, s: 11 };
	const { cp, hp } = shown(row, ivs, 30);
	assert.ok(cp >= 100, `want a 3+ digit CP, got ${cp}`);
	const misread = Number(String(cp).slice(1));	// "521" → 21
	const r = evaluate({ species: 'Fakeon', hp, cp: misread, height_m: 0.6, weight_kg: 9.12, bars: { a: 1.02, d: 13.97, s: 10.95 } }, ctx);
	assert.equal(r.cp, cp);
	assert.deepEqual(r.ivs, ivs);
	assert.equal(r.level, 30);
	assert.ok(r.issues.some(i => i.code === 'cp-fixed' && i.info));
	assert.ok(!r.issues.some(i => !i.info), JSON.stringify(r.issues));
});

test('fixSizes: a hidden leading digit is restored, guided by the other value', async () => {
	const { fixSizes } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];	// 1.0 m, 20 kg, XXL max 1.75 m
	// "62" can't be a height: 0.62 or 1.62? The weight (32 kg, ratio 1.6) says 1.62.
	assert.equal(fixSizes(62, 32, row).h.value, 1.62);
	assert.equal(fixSizes(62, 12, row).h.value, 0.62);
	assert.equal(fixSizes(62, 32, row).h.fixed, true);
	assert.equal(fixSizes(1.62, 32, row).h.fixed, false);
	// weight "9.32" for a 1.6 m Testmon: 29.32 kg fits (ratio 1.47)
	assert.equal(fixSizes(1.6, 9.32, row).w.value, 9.32, 'already possible: left alone');
	assert.equal(fixSizes(1.6, 0.32, row).w.value, 30.32);
	// nothing fits: no value, so the page asks
	assert.equal(fixSizes(999.5, 20, row).h.value, null);
});

test('fixSizes: several hidden characters ("6" from 1.06 m)', async () => {
	const { fixSizes } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];
	// weight ratio 1.095: of 0.6, 0.96, 1.06, 1.16, 1.6, … the closest height ratio is 1.06
	assert.equal(fixSizes(6, 21.9, row).h.value, 1.06);
});

test('screenshots of one Pokémon merge: bars from one, intact height from the other', async () => {
	const { canMerge, mergeReadings } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];
	const ivs = { a: 14, d: 14, s: 14 };
	const { cp, hp } = shown(row, ivs, 20);
	// with the appraisal: the trainer hides "1." of the height
	const a = { species: 'Testmon', caught: '10/10/2026', hp, cp, height_m: 7, weight_kg: 30, bars: { a: 14, d: 14, s: 14 } };
	// without: no bars, no "was caught" line (moves are shown there), but the height is visible
	const b = { species: null, caught: null, hp, cp, height_m: 1.7, weight_kg: 30, bars: null };
	assert.ok(canMerge(a, b, ctx) && canMerge(b, a, ctx));
	for (const m of [mergeReadings(a, b, ctx), mergeReadings(b, a, ctx)]) {
		assert.equal(m.species, 'Testmon');
		assert.equal(m.caught, '10/10/2026');
		assert.equal(m.height_m, 1.7);
		assert.deepEqual(m.bars, { a: 14, d: 14, s: 14 });
		assert.equal(m.merged, 2);
		const e = evaluate(m, ctx);
		assert.deepEqual(e.ivs, ivs);
		assert.ok(!e.issues.some(i => !i.info), JSON.stringify(e.issues));
		assert.ok(e.issues.some(i => i.code === 'merged'));
	}
	// not the same Pokémon
	assert.equal(canMerge(a, { ...b, cp: cp + 1 }, ctx), true, 'other CP, but HP and weight agree: the CP was misread');
	assert.equal(canMerge(a, { ...b, cp: cp + 555, weight_kg: null }, ctx), false, 'other CP, no weight');
	assert.equal(canMerge(a, { ...b, weight_kg: 31 }, ctx), false, 'weight contradicts');
	assert.equal(canMerge(a, { cp, hp: null, weight_kg: null }, ctx), false, 'only the CP agrees');
	assert.equal(canMerge(a, { cp, hp, weight_kg: null }, ctx), false, 'CP and HP alone are not enough');
	assert.equal(canMerge(a, { cp, hp, weight_kg: null, species: 'Testmon' }, ctx), true, 'CP, HP and species');
	assert.equal(canMerge(a, { cp, hp: null, weight_kg: 30 }, ctx), true, 'CP and weight');
	assert.equal(canMerge(a, { ...b, species: 'Fakeon' }, ctx), false, 'other species');
});

test('type labels are read from the stats row', () => {
	const r = parseWords([word('34.26kg', 200), word('ROCK', 500), word('GROUND', 640), word('0.69m', 1000)], W, makeRules(en));
	assert.deepEqual(r.types, ['ROCK', 'GROUND']);
});

test('fixSizes: a lost decimal point ("211" for 2.11 m)', async () => {
	const { fixSizes } = await import('../src/core/evaluate.js');
	const giant = gm.species.TESTMON.f.GIANT;	// 2.0 m, 50 kg, XXL max 3.1 m
	assert.equal(fixSizes(211, 52.75, giant).h.value, 2.11);
});

test('merging: a size with a hidden digit still fits the species; type labels carry over', async () => {
	const { canMerge, mergeReadings, mergeTarget } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];
	const { cp, hp } = shown(row, { a: 9, d: 9, s: 14 }, 20);
	const named = { species: 'Testmon', caught: null, hp, cp, height_m: null, weight_kg: null, bars: null, types: [] };
	// the other screenshot: no name, the trainer hides "1." of the height
	const other = { species: null, caught: null, hp, cp, height_m: 7, weight_kg: 30, bars: null, types: ['NORMAL'] };
	assert.ok(canMerge(named, other, ctx), 'height 7 repairs to 1.7 m');
	assert.deepEqual(mergeReadings(named, other, ctx).types, ['NORMAL']);
	assert.deepEqual(mergeReadings(other, named, ctx).types, ['NORMAL']);
	// labels of another form's types: not this Testmon
	assert.ok(!canMerge(named, { ...other, types: ['NORMAL', 'FLYING'] }, ctx), 'GIANT labels, normal stats');
	// one candidate: merge; two: keep it apart
	assert.equal(mergeTarget([other, { ...other, cp: cp + 400, hp: hp + 9 }], named, ctx), 0);
	assert.equal(mergeTarget([other, other], named, ctx), -1);
	assert.equal(mergeTarget([], named, ctx), -1);
});

test('merging: a CP misread by a digit merges when the other screenshot has the bars', async () => {
	const { canMerge, mergeReadings, mergeTarget } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];
	const ivs = { a: 15, d: 13, s: 15 };
	const { cp, hp } = shown(row, ivs, 20);
	// one digit misread, to a CP no Testmon with this HP can have
	const { solveIVs } = await import('../src/core/ivs.js');
	const alike = [...String(cp)].flatMap((_, i) => [...'0123456789'].map(d => Number(String(cp).slice(0, i) + d + String(cp).slice(i + 1))));
	const bad = alike.find(x => x !== cp && x >= 10 && !solveIVs(row, x, hp, gm.cpm).length);
	// with the appraisal: height hidden, CP read with an extra digit; without: CP one digit off
	const a = { species: 'Testmon', caught: null, hp, cp: Number(`${cp}0`), height_m: null, weight_kg: 30.12, bars: ivs };
	const b = { species: null, caught: null, hp, cp: bad, height_m: 1.7, weight_kg: 30.12, bars: null };
	assert.notEqual(bad, cp);
	assert.ok(canMerge(a, b, ctx) && canMerge(b, a, ctx));
	// with no size at all on the appraisal, HP plus a CP one digit off is too thin (MIN_SCORE):
	// in a box of hundreds that recurs
	assert.equal(canMerge({ ...a, weight_kg: null }, b, ctx), false);
	for (const m of [mergeReadings(a, b, ctx), mergeReadings(b, a, ctx)]) {
		const e = evaluate(m, ctx);
		assert.equal(e.cp, cp);
		assert.deepEqual(e.ivs, ivs);
		assert.equal(e.height_m, 1.7);
	}
	assert.ok(canMerge(a, { ...b, cp: null }, ctx), 'CP not read at all on the one without bars');
	assert.equal(canMerge({ ...a, weight_kg: null }, { ...b, cp: null }, ctx), false, '… unless that leaves only the HP');
	assert.equal(mergeTarget([a, { ...a, caught: '1/1/2025' }], { ...b, cp: null }, ctx), -1, 'two candidates: keep apart');
	// neither has bars: two different Pokémon may well differ by a digit
	assert.equal(canMerge({ ...a, bars: null, cp, weight_kg: null }, b, ctx), false);
	// HP differs: never
	assert.equal(canMerge(a, { ...b, hp: hp + 1 }, ctx), false);
});

test('merging: no CP on either screenshot, the type labels and sizes of the one without species fit', async () => {
	const { canMerge, mergeTarget, mergeReadings } = await import('../src/core/evaluate.js');
	const row = gm.species.MR_FAKE.f[''];
	const ivs = { a: 0, d: 5, s: 8 };
	const { cp, hp } = shown(row, ivs, 25);
	// a 16:9 screen, a sprite over the CP on both: the appraisal has species, date and bars but no
	// sizes, the plain screenshot sizes and type labels but no species (a nickname)
	const named = { species: 'Mr. Fake', caught: '8/29/2026', hp, cp: null, height_m: null, weight_kg: null, types: [], bars: { a: 0, d: 5, s: 8.01 }, name: 'XXL', covered: true };
	const other = { species: null, caught: null, hp, cp: null, height_m: 1.3, weight_kg: 55, types: ['PSYCHIC', 'FAIRY'], bars: null, name: 'XXL' };
	assert.ok(canMerge(named, other, ctx) && canMerge(other, named, ctx));
	const e = evaluate(mergeReadings(named, other, ctx), ctx);
	assert.equal(e.cp, cp);
	assert.equal(e.height_m, 1.3);
	assert.deepEqual(e.ivs, ivs);
	// HP and the nickname alone are not enough: many Pokémon share a nickname
	assert.equal(canMerge(named, { ...other, types: [] }, ctx), false);
	// nor labels that don't fit, a nickname that differs, or a CP read that the bars rule out
	assert.equal(canMerge(named, { ...other, types: ['PSYCHIC', 'WATER'] }, ctx), false);
	assert.equal(canMerge(named, { ...other, name: 'Fakey' }, ctx), false);
	assert.equal(canMerge(named, { ...other, hp: hp + 1 }, ctx), false);
	// two equally good candidates: kept apart
	assert.equal(mergeTarget([named, { ...named, caught: '8/30/2026' }], other, ctx), -1);
});

test('merging: of two possible sizes, the one with more characters wins ("1.6" vs 1.68)', async () => {
	const { mergeReadings } = await import('../src/core/evaluate.js');
	const r = { species: 'Testmon', caught: null, hp: 80, cp: 500, bars: null };
	for (const [x, y] of [[1.6, 1.68], [1.68, 1.6]]) {
		const m = mergeReadings({ ...r, height_m: x, weight_kg: 30 }, { ...r, height_m: y, weight_kg: 30.5 }, ctx);
		assert.equal(m.height_m, 1.68);
		assert.equal(m.weight_kg, 30.5);
	}
});

test('merging, several candidates: the clearly best one is taken, a close race stays apart', async () => {
	const { mergeTarget, matchScore, MERGE_MARGIN } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];
	const ivs = { a: 12, d: 12, s: 0 };
	const { cp, hp } = shown(row, ivs, 20);
	// the right one: HP, weight, height and CP all agree. The other: same HP, CP one digit off,
	// bars, no sizes read (the old rule set accepted both, so neither was taken)
	const right = { species: 'Testmon', caught: '10/2/2026', hp, cp, height_m: 1.6, weight_kg: 33.43, bars: ivs };
	const near = { species: 'Testmon', caught: '9/1/2026', hp, cp: cp + 1, height_m: null, weight_kg: null, bars: { a: 0, d: 0, s: 0 } };
	const other = { species: null, caught: null, hp, cp, height_m: 1.6, weight_kg: 33.43, bars: null };
	assert.equal(mergeTarget([near, right], other, ctx), 1);
	const twin = { ...right, caught: '10/3/2026' };
	assert.ok(Math.abs(matchScore(right, other, ctx) - matchScore(twin, other, ctx)) < MERGE_MARGIN);
	assert.equal(mergeTarget([right, twin], other, ctx), -1, 'equally good: keep apart');
});

test('merging: what rules a pair out', async () => {
	const { canMerge } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];
	const ivs = { a: 9, d: 9, s: 9 };
	const { cp, hp } = shown(row, ivs, 20);
	const named = { species: 'Testmon', caught: null, hp, cp, height_m: 1.6, weight_kg: 30.12, bars: ivs, types: [] };
	const other = { species: null, caught: null, hp, cp, height_m: 1.6, weight_kg: 30.12, bars: null, types: ['NORMAL'] };
	assert.ok(canMerge(named, other, ctx));
	assert.equal(canMerge(named, { ...other, types: ['WATER'] }, ctx), false, 'a type the species does not have');
	assert.ok(canMerge(named, { ...other, types: ['NORMAL', 'FLYING'] }, ctx), 'the types of another form (Giant)');
	assert.equal(canMerge(named, { ...other, weight_kg: 30.13 }, ctx), false, 'weight a digit off');
	assert.ok(canMerge(named, { ...other, weight_kg: 0.12 }, ctx), 'leading characters hidden ("0.12" of 30.12)');
	assert.ok(canMerge(named, { ...other, height_m: 1.62 }, ctx), 'height a digit off: let off');
	assert.equal(canMerge(named, { ...other, height_m: 1.2 }, ctx), false, 'height clearly different');
	// two screenshots without a name, same HP and weight, clearly different CPs: twins
	const a = { species: null, caught: null, hp: 68, cp: 330, height_m: 0.32, weight_kg: 0.82, bars: null };
	assert.equal(canMerge(a, { ...a, cp: 284 }, ctx), false);
	assert.ok(canMerge(a, { ...a, cp: 380 }, ctx), 'CP one digit off');
});

test('CP: every read counts, a forced one is flagged', async () => {
	const { mergeReadings } = await import('../src/core/evaluate.js');
	const row = gm.species.TESTMON.f[''];
	const ivs = { a: 15, d: 13, s: 15 };
	const { cp, hp } = shown(row, ivs, 20);
	const garbage = Number(String(cp).split('').reverse().join('')) + 3000;
	const a = { species: 'Testmon', caught: null, hp, cp: garbage, height_m: 1.6, weight_kg: 30, bars: ivs };
	const b = { species: null, caught: null, hp, cp: cp + 10, height_m: 1.6, weight_kg: 30, bars: null };
	const m = mergeReadings(a, b, ctx);
	assert.deepEqual(m.cpAlt, [cp + 10]);
	const e = evaluate(m, ctx);
	assert.equal(e.cp, cp, 'the other screenshot\'s read looks like the possible CP');
	const alone = evaluate(a, ctx);
	if (alone.cp === cp) assert.ok(alone.issues.some(i => i.code === 'cp'), 'nothing like it: taken, but to check');
});

test('XXL: the badge decides at the boundary and is checked against the height', () => {
	const r = { species: 'Testmon', hp: null, cp: null, weight_kg: 20, bars: null };
	const ed = { ivs: { a: 0, d: 0, s: 0 } };
	assert.equal(evaluate({ ...r, height_m: 1.5 }, ctx, ed).xxl, null);
	assert.equal(evaluate({ ...r, height_m: 1.5, badge: 'XXL' }, ctx, ed).xxl, true);
	assert.equal(evaluate({ ...r, height_m: 1.5, badge: 'XL' }, ctx, ed).xxl, false);
	const c = evaluate({ ...r, height_m: 1.7, badge: 'XL' }, ctx, ed);
	assert.equal(c.xxl, true);
	assert.ok(c.issues.some(i => i.code === 'xxl'), 'badge and height disagree');
});

test('duplicates: twins caught the same day with the same sizes are told apart by their IVs', () => {
	const row = gm.species.TESTMON.f[''];
	const r = ivs => ({ species: 'Testmon', caught: '9/6/2026', ...shown(row, ivs, 20), height_m: 1.6, weight_kg: 30.48, bars: ivs });
	const a = evaluate(r({ a: 8, d: 15, s: 10 }), ctx), b = evaluate(r({ a: 10, d: 13, s: 9 }), ctx);
	assert.notEqual(a.key, b.key);
	// the same one powered up: same IVs, other CP and HP, same key
	const up = evaluate({ ...r({ a: 8, d: 15, s: 10 }), ...shown(row, { a: 8, d: 15, s: 10 }, 25) }, ctx);
	assert.equal(up.key, a.key);
});

test('evaluate: a size nothing can repair is asked for, not guessed', () => {
	const r = evaluate({ species: 'Testmon', hp: null, cp: null, height_m: 999.5, weight_kg: 20, bars: { a: 1, d: 2, s: 3 } }, ctx);
	assert.equal(r.height_m, null);
	assert.deepEqual(r.issues.filter(i => i.code === 'size').map(i => i.msg), ['Height read as 999.5 m, impossible for Testmon: please type it in']);
	assert.equal(r.score, null);
});

test('evaluate: without the bars, several IV combinations fit CP/HP and the user picks', () => {
	const { cp, hp } = shown(gm.species.TESTMON.f[''], { a: 10, d: 10, s: 10 }, 25);
	const r = evaluate({ species: 'Testmon', hp, cp, height_m: 1.2, weight_kg: 20, bars: null }, ctx);
	assert.equal(r.ivSource, 'cp');
	assert.ok(r.candidates.length > 1 && r.candidates.length <= 12, `${r.candidates.length}`);
	assert.ok(r.issues.some(i => i.code === 'ivs' && /IV combinations fit CP\/HP, pick one/.test(i.msg)));
});

test('evaluate: bars far from every IV combination CP/HP allow are flagged', () => {
	// 0/0/15 at level 25, bars read as 15/15/15: same HP, and the bars allow two CPs at that HP,
	// neither like the one read
	const { cp, hp } = shown(gm.species.TESTMON.f[''], { a: 0, d: 0, s: 15 }, 25);
	const r = evaluate({ species: 'Testmon', hp, cp, height_m: 1.2, weight_kg: 20.4, bars: { a: 15, d: 15, s: 15 } }, ctx);
	assert.deepEqual(r.ivs, { a: 0, d: 0, s: 15 }, 'CP/HP decide when the bars fit nothing');
	assert.equal(r.cp, cp);
	assert.deepEqual(r.issues.map(i => i.code), ['bars']);
});

test('evaluate: IVs from the bars alone; a CP that fits no level at that HP is flagged', () => {
	const ivs = { a: 10, d: 10, s: 10 };
	const { hp } = shown(gm.species.FAKEON.f[''], ivs, 25);	// a Fakeon with these IVs has this HP at 25 and 25.5
	const r = evaluate({ species: 'Fakeon', hp, cp: 9999, height_m: 0.5, weight_kg: 8.31, bars: ivs }, ctx);
	assert.equal(r.ivSource, 'bars');
	assert.deepEqual(r.ivs, ivs);
	assert.equal(r.level, 25, 'the first level the bars and HP allow');
	assert.equal(r.cp, 9999, 'two CPs possible, none like the reading: not replaced');
	assert.equal(r.cpExpected.length, 2);
	assert.deepEqual(r.issues.map(i => i.msg), [`CP 9999 doesn't fit; expected ${r.cpExpected.join(' or ')}`]);
	const noHp = evaluate({ species: 'Fakeon', hp: null, cp: null, height_m: 0.5, weight_kg: 8, bars: ivs }, ctx);
	assert.deepEqual(noHp.ivs, ivs);
	assert.equal(noHp.level, null, 'no HP, no level');
});

test('evaluate: a whole-number size under the appraisal is marked to check, nowhere else', () => {
	const r = { species: 'Testmon', hp: null, cp: null, height_m: 1, weight_kg: 30.12, bars: { a: 1, d: 2, s: 3 } };
	const whole = x => x.issues.filter(i => i.code === 'size-whole').map(i => i.msg);
	assert.deepEqual(whole(evaluate(r, ctx)), ['Height read as 1 m: a whole number, digits may be hidden. Save to confirm.']);
	assert.deepEqual(whole(evaluate({ ...r, bars: null }, ctx)), [], 'no appraisal, nothing drawn over the stats row');
	assert.deepEqual(whole(evaluate({ ...r, merged: 2 }, ctx)), [], 'merged: another screenshot had the longer reading');
	assert.deepEqual(whole(evaluate(r, ctx, { height_m: 1 })), [], 'confirmed by saving');
	assert.deepEqual(whole(evaluate({ ...r, height_m: 1.6, weight_kg: 30 }, ctx)), ['Weight read as 30 kg: a whole number, digits may be hidden. Save to confirm.']);
});

test('evaluate: a missing size says why when the appraisal covers the stats row', () => {
	const r = { species: 'Testmon', hp: null, cp: null, bars: { a: 1, d: 2, s: 3 } };
	const msg = x => evaluate(x, ctx).issues.find(i => i.code === 'size').msg;
	assert.match(msg({ ...r, height_m: null, weight_kg: null, covered: true }), /under the appraisal on this screen: add a screenshot without it/);
	assert.equal(msg({ ...r, height_m: 1.2, weight_kg: null, covered: true }), 'Height or weight missing');
	assert.equal(msg({ ...r, height_m: null, weight_kg: null }), 'Height or weight missing');
});

test('merging: type labels on both screenshots may lose one label, never change one', async () => {
	const { canMerge } = await import('../src/core/evaluate.js');
	const a = { species: null, caught: null, hp: 68, cp: 330, height_m: 1.6, weight_kg: 30.12, bars: null, types: ['NORMAL'] };
	assert.ok(canMerge(a, { ...a, types: ['NORMAL', 'FLYING'] }, ctx), 'one label hidden');
	assert.ok(canMerge({ ...a, types: ['NORMAL', 'FLYING'] }, a, ctx));
	assert.equal(canMerge(a, { ...a, types: ['FLYING'] }, ctx), false, 'another label');
});

test('evaluate: a form the user picked is kept; one the species does not have is ignored', () => {
	const { cp, hp } = shown(gm.species.TESTMON.f[''], { a: 10, d: 10, s: 10 }, 25);
	const r = { species: 'Testmon', hp, cp, height_m: 1.2, weight_kg: 20, bars: { a: 10, d: 10, s: 10 } };
	assert.equal(evaluate(r, ctx).form, '');
	const giant = evaluate(r, ctx, { form: 'GIANT' });
	assert.equal(giant.form, 'GIANT');
	assert.deepEqual(giant.forms, ['', 'GIANT'], 'the others stay offered');
	assert.ok(!giant.issues.some(i => i.code === 'form'));
	assert.equal(evaluate(r, ctx, { form: 'ALOLA' }).form, '');
});

test('evaluate: a CP read exactly as one the bars and HP allow beats others that look like a read', () => {
	// E.g. read as CP 35 and 835, with bars and HP allowing 829, 835 or 841: 835 is read exactly, 829
	// only looks like it (one digit off). Find such a pair in the test species.
	const row = gm.species.FAKEON.f[''];
	const ivs = { a: 7, d: 12, s: 8 };
	let pair = null;
	for (let l = 15; l < 40 && !pair; l += 0.5) {
		const x = shown(row, ivs, l), y = shown(row, ivs, l + 0.5);
		const a = String(x.cp), b = String(y.cp);
		if (x.hp === y.hp && a.length === b.length && a.length >= 3 && [...a].filter((c, i) => c !== b[i]).length === 1) pair = { lower: x.cp, cp: y.cp, hp: y.hp, level: l + 0.5 };
	}
	assert.ok(pair, 'no two CPs one digit apart at the same HP');
	const bars = { a: 6.99, d: 11.94, s: 8.01 };
	const r = evaluate({ species: 'Fakeon', hp: pair.hp, cp: Number(String(pair.cp).slice(1)), cpAlt: [pair.cp], height_m: 0.5, weight_kg: 8.31, bars }, ctx);
	assert.equal(r.cp, pair.cp);
	assert.equal(r.level, pair.level);
	assert.ok(!r.issues.some(i => !i.info), JSON.stringify(r.issues));
});

test('evaluate: a CP read exactly as one form\'s beats one that only looks like another form\'s', () => {
	// two forms with the same stamina (same HP, same levels), as Dialga and Origin Dialga
	const gm2 = structuredClone(gm);
	const normal = gm2.species.FAKEON.f[''];
	const origin = normal.slice();
	origin[ROW.ATK] = normal[ROW.ATK] + 12;
	gm2.species.FAKEON.f.ORIGIN = origin;
	const ctx2 = makeContext(gm2, en);
	const ivs = { a: 15, d: 15, s: 15 };
	const n = shown(normal, ivs, 30), o = shown(origin, ivs, 30);
	assert.equal(n.hp, o.hp);
	assert.notEqual(n.cp, o.cp);
	// one pass read a digit off the normal form's CP, another the Origin form's exactly
	const reading = { species: 'Fakeon', hp: o.hp, cp: n.cp + 1, cpAlt: [o.cp], height_m: 0.5, weight_kg: 8, bars: { a: 14.8, d: 14.8, s: 14.8 } };
	const r = evaluate(reading, ctx2);
	assert.equal(r.form, 'ORIGIN');
	assert.equal(r.cp, o.cp);
	assert.ok(!r.issues.some(i => i.code === 'form'), JSON.stringify(r.issues));
	// read exactly for both: still unclear
	const both = evaluate({ ...reading, cp: n.cp }, ctx2);
	assert.ok(both.issues.some(i => i.code === 'form'), JSON.stringify(both.issues));
});
