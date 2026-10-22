// Readings + game data → one table row: species, form, IVs, XXL, score, issues.
import { ROW, formsOf, dexIndex } from './gm.js';
import { nameIndex, findDex, findDexByName, levenshtein, normalizeName } from './text.js';
import { dateRelation, pillAsCaught } from './read.js';
import { solveIVs, rankByBars, roundBars, levelsForHp } from './ivs.js';
import { score, isXXLByHeight, isXXSByHeight } from './score.js';

/** Lookup tables built once per game data / language. */
export function makeContext(gm, text) {
	return { gm, text, names: nameIndex(text), dex: dexIndex(gm) };
}

export const formLabel = f =>
	!f || f === 'NORMAL' ? '' : f.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * Same Pokémon = same species/form + catch date + height + weight, and the same IVs where the
 * bars give them. IVs survive powering up; without them two Tynamos caught the same
 * day, both 0.35 m and 0.48 kg, looked like one.
 */
export function duplicateKey(r) {
	if (!r.id || r.height_m == null || r.weight_kg == null) return null;
	// the catch date as the "was caught" line shows it; evaluate() fills it from the year pill
	// when only that was read (pillAsCaught gives the same text)
	const tail = r.caught ? `d:${r.caught}` : `cp:${r.cp ?? ''}`;
	const key = [r.id, r.form ?? '', tail, r.height_m.toFixed(2), r.weight_kg.toFixed(2)];
	if (r.ivs && r.ivSource && r.ivSource !== 'cp') key.push(`iv:${r.ivs.a}/${r.ivs.d}/${r.ivs.s}`);
	return key.join('|');
}

/**
 * evaluate() for a stored row. Rows come from this device, from backups and from older
 * versions of the page, so one may hold something evaluate() can't handle; it then gets a row
 * marked to check, to correct in the editor or delete, instead of breaking the whole list.
 */
export function evaluateSafely(reading, ctx, edits = {}) {
	try {
		return evaluate(reading, ctx, edits);
	} catch (err) {
		const res = evaluate({}, ctx);
		res.name = typeof reading?.species === 'string' ? reading.species : '';
		res.issues.splice(0, res.issues.length,
			{ code: 'broken', msg: `This row can't be scored (${err.message}). Correct it here or delete it.` });
		return res;
	}
}

/**
 * @param {object} reading  {species, caught, hp, cp, height_m, weight_kg, bars}
 * @param {ReturnType<typeof makeContext>} ctx
 * @param {object} [edits]  user overrides: {id, form, hp, cp, height_m, weight_kg, ivs, xxl, inGame}
 */
