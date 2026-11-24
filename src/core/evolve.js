// Evolve gain: the showcase score a Pokémon would have after evolving, and which rows are the
// evolved form of another row. Pure, so the tests run it in Node.
//
// The rule (measured on pairs of the same Pokémon scanned before and after evolving): the
// Pokémon keeps its place in the XXL band, which runs from the XL bound (1.5 × the average
// height) up to K × the average, and it keeps how heavy it is for its height. The IVs and the
// XXL bonus stay. So the score changes only where K does: from 1.75 to 1.55 a Pokémon at the
// bottom of the band gains about 88 points by its height (and some 10 by its weight), one at
// the top nothing by its height and a few points less by its weight (whose divisor is K + 0.5).
import { ROW, formsOf } from './gm.js';
import { score } from './score.js';
import { formLabel } from './evaluate.js';

const XL = 1.5;	// the XL bound over the average height the rule was measured on
const EPS = 1e-6;

/**
 * A row's size settings, or null where the rule wasn't measured: an XL bound other than 1.5 ×
 * the average (Pumpkaboo's sizes and a few other forms), or no XXL band above the average
 * (K = 1: Super Pumpkaboo and Super Gourgeist).
 */
function band(row) {
	if (!row) return null;
	const h0 = row[ROW.H], a = row[ROW.XL_MAX] / h0, K = row[ROW.XXL_MAX] / h0;
	if (!(h0 > 0) || Math.abs(a - XL) > EPS || !(K > a + EPS)) return null;
	return { a, K };
}

/** A form's row; a form the game data dropped (same as the base) is the base. */
function rowOf(gm, id, form) {
	const f = formsOf(gm, id);
	return (f.find(x => x.form === form) || f.find(x => x.form === ''))?.row ?? null;
}

/** "SPECIES/FORM" or "SPECIES" as the game data's evo lists them → [id, form]. */
const split = t => { const i = t.indexOf('/'); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i + 1)]; };

/**
 * Every species and form one form can evolve into, one or more steps away (Charmander:
 * Charmeleon, Charizard), with what the way there takes: candy (summed; null where a step takes
 * an item and no candy), items, the gender a step needs, other conditions (evoCond's codes), and
 * whether a step is left to chance (two or more evolutions with no gender, item or condition to
 * pick one, as Eevee's first three). Mega evolutions are not in evo, so not here.
 */
export function evolveTargets(gm, id, form = '') {
	const out = [];
	const seen = new Set([`${id}/${form}`]);
	const queue = [{ id, form, way: { candy: 0, items: [], gender: null, cond: [], chance: false, steps: 0 } }];
	while (queue.length) {
		const { id: from, form: ff, way } = queue.shift();
		const sp = Object.hasOwn(gm.species, from) ? gm.species[from] : null;
		const evo = sp && sp.evo && (sp.evo[ff] || (ff && !sp.f[ff] ? sp.evo[''] : null));
		if (!evo) continue;
		const key = sp.evo[ff] ? ff : '';
		const at = (field, i) => (sp[field] && sp[field][key] ? sp[field][key][i] ?? null : null);
		// left to chance: no gender, item or condition tells this evolution from another such one
		const free = evo.map((_, i) => !at('evoGender', i) && !at('evoItem', i) && !at('evoCond', i));
		const chance = free.filter(Boolean).length > 1;
		evo.forEach((t, i) => {
			const [tid, named] = split(t);
			if (!Object.hasOwn(gm.species, tid)) return;
			// a form the game data dropped as equal to the base (Floette's colours, Darmanitan
			// Standard) is the base form, as the row of a scan of it has it
			const tf = Object.hasOwn(gm.species[tid].f, named) ? named : '';
			const k = `${tid}/${tf}`;
			if (seen.has(k)) return;
			seen.add(k);
			const candy = at('evoCandy', i);
			const item = at('evoItem', i), gender = at('evoGender', i), cond = at('evoCond', i);
			const next = {
				candy: way.candy == null || candy == null ? null : way.candy + candy,
				items: item ? [...way.items, item] : way.items,
				gender: gender || way.gender,
				cond: cond ? [...way.cond, ...cond] : way.cond,
				chance: way.chance || (chance && free[i]),
				steps: way.steps + 1,
			};
			out.push({ id: tid, form: tf, ...next });
			queue.push({ id: tid, form: tf, way: next });
		});
	}
	return out;
}

