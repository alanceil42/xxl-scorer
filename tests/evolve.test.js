// Evolve gain: the score after evolving (place in the XXL band and weight factor kept), the
// cases without a prediction, branches and chains, and which scan replaces which row.
// Made-up species in the compact shape; K values as the game uses them (1.55, 1.75, 2.00).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../src/core/score.js';
import { compileSearch } from '../src/core/search.js';
import { SORTS, sortList } from '../src/core/sort.js';
import { cleanRow, cleanReplaced } from '../src/core/backup.js';
import {
	evolveTargets, evolvedSize, predictEvolve, evolveOf, evolvedFrom, evolvedPairs, replacements,
	gainKey, gainText, wayText,
} from '../src/core/evolve.js';

const coef = { h: 800, w: 150, iv: 50, xxlAdj: 1, xxlBonus: 178 };
/** A compact row: average height h, weight w, σ = w/8, XXL top K·h, XL bound xl·h. */
const row = (h, w, K, xl = 1.5, types = 'NORMAL') => [h, w, w / 8, K * h, 100, 100, 100, types, xl * h, h / 2];
const sp = (dex, f, extra = {}) => ({ dex, f, ...extra });
const gm = {
	v: 2, coef, cpm: [], species: {
		// 1.75 → 1.55: gains
		CUBLET: sp(9101, { '': row(0.5, 6.8, 1.75) }, { evo: { '': ['BIGBEAR'] }, evoCandy: { '': [400] } }),
		BIGBEAR: sp(9102, { '': row(2.1, 135, 1.55) }),
		// 1.55 → 1.75: loses
		HOPPLE: sp(9103, { '': row(0.7, 30, 1.55) }, { evo: { '': ['GRUNTLE'] }, evoCandy: { '': [50] } }),
		GRUNTLE: sp(9104, { '': row(0.9, 70, 1.75) }),
		// 2.00 → 1.55: the biggest gain
		SPORELET: sp(9105, { '': row(0.2, 1, 2.0) }, { evo: { '': ['SPOREKING'] }, evoCandy: { '': [50] } }),
		SPOREKING: sp(9106, { '': row(0.6, 10.5, 1.55) }),
		// a chain: 1.75 → 1.75 → 1.55
		PUPLING: sp(9107, { '': row(0.4, 4, 1.75) }, { evo: { '': ['MIDDOG'] }, evoCandy: { '': [25] } }),
		MIDDOG: sp(9108, { '': row(0.9, 15, 1.75) }, { evo: { '': ['TOPDOG'] }, evoCandy: { '': [100] } }),
		TOPDOG: sp(9109, { '': row(1.2, 60, 1.55) }),
		// branches: one by chance pair, one with an item, one male only; and a regional form
		BRANCHY: sp(9110, { '': row(0.3, 6, 1.75), ALOLA: row(0.3, 6, 1.75) }, {
			evo: { '': ['LEAFY', 'ROCKY', 'STONY', 'MANLY'], ALOLA: ['LEAFY/ALOLA'] },
			evoCandy: { '': [25, 25, 25, 100], ALOLA: [50] },
			evoItem: { '': [null, null, 'GEN4_EVOLUTION_STONE', null] },
			evoGender: { '': [null, null, null, 'MALE'] },
		}),
		LEAFY: sp(9111, { '': row(1.0, 25, 1.55), ALOLA: row(1.1, 30, 2.0) }),
		ROCKY: sp(9112, { '': row(1.0, 25, 1.75) }),
		STONY: sp(9113, { '': row(1.0, 25, 1.55) }),
		MANLY: sp(9114, { '': row(1.0, 25, 1.55) }),
		// sizes the rule wasn't measured on
		ODDLING: sp(9115, { '': row(0.4, 5, 1.75, 1.6) }, { evo: { '': ['BIGBEAR'] }, evoCandy: { '': [50] } }),
		TOSUPER: sp(9116, { '': row(0.4, 5, 1.75) }, { evo: { '': ['SUPERGOURD'] }, evoCandy: { '': [50] } }),
		SUPERGOURD: sp(9117, { '': row(1.75, 39, 1.0, 0.85) }),
		LONER: sp(9118, { '': row(1.0, 10, 1.75) }),
		// same K: nothing changes
		EVENLY: sp(9121, { '': row(0.6, 8, 2.0) }, { evo: { '': ['EVENMORE'] }, evoCandy: { '': [25] } }),
		EVENMORE: sp(9122, { '': row(1.5, 50, 2.0) }),
		// a target form the game data dropped as equal to the base (colours): the base row
		COLORLET: sp(9123, { '': row(0.1, 0.1, 1.75) }, { evo: { '': ['COLORFUL/RED'], BLUE: ['COLORFUL/BLUE'] }, evoCandy: { '': [25], BLUE: [25] } }),
		COLORFUL: sp(9124, { '': row(0.2, 0.9, 1.75) }),
		// a candy-free step (an item instead)
		COINER: sp(9119, { '': row(0.3, 5, 1.75) }, { evo: { '': ['GOLDEN'] }, evoCandy: { '': [null] }, evoItem: { '': ['OTHER_THING'] } }),
		GOLDEN: sp(9120, { '': row(1.2, 30, 1.75) }),
	},
};
const names = Object.fromEntries(Object.entries(gm.species).map(([id, s]) => [String(s.dex), id[0] + id.slice(1).toLowerCase()]));
const ctx = { gm, text: { names } };

