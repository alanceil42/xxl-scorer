// Game master: compact PokeMiners' latest.json into the small shape the page uses.
// tools/build-gm.sh implements the same compaction in jq; tests/gm.test.js keeps them identical.

export const GM_URL = 'https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json';
export const XXL_BONUS = 178;	// not in the game master
export const MIN_SPECIES = 900;	// format change guard
/**
 * Version of the compact shape. 2 added each species' evolution family (fam). Each species'
 * evolutions (evo) came later without a new version: the page doesn't use them, and a copy
 * without them stays as good for it; a reader that needs them checks that they are there.
 */
export const GM_VERSION = 2;

/**
 * species: {POKEMONID: {dex, fam, f: {form: Row}, evo?: {form: [target]}, evoCandy?: {form: [n]},
 * evoGender?: {form: [gender]}, mega?: [id]}}; fam is the evolution
 * family as the game master names it, without "FAMILY_" (Gourgeist: "PUMPKABOO"). A copy from
 * before version 2 lacks it; use familyOf(). evo: what each form evolves into, only forms that
 * evolve; a target is the species, plus "/FORM" when it is a form other than the base
 * (Meowth: {"": ["PERSIAN"], ALOLA: ["PERSIAN/ALOLA"], GALARIAN: ["PERRSERKER"]}). Mega
 * evolutions are not in it; mega: the species' mega and primal evolutions, from any of its
 * forms, without "TEMP_EVOLUTION_" and sorted (Charizard: ["MEGA_X", "MEGA_Y"], Groudon:
 * ["PRIMAL"]). evoCandy: the candy each of evo's evolutions costs, in evo's order (Stufful:
 * {"": [400]}); null where the game asks for an item instead of candy (Gimmighoul's coins); a copy
 * from before evoCandy lacks it. evoGender: the gender each of evo's evolutions needs, in evo's
 * order, "MALE", "FEMALE" or null for either (Kirlia: {"": [null, "MALE"]}: Gardevoir from
 * either, Gallade from males only); only forms with at least one such evolution have it, and a
 * copy from before evoGender lacks it. movesApart: where one form evolves by gender into two forms
 * of one species (Espurr: Meowstic, Meowstic/FEMALE), the forms among them whose moves differ
 * from the first's ("" for the base), sorted (Meowstic: ["FEMALE"]); forms that differ in stats
 * have their own row anyway. None of these is used by the page; they are there for other
 * tools reading gm.json.
 *
 * Row layout, one per species form:
 * [heightM, weightKg, weightStdDevKg, xxlMaxM, baseAtk, baseDef, baseSta, "TYPE/TYPE2", xlMaxM, xsMinM]
 * xlMaxM is the XXL floor, xsMinM the XXS ceiling (xsLowerBound: below it, XXS). A stored copy
 * from before xsMinM existed lacks it; use xsMin(row).
 * @typedef {[number, number, number, number, number, number, number, string, number, number?]} Row
 */
export const ROW = Object.freeze({ H: 0, W: 1, WSD: 2, XXL_MAX: 3, ATK: 4, DEF: 5, STA: 6, TYPES: 7, XL_MAX: 8, XS_MIN: 9 });

/** The XXS ceiling of a row, in m (half the average height for nearly all species). */
export const xsMin = row => row[ROW.XS_MIN] ?? row[ROW.H] * 0.5;

const round8 = x => Math.round(x * 1e8) / 1e8;

/** A form's name without its species ("MEOWTH_ALOLA" → "ALOLA"), "" for none. */
const formName = (pid, f) => (f && f.startsWith(pid) ? f.slice(pid.length) : f || '').replace(/^_/, '');

/** A form's moves, all kinds, sorted and joined: equal strings, equal moves. */
const movesKey = p => [...(p.quickMoves || []), ...(p.cinematicMoves || []), ...(p.eliteQuickMove || []), ...(p.eliteCinematicMove || [])].map(String).sort().join(',');

/** A form's mega and primal evolutions, as mega stores them ("MEGA", "MEGA_X", "PRIMAL"). */
function megas(p) {
	const ids = [...(p.tempEvoOverrides || []).map(o => o && o.tempEvoId), ...(p.evolutionBranch || []).map(b => b.temporaryEvolution)];
	return ids.filter(Boolean).map(x => String(x).replace(/^TEMP_EVOLUTION_/, ''));
}