/**
 * Height and weight after evolving into `to` (a row), from height h and weight w of a Pokémon
 * of `from`; null where the rule doesn't apply to either.
 */
export function evolvedSize(from, to, h, w) {
	const b = band(from), b2 = band(to);
	if (!b || !b2) return null;
	const x = h / from[ROW.H];
	const p = (x - b.a) / (b.K - b.a);	// place in the XXL band, 0 at its floor, 1 at its top
	const x2 = b2.a + p * (b2.K - b2.a);
	const m = (w / from[ROW.W]) / x;	// heavy for its height
	return { h: x2 * to[ROW.H], w: m * x2 * to[ROW.W] };
}

/**
 * The score after evolving, for an evaluated row (evaluate()'s result): each target with its
 * predicted score, ± and gain, best first; null where no prediction is given (no info beats
 * wrong info): not an XXL row with a score, a mega evolved one, a species or target the rule
 * wasn't measured on, or nothing to evolve into.
 *
 * gain is the change of the computed score (height and weight parts; the IV part and the XXL
 * bonus stay), so it holds with the IVs unknown too. ± is the row's own uncertainty carried
 * over: its height and weight ± 0.005 (the game shows two decimals) put through the rule;
 * where the IVs aren't known their spread is added. A scan after evolving has its own
 * rounding on top (evolvedFrom). kind: 'gain' when the best target's gain is beyond that ±, 'loss'
 * when every target loses beyond it, else 'same'.
 */
export function predictEvolve(e, ctx) {
	if (!e || !e.score || e.mega || e.xxl !== true || !e.id || e.height_m == null || e.weight_kg == null) return null;
	const { gm, text } = ctx;
	const from = rowOf(gm, e.id, e.form ?? '');
	if (!band(from)) return null;
	const ivSpread = e.score.hi != null ? (e.score.hi - e.score.lo) / 2 : 0;
	const now = score(from, gm.coef, e.height_m, e.weight_kg, 0, true);
	const targets = [];
	for (const t of evolveTargets(gm, e.id, e.form ?? '')) {
		const to = rowOf(gm, t.id, t.form);
		const size = evolvedSize(from, to, e.height_m, e.weight_kg);
		if (!size) continue;
		const then = score(to, gm.coef, size.h, size.w, 0, true);
		const gain = then.total - now.total;
		// the row's height and weight are shown to 0.01: carried through the rule, that is
		// the prediction's ±
		let carried = 0;
		for (const dh of [-0.005, 0.005]) {
			for (const dw of [-0.005, 0.005]) {
				const s2 = evolvedSize(from, to, e.height_m + dh, e.weight_kg + dw);
				if (s2) carried = Math.max(carried, Math.abs(score(to, gm.coef, s2.h, s2.w, 0, true).total - then.total));
			}
		}
		const dex = gm.species[t.id].dex;
		targets.push({
			...t,
			name: (text && text.names && text.names[String(dex)]) || t.id,
			formName: formLabel(t.form),
			height_m: size.h, weight_kg: size.w,
			total: e.score.total + gain,
			band: carried + ivSpread,
			gain,
		});
	}
	if (!targets.length) return null;
	// best first; of equal ones (same K) the easiest: fewer steps, no item, gender or
	// condition, not left to chance, less candy
	const effort = t => t.items.length + (t.gender ? 1 : 0) + t.cond.length + (t.chance ? 1 : 0);
	targets.sort((p, q) => (Math.abs(q.gain - p.gain) > 1e-9 ? q.gain - p.gain : 0) || p.steps - q.steps ||
		effort(p) - effort(q) || (p.candy ?? Infinity) - (q.candy ?? Infinity));
	const best = targets[0];
	const kind = best.gain > best.band ? 'gain' : best.gain < -best.band ? 'loss' : 'same';
	return { targets, best, kind };
}