export function evaluate(reading, ctx, edits = {}) {
	const { gm, text } = ctx;
	const v = { ...reading };
	for (const k of ['hp', 'cp', 'height_m', 'weight_kg', 'caught']) if (edits[k] != null && edits[k] !== '') v[k] = edits[k];
	if (!v.caught && reading.caughtPill) v.caught = pillAsCaught(reading.caughtPill);
	const issues = [];
	const res = {
		id: null, dex: null, name: reading.species || '', form: null, formName: '', types: '',
		caught: v.caught ?? null, hp: v.hp ?? null, cp: v.cp ?? null, height_m: v.height_m ?? null, weight_kg: v.weight_kg ?? null,
		bars: reading.bars ?? null, ivs: null, ivSource: null, level: null, candidates: [], forms: [],
		cpExpected: null, xxl: null, xxs: null, lucky: reading.lucky ?? null, score: null, inGame: edits.inGame ?? null, inGameDiff: null, issues, key: null,
	};

	if (reading.merged > 1) issues.push({ code: 'merged', info: true, msg: `Merged from ${reading.merged} screenshots` });

	// Species: from the "was caught" line, else from the name line when that is a species name
	// (a Pokémon without a nickname; on a 16:9 screen the screenshot without the appraisal has
	// no "was caught" line)
	let id = edits.id || null;
	if (!id) {
		const dex = speciesDex(reading, ctx);
		if (dex != null) id = (ctx.dex.get(dex) || [])[0] || null;
	}
	if (!id || !Object.hasOwn(gm.species, id)) {
		issues.push({ code: 'species', msg: reading.species ? `Species "${reading.species}" not recognised` : 'Species not read' });
		return res;
	}
	res.id = id;
	res.dex = gm.species[id].dex;
	res.name = text.names[String(res.dex)] || id;

	// Form: the one whose CP/HP solve best matches the bars. Per form, sizes the
	// game can't produce are repaired first (a covered leading digit), and a misread CP is
	// replaced when the bars and HP allow exactly one CP that looks like it.
	let forms = formsOf(gm, id);
	res.forms = forms.map(f => f.form);
	if (edits.form != null && forms.some(f => f.form === edits.form)) forms = forms.filter(f => f.form === edits.form);
	const cp = v.cp, hp = v.hp, bars = reading.bars;
	const tried = forms.map(f => {
		const size = fixSizes(v.height_m, v.weight_kg, f.row);
		let cpUse = cp, hits = cp && hp ? rankByBars(solveIVs(f.row, cp, hp, gm.cpm), bars) : [];
		// The bars and HP fix the possible CPs. A read CP that isn't one of them (even one that
		// fits other IVs, 1990 for 1900) is replaced by the one that looks like it. Every CP
		// read for this Pokémon counts (merged screenshots keep theirs in cpAlt). If none looks
		// like any possible CP but the bars and HP allow only one, that one is taken, but marked
		// (cpForced): it ranks this form below one the read CP fits, and asks for a check.
		let cpForced = false;
		if (hp && bars) {
			const lv = levelsForHp(f.row, roundBars(bars), hp, gm.cpm);
			if (!(cp && lv.some(l => l.cp === cp))) {
				const reads = [cp, ...(edits.cp == null ? reading.cpAlt || [] : [])].filter(c => c != null);
				const all = [...new Set(lv.map(l => l.cp))];
				let cps = reads.length ? all.filter(c => reads.some(r => cpLooksLike(r, c))) : all;
				let forced = false;
				if (!cps.length && all.length === 1) { cps = all; forced = reads.length > 0; }
				if (cps.length === 1) {
					const better = rankByBars(solveIVs(f.row, cps[0], hp, gm.cpm), bars);
					if (better.length && (!hits.length || better[0].dist < hits[0].dist)) { cpUse = cps[0]; hits = better; cpForced = forced; }
				}
			}
		}
		const plausible = size.h == null || size.h.value != null;
		// labels read: all of the form's types 2, some of them 1 (one label hidden), others -1
		const ft = f.row[ROW.TYPES].split('/');
		const typesMatch = !reading.types || !reading.types.length ? 0
			: sameSet(reading.types, ft) ? 2 : reading.types.every(t => ft.includes(t)) ? 1 : -1;
		return { ...f, size, cpUse, cpForced, hits, plausible, typesMatch, best: hits.length ? hits[0].dist : Infinity };
	});
	// the type icons' labels (ROCK / GROUND) tell Alolan and other forms apart
	const withHits = tried.filter(t => t.hits.length && t.plausible)
		.sort((a, b) => b.typesMatch - a.typesMatch || a.cpForced - b.cpForced || a.best - b.best);
	let pick = withHits[0] || tried.find(t => t.plausible) || tried[0];
	if (withHits.length > 1 && withHits[1].typesMatch === withHits[0].typesMatch && withHits[1].cpForced === withHits[0].cpForced &&
		withHits[1].best - withHits[0].best < 1 && edits.form == null) {
		issues.push({ code: 'form', msg: `Form unclear: ${withHits.map(t => formLabel(t.form) || 'normal').join(' / ')}` });
	}
	res.form = pick.form;
	res.formName = formLabel(pick.form);
	res.types = pick.row[ROW.TYPES];
	const row = pick.row;

	// Sizes and CP as used, with a word about anything that was repaired
	const h = pick.size.h ? pick.size.h.value : null;
	const w = pick.size.w ? pick.size.w.value : null;
	res.height_m = h;
	res.weight_kg = w;
	for (const [k, label, unit] of [['h', 'Height', 'm'], ['w', 'Weight', 'kg']]) {
		const fx = pick.size[k];
		if (!fx || !fx.fixed) continue;
		issues.push(fx.value == null
			? { code: 'size', msg: `${label} read as ${fx.read} ${unit}, impossible for ${res.name}: please type it in` }
			: { code: 'size-guess', msg: `${label} read as ${fx.read} ${unit}, impossible for ${res.name}; taken as ${fx.value} ${unit} (a digit hidden?). Save to confirm.` });
	}
	if (pick.cpUse !== cp && edits.cp == null) {
		res.cp = pick.cpUse;
		const reads = [cp, ...(reading.cpAlt || [])].filter(c => c != null).join(' / ');
		issues.push(pick.cpForced
			? { code: 'cp', msg: `CP read as ${reads}, nothing like what the bars and HP allow; taken as ${pick.cpUse}. Save to confirm.` }
			: { code: 'cp-fixed', info: true, msg: cp == null ? `CP not read; ${pick.cpUse} from the bars and HP` : `CP read as ${reads}, taken as ${pick.cpUse} (the only CP that fits the bars and HP)` });
	}
	const cpNow = res.cp;

	// IVs
	if (edits.ivs) {
		res.ivs = edits.ivs; res.ivSource = 'edit';
		if (hp) res.level = levelsForHp(row, edits.ivs, hp, gm.cpm).find(l => !cpNow || l.cp === cpNow)?.level ?? null;
	} else if (pick.hits.length) {
		const best = pick.hits[0];
		res.ivs = { a: best.a, d: best.d, s: best.s }; res.level = best.level; res.ivSource = bars ? 'bars+cp' : 'cp';
		res.candidates = pick.hits.slice(0, 12);
		if (!bars) {
			if (pick.hits.length > 1) issues.push({ code: 'ivs', msg: `No bars read: ${pick.hits.length} IV combinations fit CP/HP, pick one` });
		} else if (best.dist > 1.5) {
			issues.push({ code: 'bars', msg: 'Bars and CP/HP disagree; check CP, HP and the IVs' });
		}
	} else if (bars) {
		res.ivs = roundBars(bars); res.ivSource = 'bars';
		if (hp) {
			const lv = levelsForHp(row, res.ivs, hp, gm.cpm);
			res.level = lv[0]?.level ?? null;
			if (cpNow && lv.length && !lv.some(l => l.cp === cpNow)) {
				res.cpExpected = lv.map(l => l.cp);
				issues.push({ code: 'cp', msg: `CP ${cpNow} doesn't fit; expected ${res.cpExpected.join(' or ')}` });
			}
		}
	} else {
		issues.push({ code: 'ivs', msg: 'IVs unknown: no appraisal bars and no CP/HP match' });
	}

	// XXL
	// From the height, unless that is within display rounding of the boundary (small species:
	// 0.15 m for a Gimmighoul can be either); then the badge above the height decides.
	const byHeight = h != null ? isXXLByHeight(row, h) : null;
	const byBadge = reading.badge ? reading.badge === 'XXL' : null;
	res.xxl = edits.xxl ?? byHeight ?? byBadge;
	if (edits.xxl == null && byHeight != null && byBadge != null && byHeight !== byBadge) {
		issues.push({ code: 'xxl', msg: `The badge says ${reading.badge}, the height says ${byHeight ? '' : 'not '}XXL: check the height` });
	} else if (res.xxl === null && h != null) issues.push({ code: 'xxl', msg: 'Right at the XXL boundary: is it XXL?' });
	// XXS likewise (XXS mode); it doesn't change the score, so no question is asked
	const xxsByHeight = h != null ? isXXSByHeight(row, h) : null;
	res.xxs = xxsByHeight ?? (reading.badge ? reading.badge === 'XXS' : null);
	if ((h == null || w == null) && !issues.some(i => i.code === 'size')) {
		issues.push({ code: 'size', msg: reading.covered && h == null && w == null
			? 'Height and weight are under the appraisal on this screen: add a screenshot without it'
			: 'Height or weight missing' });
	}

	// Score
	if (res.ivs && h != null && w != null && res.xxl !== null) {
		res.score = score(row, gm.coef, h, w, res.ivs.a + res.ivs.d + res.ivs.s, res.xxl);
		if (res.inGame != null) {
			res.inGameDiff = res.inGame - res.score.total;
			// the game shows a whole number
			if (Math.abs(res.inGameDiff) > res.score.band + 0.5) {
				issues.push({ code: 'ingame', msg: `In-game score off by ${res.inGameDiff.toFixed(1)}: please report` });
			}
		}
	}
	res.key = duplicateKey(res);
	return res;
}