/** An evaluated row as evaluate() gives it, with a score from its sizes and IVs. */
function ev(id, h, w, ivs = { a: 10, d: 5, s: 6 }, more = {}) {
	const s = gm.species[id];
	const form = more.form ?? '';
	const r = s.f[form] || s.f[''];
	const xxl = h > r[8];
	return {
		id, form, name: names[String(s.dex)], formName: form ? 'Alola' : '', dex: s.dex,
		height_m: h, weight_kg: w, xxl, xxs: false, mega: false, caught: '7/1/2024',
		ivs, ivSource: 'bars+cp', issues: [],
		score: score(r, coef, h, w, ivs.a + ivs.d + ivs.s, xxl),
		...more,
	};
}

/** The rule written out once more, independently: h'/h̄' = 1.5 + p·(K' − 1.5), w'/w̄' = m·h'/h̄'. */
function byHand(from, to, h, w, ivSum) {
	const x = h / from[0], K = from[3] / from[0], K2 = to[3] / to[0];
	const p = (x - 1.5) / (K - 1.5), x2 = 1.5 + p * (K2 - 1.5), m = (w / from[1]) / x;
	return 800 * x2 / K2 + 150 * m * x2 / (K2 + 0.5) + 50 * ivSum / 45 + 178;
}

test('the rule: place in the XXL band and weight for height kept; K 1.75 to 1.55 gains', () => {
	const e = ev('CUBLET', 0.82, 12.55);
	const p = predictEvolve(e, ctx);
	assert.equal(p.kind, 'gain');
	assert.equal(p.best.id, 'BIGBEAR');
	const want = byHand(gm.species.CUBLET.f[''], gm.species.BIGBEAR.f[''], 0.82, 12.55, 21);
	assert.ok(Math.abs(p.best.total - want) < 1e-9, `${p.best.total} vs ${want}`);
	assert.equal(p.best.total.toFixed(1), '1115.8');	// 1074.1 before
	assert.equal(e.score.total.toFixed(1), '1074.1');
	assert.equal(p.best.gain.toFixed(1), '41.7');
	// ± is the row's 0.005 m and kg put through the rule: much tighter than its own ± 4.6
	assert.equal(p.best.band.toFixed(1), '0.5');
	assert.equal(e.score.band.toFixed(1), '4.6');
	// the size after evolving: the band's place kept
	const s = evolvedSize(gm.species.CUBLET.f[''], gm.species.BIGBEAR.f[''], 0.82, 12.55);
	assert.equal(s.h.toFixed(3), '3.209');
	assert.equal(gainText(p), '+42 as Bigbear · 400 candy');
});