const cache = new WeakMap();	// evaluated row → its prediction; a game data update makes new rows
/** predictEvolve, once per evaluated row (rows are cached by their reading and edits). */
export function evolveOf(e, ctx) {
	if (!e || typeof e !== 'object') return null;
	if (!cache.has(e)) {
		if (!ctx) return null;	// not predicted yet, and nothing to predict it with
		cache.set(e, predictEvolve(e, ctx));
	}
	return cache.get(e);
}

const into = new WeakMap();	// game data → the species some other species evolves into
function evolvedInto(gm) {
	if (!into.has(gm)) {
		const set = new Set();
		for (const sp of Object.values(gm.species)) {
			for (const list of Object.values(sp.evo || {})) for (const t of list) set.add(split(t)[0]);
		}
		into.set(gm, set);
	}
	return into.get(gm);
}

/**
 * For an XXL row with nothing to evolve into: 'final' when it is the last stage of a family,
 * 'single' when no species evolves into it either (mega evolutions aside); null otherwise, so
 * a row with targets the rule can't predict says nothing.
 */
export function evolveEnd(e, ctx) {
	if (!e || !ctx || !ctx.gm || !e.score || e.mega || e.xxl !== true || !e.id) return null;
	if (!Object.hasOwn(ctx.gm.species, e.id) || evolveTargets(ctx.gm, e.id, e.form ?? '').length) return null;
	return evolvedInto(ctx.gm).has(e.id) ? 'final' : 'single';
}

/** evolveEnd's words: "fully evolved already", "doesn't evolve". */
export const endText = k => (k === 'final' ? 'fully evolved already' : k === 'single' ? 'doesn\'t evolve' : null);

/** The key the "Evolve gain" sort and the gain column use: the best gain, 0 when about the same. */
export const gainKey = p => (!p ? null : p.kind === 'same' ? 0 : p.best.gain);

/** IVs known for sure: from the bars or typed in, not one of several sets CP and HP allow. */
const sureIvs = e => !!(e.ivs && (e.ivSource === 'bars+cp' || e.ivSource === 'bars' || e.ivSource === 'edit') && !(e.score && e.score.hi != null));

/**
 * Whether evaluated row `next` is evaluated row `old` evolved: the same catch date and IVs
 * (both known for sure), a species `old` can evolve into, and a score inside the prediction's ±
 * (with next's own display rounding added). Returns the target matched, or null.
 */
export function evolvedFrom(old, next, ctx) {
	if (!old || !next || old === next || !next.score || next.xxl !== true || !next.caught || old.caught !== next.caught) return null;
	if (!sureIvs(old) || !sureIvs(next)) return null;
	if (old.ivs.a !== next.ivs.a || old.ivs.d !== next.ivs.d || old.ivs.s !== next.ivs.s) return null;
	const p = predictEvolve(old, ctx);
	const t = p && p.targets.find(x => x.id === next.id && (x.form || '') === (next.form || ''));
	if (!t) return null;
	return Math.abs(next.score.total - t.total) <= t.band + next.score.band ? t : null;
}

/**
 * Which rows are the old, unevolved scan of another row in the list: [{old, next, target}],
 * keeping only pairs where `touched` (a Set of row ids) has one of the two, so a new scan
 * replaces an old row and nothing else changes (an old row of a chain whose last stage was
 * just scanned goes too). items: [{row, e}]. A row that two others fit
 * as their unevolved scan, or that fits two unevolved rows, is left alone: no guess.
 */
