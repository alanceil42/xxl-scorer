// Game master: compact PokeMiners' latest.json into the small shape the page uses.
// tools/build-gm.sh implements the same compaction in jq; tests/gm.test.js keeps them identical.

export const GM_URL = 'https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json';
export const XXL_BONUS = 178;	// not in the game master
export const MIN_SPECIES = 900;	// format change guard

/**
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
		sp.f[form] = row;
	}
	// Drop forms identical to the base (costumes etc.)
	for (const sp of Object.values(species)) {
		const base = sp.f[''] || sp.f.NORMAL;
		const same = r => JSON.stringify(r) === JSON.stringify(base);
		for (const k of Object.keys(sp.f)) {
			const keep = k === '' || (k === 'NORMAL' && sp.f[''] === undefined) || !same(sp.f[k]);
			if (!keep) delete sp.f[k];
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
		v: 1,
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
	const sp = gm.species[id];
	if (!sp) return [];
	return Object.entries(sp.f)
		.sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
		.map(([form, row]) => ({ form, row }));
}

/** Basic shape check for a compact file read from storage or a server. */
export function isCompactGm(x) {
	return !!(x && x.v === 1 && x.coef && Array.isArray(x.cpm) && x.cpm.length >= 50 && x.species && typeof x.species === 'object');
}