test('the other K changes: 1.55 to 1.75 loses, 2.00 to 1.55 gains most; the top of the band keeps its score', () => {
	const loss = predictEvolve(ev('HOPPLE', 1.06, 50), ctx);
	assert.equal(loss.kind, 'loss');
	assert.ok(Math.abs(loss.best.total - byHand(gm.species.HOPPLE.f[''], gm.species.GRUNTLE.f[''], 1.06, 50, 21)) < 1e-9);
	assert.match(gainText(loss), /^−\d+ if evolved$/);
	const big = predictEvolve(ev('SPORELET', 0.31, 1.6), ctx);
	assert.equal(big.kind, 'gain');
	assert.ok(big.best.gain > 150, String(big.best.gain));
	assert.ok(Math.abs(big.best.total - byHand(gm.species.SPORELET.f[''], gm.species.SPOREKING.f[''], 0.31, 1.6, 21)) < 1e-9);
	// at the band's bottom 1.75 → 1.55 gives about 88 from the height and 10 from the weight
	// (weight for height as the average); at its top the height part stays and the weight part
	// loses 3: its denominator is K + 0.5
	const bottom = predictEvolve(ev('CUBLET', 0.751, 10.21), ctx).best.gain;
	assert.ok(bottom > 96 && bottom < 99, String(bottom));
	const top = predictEvolve(ev('CUBLET', 0.875, 11.9), ctx);
	assert.ok(top.best.gain > -3.5 && top.best.gain < -3, String(top.best.gain));
	// about the same: the same K
	const same = predictEvolve(ev('EVENLY', 1.1, 14), ctx);
	assert.equal(same.kind, 'same', String(same.best.gain));
	assert.equal(gainText(same), 'about the same if evolved');
	assert.equal(gainKey(same), 0);
});

test('no prediction: not XXL, no score, mega, XL bound not 1.5, a K = 1 target, nothing to evolve into', () => {
	assert.equal(predictEvolve(ev('CUBLET', 0.7, 8), ctx), null, 'not XXL');
	assert.equal(predictEvolve({ ...ev('CUBLET', 0.82, 12.55), score: null }, ctx), null, 'no score (no IVs)');
	assert.equal(predictEvolve({ ...ev('CUBLET', 0.82, 12.55), mega: true }, ctx), null, 'mega');
	assert.equal(predictEvolve(ev('ODDLING', 0.7, 9), ctx), null, 'XL bound 1.6 × average');
	assert.equal(predictEvolve(ev('TOSUPER', 0.66, 9), ctx), null, 'the only target has K = 1');
	assert.equal(predictEvolve(ev('LONER', 1.6, 15), ctx), null, 'no evolution');
	assert.equal(predictEvolve(ev('BIGBEAR', 3.2, 230), ctx), null, 'the last stage');
	assert.equal(gainKey(null), null);
	assert.equal(gainText(null), null);
});

test('IVs not known: the gain holds, the IVs\' spread is added to ±', () => {
	const e = ev('CUBLET', 0.82, 12.55);
	const known = predictEvolve(e, ctx);
	const open = predictEvolve({ ...e, score: { ...e.score, lo: e.score.total - 10, hi: e.score.total + 10, band: 14.6 } }, ctx);
	assert.equal(open.best.gain.toFixed(6), known.best.gain.toFixed(6));
	assert.equal((open.best.band - known.best.band).toFixed(6), '10.000000');
});