export function evolvedPairs(items, touched, ctx) {
	const cand = items.filter(x => x.e && x.e.score && x.e.caught && sureIvs(x.e));
	const byCaught = new Map();
	for (const x of cand) {
		if (!byCaught.has(x.e.caught)) byCaught.set(x.e.caught, []);
		byCaught.get(x.e.caught).push(x);
	}
	const pairs = [];
	for (const group of byCaught.values()) {
		if (group.length < 2) continue;
		for (const o of group) {
			for (const n of group) {
				if (o === n) continue;
				const target = evolvedFrom(o.e, n.e, ctx);
				if (target) pairs.push({ old: o.row, next: n.row, target, oldE: o.e, nextE: n.e });
			}
		}
	}
	// One Pokémon scanned at every stage (Gothita, Gothorita, Gothitelle) gives three pairs
	// that agree. Two candidates that aren't one chain (twins caught the same day with the
	// same IVs) are a guess: those rows stay.
	const related = (x, y) => x === y || pairs.some(p => (p.old === x && p.next === y) || (p.old === y && p.next === x));
	const chain = rows => rows.every(x => rows.every(y => related(x, y)));
	const nexts = id => pairs.filter(p => p.old.id === id).map(p => p.next);
	const olds = id => pairs.filter(p => p.next.id === id).map(p => p.old);
	return pairs.filter(p => (touched.has(p.old.id) || touched.has(p.next.id)) && chain(nexts(p.old.id)) && chain(olds(p.next.id)));
}

/**
 * evolvedPairs as replacements: [{old, next, target}], one per old row, next being the row that
 * stays (the last stage scanned) and old the earliest stage first, so a note can name it.
 */
export function replacements(pairs) {
	const gone = new Set(pairs.map(p => p.old.id));
	const out = [];
	for (const id of gone) {
		const own = pairs.filter(p => p.old.id === id);
		const stays = own.find(p => !gone.has(p.next.id)) || own[0];
		out.push({ ...stays, steps: stays.target.steps });
	}
	return out.sort((p, q) => q.steps - p.steps);
}

/** Items, conditions and genders in plain words, for the row and the editor. */
const ITEMS = {
	SUN_STONE: 'Sun Stone', KINGS_ROCK: 'King\'s Rock', METAL_COAT: 'Metal Coat', DRAGON_SCALE: 'Dragon Scale',
	UP_GRADE: 'Up-Grade', GEN4_EVOLUTION_STONE: 'Sinnoh Stone', GEN5_EVOLUTION_STONE: 'Unova Stone',
	TROY_DISK_MAGNETIC: 'Magnetic Lure', TROY_DISK_MOSSY: 'Mossy Lure', TROY_DISK_GLACIAL: 'Glacial Lure',
	TROY_DISK_RAINY: 'Rainy Lure',
};
export const itemText = it => ITEMS[it] || 'an item';

/** One condition code (gm.js's evoCond) in words. */
export function condText(c) {
	const [k, v] = String(c).split(':');
	return {
		BUDDY: 'as buddy', KM: `walk ${v} km`, DAY: 'by day', NIGHT: 'at night', DUSK: 'at dusk',
		FULL_MOON: 'full moon', UPSIDE_DOWN: 'upside down', MOVE: 'a move', QUEST: 'a task',
	}[k] || 'a condition';
}

/** What evolving into a target takes, as short words: ["400 candy", "Sinnoh Stone", "male only"]. */
export function wayText(t) {
	const out = [];
	if (t.candy) out.push(`${t.candy} candy`);
	for (const it of t.items) out.push(itemText(it));
	if (t.gender) out.push(t.gender === 'MALE' ? 'male only' : 'female only');
	for (const c of [...new Set(t.cond.map(condText))]) out.push(c);
	if (t.chance) out.push('by chance');
	return out;
}

/** A target's name with its form ("Persian Alola"). */
export const targetName = t => `${t.name}${t.formName ? ' ' + t.formName : ''}`;

/** The row's line: "+42 as Bewear · 400 candy", "−84 if evolved", "about the same if evolved". */
export function gainText(p) {
	if (!p) return null;
	if (p.kind === 'same') return 'about the same if evolved';
	const g = Math.round(p.best.gain);
	if (p.kind === 'loss') return `−${-g} if evolved`;
	const way = wayText(p.best);
	return [`+${g} as ${targetName(p.best)}`, ...way.slice(0, 2)].join(' · ');
}