/** Pokédex number of a reading: the "was caught" line's species, else a name line that is one. */
export function speciesDex(r, ctx) {
	if (!ctx) return null;
	const d = r.species ? findDex(r.species, ctx.names) : null;
	return d ?? (r.name ? findDexByName(r.name, ctx.names) : null);
}

/** A read CP that may have lost or gained a digit: 21 for 521, 2174 for 217. */
function cpLooksLike(read, cand) {
	const a = String(read), b = String(cand);
	return a === b || b.includes(a) || a.includes(b) || levenshtein(a, b) <= 1;
}

/**
 * Height and weight the game can actually show for this species/form. A value outside the
 * possible range most likely lost leading characters to something drawn over it (the trainer,
 * the sprite): "62" for 1.62 m, "6" for 0.96 m; or the point got lost: "211" for 2.11 m.
 * Candidates put them back; among those in range, the one whose size ratio is closest to the other value's ratio wins (in the game they go together).
 * @returns {{h: Fix|null, w: Fix|null}}  Fix = {value: number|null, read: number, fixed: boolean}
 */
export function fixSizes(height, weight, row) {
	const h0 = row[ROW.H], w0 = row[ROW.W];
	const hLo = h0 * 0.2, hHi = row[ROW.XXL_MAX];
	// the weight ceiling is loose: an XXL Ursaluna weighed 682.37 kg, 15 % over K + 4σ/w̄. It
	// only has to catch a lost decimal point (×10 or more)
	// The floor: an XXS Alolan Marowak weighed 0.67 kg, 2 % of its 34 kg average (and 4 % of
	// its height ratio), so for small ones (height under 0.75 h̄, XS or XXS) it is 1 %
	const small = height != null && height / h0 < 0.75;
	const wLo = w0 * (small ? 0.01 : 0.05), wHi = (row[ROW.XXL_MAX] / h0 + 4 * row[ROW.WSD] / w0) * w0 * 1.5;
	const hOk = x => x >= hLo - 0.005 && x <= hHi + 0.005;
	const wOk = x => x >= wLo - 0.005 && x <= wHi;
	const hRead = height == null ? null : { value: height, read: height, fixed: false };
	const wRead = weight == null ? null : { value: weight, read: weight, fixed: false };
	const hGood = hRead && hOk(height), wGood = wRead && wOk(weight);
	const pickBy = (cands, ok, ratio, other) => {
		const fit = cands.filter(ok);
		if (fit.length <= 1 || other == null) return fit.length === 1 ? fit[0] : null;
		return fit.reduce((a, b) => (Math.abs(Math.log(ratio(a) / other)) <= Math.abs(Math.log(ratio(b) / other)) ? a : b));
	};
	const out = { h: hRead, w: wRead };
	if (hRead && !hGood) {
		const other = wGood ? weight / w0 : null;
		out.h = { value: pickBy(restoreDigits(height, hLo, hHi), hOk, x => x / h0, other), read: height, fixed: true };
	}
	if (wRead && !wGood) {
		const hv = out.h && out.h.value;
		const other = hv != null ? hv / h0 : null;
		out.w = { value: pickBy(restoreDigits(weight, wLo, wHi), wOk, x => x / w0, other), read: weight, fixed: true };
	}
	return out;
}