/**
 * One form's evolutions as evo stores them, in the game master's order, their candy costs as
 * evoCandy does and the gender each needs as evoGender does (a target listed twice: its first
 * entry).
 */
function evolutions(p) {
	const out = [], candy = [], gender = [];
	for (const b of p.evolutionBranch || []) {
		if (!b.evolution) continue;	// a mega evolution
		const form = formName(b.evolution, b.form ? String(b.form) : '');
		const t = form && form !== 'NORMAL' ? `${b.evolution}/${form}` : b.evolution;
		if (out.includes(t)) continue;
		out.push(t);
		candy.push(b.candyCost || null);
		gender.push(b.genderRequirement ? String(b.genderRequirement) : null);
	}
	return { out, candy, gender };
}

/**
 * @param {Array<{templateId: string, data: any}>} all  parsed latest.json
 * @param {{minSpecies?: number, source?: object, now?: string}} [opt]
 */
export function compactGameMaster(all, opt = {}) {
	if (!Array.isArray(all)) throw new Error('game master: expected a JSON array of templates');
	const size = {};
	for (const t of all) {
		const e = t.data && t.data.pokemonExtendedSettings;
		if (e && e.sizeSettings && e.sizeSettings.xxlUpperBound) size[e.form || e.uniqueId] = e.sizeSettings;
	}
	const species = {};
	for (const t of all) {
		if (!/^V\d{4}_POKEMON_/.test(t.templateId)) continue;
		const p = t.data && t.data.pokemonSettings;
		if (!p || !p.pokedexHeightM || !p.pokedexWeightKg || !p.stats || !p.stats.baseAttack) continue;
		const pid = p.pokemonId;
		const key = p.form || pid;
		const f = p.form ? String(p.form) : '';
		const form = (f.startsWith(pid) ? f.slice(pid.length) : f).replace(/^_/, '');
		const types = [p.type, p.type2].filter(Boolean).map(x => x.replace(/^POKEMON_TYPE_/, '')).join('/');
		const sz = size[key] || size[pid] || {};
		const row = [
			p.pokedexHeightM,
			p.pokedexWeightKg,
			p.weightStdDev || p.pokedexWeightKg / 8,
			sz.xxlUpperBound || p.pokedexHeightM * 1.75,
			p.stats.baseAttack,
			p.stats.baseDefense || 0,
			p.stats.baseStamina || 0,
			types,
			sz.xlUpperBound || p.pokedexHeightM * 1.5,
			sz.xsLowerBound || p.pokedexHeightM * 0.5,
		];
		const sp = species[pid] || (species[pid] = { dex: Number(t.templateId.slice(1, 5)), f: {} });
		if (p.familyId && !sp.fam) sp.fam = String(p.familyId).replace(/^FAMILY_/, '');
		sp.f[form] = row;
		const evo = evolutions(p);
		if (evo.out.length) {
			(sp.evo || (sp.evo = {}))[form] = evo.out;
			(sp.evoCandy || (sp.evoCandy = {}))[form] = evo.candy;
			if (evo.gender.some(Boolean)) (sp.evoGender || (sp.evoGender = {}))[form] = evo.gender;
		}
		const mega = megas(p);
		if (mega.length) sp.mega = [...new Set([...(sp.mega || []), ...mega])].sort();
	}
	// Drop forms identical to the base (costumes etc.)
	for (const sp of Object.values(species)) {
		const base = sp.f[''] || sp.f.NORMAL;
		const same = r => JSON.stringify(r) === JSON.stringify(base);
		for (const k of Object.keys(sp.f)) {
			const keep = k === '' || (k === 'NORMAL' && sp.f[''] === undefined) || !same(sp.f[k]);
			if (!keep) delete sp.f[k];
		}
		// the base's template comes twice (POKEMON_X and POKEMON_X_NORMAL): one copy of its evo
		if (sp.evo && sp.evo.NORMAL && sp.evo[''] && JSON.stringify(sp.evo.NORMAL) === JSON.stringify(sp.evo[''])
			&& JSON.stringify(sp.evoCandy.NORMAL) === JSON.stringify(sp.evoCandy[''])
			&& JSON.stringify(sp.evoGender && sp.evoGender.NORMAL) === JSON.stringify(sp.evoGender && sp.evoGender[''])) {
			delete sp.evo.NORMAL;
			delete sp.evoCandy.NORMAL;
			if (sp.evoGender) delete sp.evoGender.NORMAL;
		}
	}
	// forms an evolution picks by gender, apart by their moves alone
	const movesOf = {};
	for (const t of all) {
		const p = /^V\d{4}_POKEMON_/.test(t.templateId) && t.data && t.data.pokemonSettings;
		if (p && p.pokemonId) movesOf[p.form || p.pokemonId] = movesKey(p);
	}
	for (const t of all) {
		const p = /^V\d{4}_POKEMON_/.test(t.templateId) && t.data && t.data.pokemonSettings;
		const by = {};
		for (const b of (p && p.evolutionBranch) || []) if (b.evolution && b.genderRequirement) (by[b.evolution] || (by[b.evolution] = [])).push(b);
		for (const [id, bs] of Object.entries(by)) {
			const keys = [...new Set(bs.map(b => String(b.form || id)))];
			if (keys.length < 2 || !species[id]) continue;
			for (const k of keys.slice(1)) {
				if (movesOf[k] === movesOf[keys[0]]) continue;
				const f = formName(id, k);
				const apart = new Set([...(species[id].movesApart || []), f === 'NORMAL' ? '' : f]);
				species[id].movesApart = [...apart].sort();
			}
		}
	}
	const count = Object.keys(species).length;
	const min = opt.minSpecies ?? MIN_SPECIES;
	if (count < min) throw new Error(`game master: only ${count} species parsed (expected ≥ ${min}); format changed?`);
	const lvl = all.find(t => t.templateId === 'PLAYER_LEVEL_SETTINGS');
	if (!lvl) throw new Error('game master: PLAYER_LEVEL_SETTINGS missing');
	const cs = all.find(t => t.templateId === 'CONTEST_SETTINGS');
	const c = (cs && cs.data.contestSettings.contestScoreCoefficient?.[0]?.pokemonSize) || {};
	// which size showcases the game knows: MAX (biggest), MIN (smallest)
	const rankings = [...new Set(((cs && cs.data.contestSettings.contestLimits) || [])
		.map(l => l.contestMetric).filter(m => m && m.pokemonMetric === 'POKEMON_SIZE').map(m => m.rankingStandard))].sort();
	return {
		v: GM_VERSION,
		generated: opt.now || new Date().toISOString(),
		source: opt.source || { url: GM_URL, etag: '' },
		coef: {
			h: c.heightCoefficient ?? 800,
			w: c.weightCoefficient ?? 150,
			iv: c.ivCoefficient ?? 50,
			xxlAdj: c.xxlAdjustmentFactor ?? 1,
			xxlBonus: XXL_BONUS,
			rankings,
		},
		cpm: lvl.data.playerLevel.cpMultiplier.map(round8),
		species,
	};
}

/** Pokédex number → species ids (usually one). */
export function dexIndex(gm) {
	const idx = new Map();
	for (const [id, sp] of Object.entries(gm.species)) {
		if (!idx.has(sp.dex)) idx.set(sp.dex, []);
		idx.get(sp.dex).push(id);
	}
	return idx;
}

/** All forms of a species as [{form, row}], base first. */
export function formsOf(gm, id) {
	// own entries only: "constructor" is no species, though every object has one
	const sp = Object.hasOwn(gm.species, id) ? gm.species[id] : null;
	if (!sp) return [];
	return Object.entries(sp.f)
		.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
		.map(([form, row]) => ({ form, row }));
}

/** A species' evolution family; the species itself when the game data doesn't say. */
export const familyOf = (gm, id) => (Object.hasOwn(gm.species, id) && gm.species[id].fam) || `#${id}`;

/** Basic shape check for a compact file read from storage or a server (any version so far). */
export function isCompactGm(x) {
	return !!(x && Number.isInteger(x.v) && x.v >= 1 && x.v <= GM_VERSION && x.coef && Array.isArray(x.cpm) && x.cpm.length >= 50 && x.species && typeof x.species === 'object');
}