test('targets: chains summed, branches each, the best first, equal ones the easiest first', () => {
	const t = evolveTargets(gm, 'PUPLING');
	assert.deepEqual(t.map(x => [x.id, x.candy, x.steps]), [['MIDDOG', 25, 1], ['TOPDOG', 125, 2]]);
	const p = predictEvolve(ev('PUPLING', 0.66, 7), ctx);
	assert.equal(p.best.id, 'TOPDOG', 'two steps away, the only K change');
	assert.equal(p.targets[1].id, 'MIDDOG');
	assert.ok(Math.abs(p.targets[1].gain) < 1e-9, 'same K: no change');
	// branches: Leafy, Stony and Manly gain alike; Leafy is the easiest (no item, no gender)
	const b = predictEvolve(ev('BRANCHY', 0.48, 10), ctx);
	assert.deepEqual(b.targets.map(x => x.id).slice(0, 3), ['LEAFY', 'STONY', 'MANLY']);
	assert.equal(b.targets.at(-1).id, 'ROCKY');
	const way = id => wayText(b.targets.find(x => x.id === id));
	assert.deepEqual(way('LEAFY'), ['25 candy', 'by chance'], 'Leafy and Rocky: nothing picks one');
	assert.deepEqual(way('STONY'), ['25 candy', 'Sinnoh Stone']);
	assert.deepEqual(way('MANLY'), ['100 candy', 'male only']);
	assert.equal(gainText(b), `+${Math.round(b.best.gain)} as Leafy · 25 candy · by chance`);
	// a regional form evolves into its own form, by that form's K (2.00: a loss)
	const a = predictEvolve(ev('BRANCHY', 0.48, 10, undefined, { form: 'ALOLA' }), ctx);
	assert.deepEqual(a.targets.map(x => [x.id, x.form]), [['LEAFY', 'ALOLA']]);
	assert.equal(a.kind, 'loss');
	// a form dropped from the game data is the base form, as a scan of it has it
	assert.deepEqual(evolveTargets(gm, 'COLORLET').map(x => [x.id, x.form]), [['COLORFUL', '']]);
	// an item instead of candy
	assert.deepEqual(wayText(evolveTargets(gm, 'COINER')[0]), ['an item']);
});

test('sort "Evolve gain": gains largest first, about the same, losses, then rows that can\'t evolve', () => {
	const items = [
		['same', ev('EVENLY', 1.1, 14)], ['loner', ev('LONER', 1.6, 15)], ['loss', ev('HOPPLE', 1.06, 50)],
		['big', ev('SPORELET', 0.31, 1.6)], ['gain', ev('CUBLET', 0.82, 12.55)], ['notxxl', ev('CUBLET', 0.7, 8)],
	].map(([id, e]) => ({ row: { id }, e }));
	for (const x of items) evolveOf(x.e, ctx);	// the page predicts every row before sorting
	sortList(items, { key: 'gain', dir: -1 }, -1);
	assert.deepEqual(items.slice(0, 4).map(x => x.row.id), ['big', 'gain', 'same', 'loss']);
	assert.deepEqual(items.slice(4).map(x => x.row.id).sort(), ['loner', 'notxxl']);
	assert.equal(SORTS.gain.label, 'Evolve gain');
	assert.equal(SORTS.gain.dirs[-1], 'gains first');
});

test('search "gain": the rows whose score would rise beyond ±; "evolve" stays free text', () => {
	const g = compileSearch('gain', ctx);
	assert.equal(g(ev('CUBLET', 0.82, 12.55)), true);
	assert.equal(g(ev('EVENLY', 1.1, 14)), false, 'about the same');
	assert.equal(g(ev('HOPPLE', 1.06, 50)), false, 'a loss');
	assert.equal(g(ev('LONER', 1.6, 15)), false);
	assert.equal(compileSearch('!gain', ctx)(ev('LONER', 1.6, 15)), true);
	assert.equal(compileSearch('evolve', ctx)(ev('CUBLET', 0.82, 12.55)), false, 'the game\'s term means enough candy');
});

// The evolved scan of a Cublet caught on 7/1/2024 with 10/5/6: its predicted size, shown to 0.01.
const old = () => ev('CUBLET', 0.82, 12.55);
const evolved = (more = {}) => ev('BIGBEAR', 3.21, 232.14, undefined, more);

test('an evolved scan: same catch date and IVs, a species it evolves into, a size inside the prediction', () => {
	assert.equal(evolvedFrom(old(), evolved(), ctx).id, 'BIGBEAR');
	assert.equal(evolvedFrom(old(), evolved({ caught: '7/2/2024' }), ctx), null, 'another day');
	assert.equal(evolvedFrom(old(), evolved({ ivs: { a: 10, d: 5, s: 7 } }), ctx), null, 'other IVs');
	assert.equal(evolvedFrom(old(), ev('BIGBEAR', 3.25, 232.14), ctx), null, 'too tall for the prediction');
	assert.equal(evolvedFrom(old(), evolved({ ivSource: 'cp' }), ctx), null, 'IVs only a guess from CP');
	assert.equal(evolvedFrom(old(), ev('GRUNTLE', 1.3, 90), ctx), null, 'a species it can\'t evolve into');
	assert.equal(evolvedFrom(evolved(), old(), ctx), null, 'never backwards');
});