/** How the game displays a size: two decimals at most, no trailing zeros (2.3 m, 109.32 kg). */
const shown = v => v.toFixed(2).replace(/\.?0+$/, '');

/**
 * Values in [lo, hi] that the game could have displayed with the read text at its end, i.e. the
 * value before leading characters were hidden: "6" → 0.6, 0.96, 1.06, 1.6, …; "62" → 0.62, 1.62;
 * and, for a reading without a point, the ones that lost it: "211" → 2.11. In ascending order.
 *
 * Built from the read text instead of trying every hundredth in the range: for a species of a
 * tonne that was a third of a million tries per form, and a backup full of such rows froze the
 * page on every visit. tests/restore-digits.test.js holds the old loop and checks that both give
 * the same values.
 */
export function restoreDigits(x, lo, hi) {
	const s = shown(x);
	const cLo = Math.max(1, Math.ceil(lo * 100)), cHi = Math.floor(hi * 100);	// in hundredths
	if (!(cLo <= cHi) || !Number.isFinite(cHi)) return [];
	const found = new Set();
	const take = c => { if (c >= cLo && c <= cHi && shownOf(c) !== s) found.add(c); };
	// A shown value is its whole part, then "." and the hundredths without trailing zeros, if
	// any. Per hundredths part: the read text has to end with it, and the whole part with the
	// rest of the read text, or the whole read text lies within the hundredths part.
	for (let f = 0; f < 100; f++) {
		const tail = f ? `.${String(f).padStart(2, '0').replace(/0$/, '')}` : '';
		let head;	// what the whole part has to end with; '' = any whole part
		if (tail.endsWith(s)) head = '';
		else if (s.endsWith(tail) && /^\d+$/.test(s.slice(0, s.length - tail.length))) head = s.slice(0, s.length - tail.length);
		else continue;
		const step = head ? 10 ** head.length : 1;
		const first = head ? Number(head) : 0;
		for (let w = Math.max(first, first + step * Math.ceil((Math.floor(cLo / 100) - first) / step)); w * 100 + f <= cHi; w += step) {
			if (String(w).endsWith(head)) take(w * 100 + f);
		}
	}
	// no point read: it may be the point that got lost, one or two digits from the end
	if (/^\d+$/.test(s)) {
		for (const k of [1, 2]) {
			if (s.length <= k) continue;
			const c = Number(s.slice(0, -k)) * 100 + Number(s.slice(-k).padEnd(2, '0'));
			if (shownOf(c).replace('.', '') === s) take(c);
		}
	}
	return [...found].sort((a, b) => a - b).map(c => c / 100);
}

/** shown() of a value given in hundredths. */
const shownOf = c => shown(c / 100);

// ---------- several screenshots of one Pokémon ----------

const infoCaches = new WeakMap();	// ctx → (reading → info); a game data update makes a new ctx
const noCtx = {};

/**
 * What a reading means once checked against the game data, cached per reading object (merging
 * makes a new object, so the cache never goes stale): the species' forms, and the CPs the
 * screenshot allows. With bars and HP those are the CPs the bars' IVs give at that HP: the read
 * CP if it is one of them, else the ones that look like it, else all of them (the read CP is
 * garbage, "4790" for 1900). `sure` = the CP is backed by the bars.
 */
function infoOf(r, ctx) {
	const key = ctx || noCtx;
	let infoCache = infoCaches.get(key);
	if (!infoCache) infoCaches.set(key, (infoCache = new WeakMap()));
	let v = infoCache.get(r);
	if (v) return v;
	const dex = speciesDex(r, ctx);
	// the name line resolved on its own: the same text on every screenshot of one Pokémon
	const nameDex = ctx && r.name ? findDexByName(r.name, ctx.names) : null;
	const id = dex != null ? (ctx.dex.get(dex) || [])[0] : null;
	const rows = id ? formsOf(ctx.gm, id).map(f => f.row) : [];
	const ivs = r.bars ? roundBars(r.bars) : null;
	// every CP read (pipeline.js reads it three ways)
	let cps = [...new Set([r.cp, ...(r.cpAlt || [])].filter(c => c != null))];
	let sure = false;
	if (rows.length && ivs && r.hp) {
		const lv = [...new Set(rows.flatMap(row => levelsForHp(row, ivs, r.hp, ctx.gm.cpm).map(l => l.cp)))];
		if (lv.length) {
			sure = true;
			const exact = cps.filter(c => lv.includes(c));
			const like = lv.filter(c => cps.some(x => cpLooksLike(x, c)));
			cps = exact.length ? exact : like.length ? like : lv;
		}
	}
	v = { dex, nameDex, rows, ivs, cps, sure };
	infoCache.set(r, v);
	return v;
}

/**
 * Two readings of a size: 'eq', 'part' (one could be the other with characters hidden or the
 * point lost: "92" / 0.92, "251" / 2.51, "2.7" / 2.78), 'near' (a digit misread, within 5 %),
 * 'diff', or null if one is missing.
 */
function sizeRelation(x, y) {
	if (x == null || y == null) return null;
	if (x === y) return 'eq';
	const a = shown(x), b = shown(y);
	if (a.endsWith(b) || b.endsWith(a) || a.startsWith(b) || b.startsWith(a) || a.replace('.', '') === b.replace('.', '')) return 'part';
	return Math.abs(Math.log(x / y)) <= 0.05 ? 'near' : 'diff';
}

/** Evidence a size gives: more significant digits, rarer coincidence ("0.82" < "259.67"). */
const sizeWeight = x => Math.min(6, 1.2 * shown(x).replace(/^[0.]+/, '').replace('.', '').length);