const item = (id, e) => ({ row: { id }, e });

test('replacing: the old row goes whichever came first, in one batch or two', () => {
	const A = item('old', old()), B = item('new', evolved());
	for (const list of [[A, B], [B, A]]) {
		for (const touched of [['old', 'new'], ['new'], ['old']]) {
			const r = replacements(evolvedPairs(list, new Set(touched), ctx));
			assert.deepEqual(r.map(x => [x.old.id, x.next.id]), [['old', 'new']], `${list.map(x => x.row.id)} touched ${touched}`);
		}
	}
	// nothing touched by the batch: nothing changes (an import never replaces)
	assert.deepEqual(evolvedPairs([A, B], new Set(['other']), ctx), []);
});

test('replacing: twins caught the same day with the same IVs; a guess between two is no replacement', () => {
	// two families, same day, same IVs: each finds its own
	const H = item('hop', ev('HOPPLE', 1.06, 50)), Hx = item('hop2', ev('GRUNTLE', 1.42, 115.2));
	const p0 = predictEvolve(H.e, ctx).best;
	Hx.e = ev('GRUNTLE', Number(p0.height_m.toFixed(2)), Number(p0.weight_kg.toFixed(2)));
	const list = [item('old', old()), H, item('new', evolved()), Hx];
	const r = replacements(evolvedPairs(list, new Set(['new', 'hop2']), ctx));
	assert.deepEqual(r.map(x => [x.old.id, x.next.id]).sort(), [['hop', 'hop2'], ['old', 'new']]);
	// two Cublets alike that both fit one Bigbear: no guess, both stay
	const twin = item('old2', ev('CUBLET', 0.82, 12.55));
	assert.deepEqual(evolvedPairs([item('old', old()), twin, item('new', evolved())], new Set(['new']), ctx), []);
});

test('replacing: one Pokémon scanned at each stage keeps only the last, its note naming the first', () => {
	const e1 = ev('PUPLING', 0.66, 7);
	const p = predictEvolve(e1, ctx);
	const at = id => { const t = p.targets.find(x => x.id === id); return ev(id, Number(t.height_m.toFixed(2)), Number(t.weight_kg.toFixed(2))); };
	const list = [item('p1', e1), item('p2', at('MIDDOG')), item('p3', at('TOPDOG'))];
	const r = replacements(evolvedPairs(list, new Set(['p3']), ctx));
	assert.deepEqual(r.map(x => [x.old.id, x.next.id]), [['p1', 'p3'], ['p2', 'p3']]);
	assert.equal(r[0].oldE.name, 'Pupling', 'the earliest first, for the note');
});

test('backup: the note travels with the row; replaced ids are read as strings, each once', () => {
	const good = { id: 'x', reading: { species: 'Bigbear' }, edits: {}, evolvedFrom: { name: 'Cublet', score: 1074 } };
	assert.deepEqual(cleanRow(good).evolvedFrom, { name: 'Cublet', score: 1074 });
	assert.equal(cleanRow({ ...good, evolvedFrom: { name: '<b>'.repeat(30), score: 1 } }).evolvedFrom, undefined);
	assert.equal(cleanRow({ ...good, evolvedFrom: { name: 'Cublet', score: 'x' } }).evolvedFrom, undefined);
	assert.equal(cleanRow({ ...good, evolvedFrom: ['Cublet'] }).evolvedFrom, undefined);
	assert.deepEqual(cleanReplaced(['a', 'b', 'a', 5, null, 'x'.repeat(65), {}]), ['a', 'b']);
	assert.deepEqual(cleanReplaced('a'), []);
	assert.deepEqual(cleanReplaced(undefined), []);
});