/** Whether type labels read from one screenshot can belong to the other one (labels or species). */
function typesFit(a, A, b, B) {
	const ta = a.types || [], tb = b.types || [];
	if (ta.length && tb.length) {
		const [s, l] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
		if (!s.every(t => l.includes(t))) return false;	// one label may be hidden, not changed
	}
	const fits = (t, rows) => !t.length || !rows.length || rows.some(row => t.every(x => row[ROW.TYPES].split('/').includes(x)));
	return fits(ta, B.rows) && fits(tb, A.rows);
}

/** Could `other` (no species read) be a screenshot of `named`'s species? */
function fitsSpecies(named, other, ctx) {
	const N = infoOf(named, ctx), O = infoOf(other, ctx);
	if (N.dex == null || O.dex != null) return false;
	if (other.height_m == null && other.weight_kg == null) return false;
	const cps = O.cps;
	return N.rows.some(row => {
		const fx = fixSizes(other.height_m, other.weight_kg, row);
		// a size with a hidden digit counts if some repair of it is possible (211 → 2.11 m)
		const sizesOk = (!fx.h || fx.h.value != null) && (!fx.w || fx.w.value != null);
		const typesOk = !(other.types || []).length || other.types.every(t => row[ROW.TYPES].split('/').includes(t));
		return sizesOk && typesOk && other.hp != null && cps.some(c => solveIVs(row, c, other.hp, ctx.gm.cpm).length > 0);
	});
}

/** Stronger: `other`'s CP and HP come out of exactly `named`'s bar IVs, at some level. */
function fitsBars(named, other, ctx) {
	const N = infoOf(named, ctx), O = infoOf(other, ctx);
	if (!N.ivs || other.hp == null || !O.cps.length) return false;
	return N.rows.some(row => levelsForHp(row, N.ivs, other.hp, ctx.gm.cpm).some(l => O.cps.includes(l.cp)));
}

/**
 * How strongly two readings look like screenshots of the same Pokémon: null when they
 * can't be (something contradicts, or one was taken mid-swipe), else a score that ranks the
 * candidates in mergeTarget.
 *
 * Contradictions, where both have the value: HP, catch date, species; weight or height that
 * differ beyond a misread or hidden characters (sizeRelation); type labels that don't fit the
 * other's labels or species; and CPs that are clearly different (not one digit off) when both
 * are possible: backed by bars, or solvable for the species at that HP.
 * Then at least one of (unchanged from the first version):
 *   HP and weight agree                  (weight to 0.01 kg + HP: a fingerprint; the CP may be
 *                                         garbled or missing, it is the most misread value)
 *   weight agrees, CP equal or similar   (e.g. 1339 vs 1335)
 *   HP and CP agree, plus species or catch date, or the screenshot without a name fits the
 *   other one's species (possible size, CP/HP solvable)
 *   HP agrees and the CPs look alike (1900 vs 1940) or one is missing, where exactly one
 *   screenshot has the bars, so its CP is the one bars and HP allow: plus catch date or
 *   species, or the other fits that species at that CP.
 */
export function matchScore(a, b, ctx) {
	if (a.slid || b.slid) return null;
	const A = infoOf(a, ctx), B = infoOf(b, ctx);
	if (a.hp != null && b.hp != null && a.hp !== b.hp) return null;
	if (a.lucky != null && b.lucky != null && a.lucky !== b.lucky) return null;
	// catch dates, from the "was caught" line or the year pill, in any combination
	const dRel = dateRel(a, b);
	if (dRel === 'diff') return null;
	if (a.species && b.species && (ctx ? A.dex == null || A.dex !== B.dex : a.species !== b.species)) return null;
	// species from either source (the name line counts when it is a species name), and the name
	// line itself: it shows the same text on every screenshot of one Pokémon
	if (A.dex != null && B.dex != null && A.dex !== B.dex) return null;
	if (A.nameDex != null && B.nameDex != null && A.nameDex !== B.nameDex) return null;
	const wRel = sizeRelation(a.weight_kg, b.weight_kg), hRel = sizeRelation(a.height_m, b.height_m);
	// weights are read reliably (the stats-row crop); only hidden characters may excuse a
	// difference. Heights are more often half covered by the trainer: a near miss is let off.
	if (wRel === 'diff' || wRel === 'near') return null;
	const rows = A.rows.length ? A.rows : B.rows;
	const possibleH = h => !rows.length || rows.some(row => fixSizes(h, null, row).h.fixed === false);
	if (hRel === 'diff' && possibleH(a.height_m) && possibleH(b.height_m)) return null;
	if (!typesFit(a, A, b, B)) return null;
	let cpRel = null;
	if (A.cps.length && B.cps.length) {
		cpRel = A.cps.some(x => B.cps.includes(x)) ? 'eq' : A.cps.some(x => B.cps.some(y => cpLooksLike(x, y))) ? 'like' : 'diff';
	}
	if (cpRel === 'diff') {
		// with a species, a CP it can't have (at that HP) is garbage and proves nothing; without
		// one, two clearly different CPs are two Pokémon (two Applins with the same HP and
		// weight, CP 284 and 330)
		const possible = (r, I) => I.sure || (r.hp != null && I.cps.some(c => rows.some(row => solveIVs(row, c, r.hp, ctx.gm.cpm).length)));
		if (!rows.length || (possible(a, A) && possible(b, B))) return null;
	}
	const hp = a.hp != null && b.hp != null, w = wRel === 'eq';
	const species = A.dex != null && A.dex === B.dex, caught = dRel === 'eq';
	const nRel = nameRelation(a.name, b.name);
	const fitAB = () => (ctx ? fitsSpecies(a, b, ctx) || fitsSpecies(b, a, ctx) : false);
	const cpSame = cpRel === 'eq' || cpRel === 'like';
	let ok = false;
	if (hp && w) ok = true;
	else if (w && cpSame) ok = true;
	else if (hp && cpRel === 'eq') ok = species || caught || nRel === 'eq' || fitAB();
	// a catch date to the day, plus HP or the same CP: on a 16:9 screen the screenshot with the
	// appraisal has no weight or height and the one without has no "was caught" line, and the
	// trainer may cover the HP's digits. Not a CP one digit off: twins caught the same day in
	// an event (two Gibles, CP 41 and 46) would merge
	else if (caught && (hp || cpRel === 'eq')) ok = true;
	// same species (the name line of a Pokémon without a nickname) and the same CP
	else if (species && cpRel === 'eq') ok = true;
	else if (hp && ctx && cpRel !== 'diff' && A.sure !== B.sure) {
		// one CP misread by a digit, or not read at all: only if the other screenshot's CP is
		// backed by its bars
		const [s, o, S] = A.sure ? [a, b, A] : [b, a, B];
		const reads = [o.cp, ...(o.cpAlt || [])].filter(c => c != null);
		const cs = reads.length ? S.cps.find(c => reads.some(x => cpLooksLike(x, c))) : S.cps[0];
		if (cs != null) ok = caught || species || nRel === 'eq' || fitsSpecies(s, { ...o, cp: cs, cpAlt: [] }, ctx);
	}
	// no HP on one of them (the trainer's hair): the same CP, and the screenshot without a
	// species fits the other's (size, type labels, CP at its HP)
	else if (!hp && cpRel === 'eq' && fitAB()) ok = true;
	if (!ok) return null;
	let score = 0;
	if (hp) score += 2;
	if (w) score += sizeWeight(a.weight_kg);
	if (hRel === 'eq') score += 0.6 * sizeWeight(a.height_m);
	if (cpRel === 'eq') score += 3; else if (cpRel === 'like') score += 1;
	if (species) score += 2;
	if (caught) score += 3;
	if (nRel === 'eq') score += 2; else if (nRel === 'like') score += 1;
	if (ctx && (fitsBars(a, b, ctx) || fitsBars(b, a, ctx))) score += 3;
	if ((a.types || []).length && (b.types || []).length) score += 1;
	// The rules above admit some thin matches: HP plus a CP one digit off, or HP plus a weight
	// of two digits ("0.82"). Alone, that is too little: in a box of hundreds, HP and a near CP
	// recur. Such a screenshot waits for its own row (a pair to merge by hand at worst).
	return score >= MIN_SCORE ? score : null;
}

/** Catch dates of two readings ("was caught" line or year pill): 'eq', 'diff' or null. */
function dateRel(a, b) {
	let rel = null;
	for (const x of [a.caught, a.caughtPill]) {
		for (const y of [b.caught, b.caughtPill]) {
			const r = x && y ? dateRelation(x, y) : null;
			if (r === 'diff') return 'diff';
			if (r === 'eq') rel = 'eq';
		}
	}
	return rel;
}

/**
 * Two readings of the name line: 'eq' (same text), 'like' (one character off, or one inside the
 * other: the appraisal's tint or the trainer changes a nickname's fringe), else null. Nicknames
 * with superscripts and circled digits come out as garbage, but often the same garbage.
 */
export function nameRelation(x, y) {
	const a = normalizeName(x), b = normalizeName(y);
	if (a.length < 3 || b.length < 3) return null;
	if (a === b) return 'eq';
	if ((a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b))) return 'like';
	return Math.min(a.length, b.length) >= 5 && levenshtein(a, b) <= 1 ? 'like' : null;
}

/** Least evidence for a merge (matchScore points; correct merges in the 566-screenshot test score 7+). */
export const MIN_SCORE = 4.5;

/** Whether two readings can be screenshots of the same Pokémon (see matchScore). */
export function canMerge(a, b, ctx) {
	return matchScore(a, b, ctx) != null;
}

/** How far the best candidate must lead the next one to be taken (score points, matchScore). */
export const MERGE_MARGIN = 3;

/**
 * Which of `readings` a new screenshot belongs to: the index of the one it matches best, or -1
 * when none does, or when two match about equally well (then it becomes a row of its own;
 * better two rows to merge by hand than a wrong merge). Several fitting is common when one
 * screenshot misses its weight: two Pokémon with the same HP, and the CP one digit off.
 */
export function mergeTarget(readings, reading, ctx) {
	const fits = [];
	for (let i = 0; i < readings.length; i++) {
		const s = matchScore(readings[i], reading, ctx);
		if (s != null) fits.push([s, i]);
	}
	if (!fits.length) return -1;
	fits.sort((x, y) => y[0] - x[0]);
	if (fits.length > 1 && fits[0][0] - fits[1][0] < MERGE_MARGIN) return -1;
	return fits[0][1];
}

const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));

/**
 * One reading from two: each value from whichever screenshot has it intact. Sizes the game
 * can't produce for the species (a hidden digit, see fixSizes) lose against possible ones.
 */
export function mergeReadings(a, b, ctx) {
	const out = { ...a };
	const take = k => { if (out[k] == null && b[k] != null) out[k] = b[k]; };
	for (const k of ['species', 'caught', 'caughtPill', 'hp', 'cp', 'bars', 'badge', 'lucky']) take(k);
	// the name line: a species name if one of them reads as one, else the longer reading
	if (b.name && (!a.name || (ctx && findDexByName(a.name, ctx.names) == null &&
		(findDexByName(b.name, ctx.names) != null || normalizeName(b.name).length > normalizeName(a.name).length)))) out.name = b.name;
	// the CP from the screenshot with the bars: evaluate() can check it there
	if (!a.bars && b.bars && b.cp != null) out.cp = b.cp;
	// the other CPs read stay as hints for evaluate(): "4790" and "1990" together point to 1900
	const alt = [...new Set([a.cp, b.cp, ...(a.cpAlt || []), ...(b.cpAlt || [])])].filter(c => c != null && c !== out.cp);
	if (alt.length) out.cpAlt = alt; else delete out.cpAlt;
	// type labels: the screenshot that shows both (one may be hidden behind the swipe)
	if ((b.types || []).length > (a.types || []).length) out.types = b.types;
	if (ctx && a.species && b.species && findDex(a.species, ctx.names) == null && findDex(b.species, ctx.names) != null) out.species = b.species;
	const dex = ctx ? speciesDex(out, ctx) : null;
	const id = dex != null ? (ctx.dex.get(dex) || [])[0] : null;
	const row = id ? formsOf(ctx.gm, id)[0]?.row : null;
	const good = (h, w) => (row ? fixSizes(h, w, row) : { h: h == null ? null : { fixed: false }, w: w == null ? null : { fixed: false } });
	const hs = [a.height_m, b.height_m].filter(x => x != null);
	const ws = [a.weight_kg, b.weight_kg].filter(x => x != null);
	// Of the possible values, the one with more characters: something drawn over the stats row
	// hides characters ("2.7" for 2.78 m), recognition hardly ever adds any
	const longest = xs => xs.reduce((m, x) => (m == null || shown(x).length > shown(m).length ? x : m), null);
	out.weight_kg = longest(ws.filter(w => !good(null, w).w.fixed)) ?? ws[0] ?? null;
	out.height_m = longest(hs.filter(h => !good(h, out.weight_kg).h.fixed)) ?? hs[0] ?? null;
	out.merged = (a.merged || 1) + (b.merged || 1);
	if (!(a.covered && b.covered)) delete out.covered;
	delete out.ms;
	return out;
}
