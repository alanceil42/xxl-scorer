// IVs: solve CP/HP, rank by the appraisal bars.
import { ROW } from './gm.js';

/** Whole and half levels with their CP multipliers. */
export function levelTable(cpm) {
	const out = [];
	for (let i = 0; i < cpm.length; i++) {
		out.push({ level: i + 1, m: cpm[i] });
		if (i + 1 < cpm.length) out.push({ level: i + 1.5, m: Math.sqrt((cpm[i] ** 2 + cpm[i + 1] ** 2) / 2) });
	}
	return out;
}

export const cpOf = (row, a, d, s, m) =>
	Math.max(10, Math.floor((row[ROW.ATK] + a) * Math.sqrt(row[ROW.DEF] + d) * Math.sqrt(row[ROW.STA] + s) * m * m / 10));
export const hpOf = (row, s, m) => Math.max(10, Math.floor((row[ROW.STA] + s) * m));

/** Every (a, d, s, level) giving exactly this CP and HP. */
export function solveIVs(row, cp, hp, cpm, maxLevel = 51) {
	const hits = [];
	for (const { level, m } of levelTable(cpm)) {
		if (level > maxLevel) break;
		for (let s = 0; s <= 15; s++) {
			if (hpOf(row, s, m) !== hp) continue;
			for (let a = 0; a <= 15; a++) {
				for (let d = 0; d <= 15; d++) {
					if (cpOf(row, a, d, s, m) === cp) hits.push({ a, d, s, level });
				}
			}
		}
	}
	return hits;
}

/** Sort candidates by distance to the bar readings; ties: higher IV sum first. */
export function rankByBars(hits, bars) {
	const dist = h => (bars ? ['a', 'd', 's'].reduce((t, k) => t + (bars[k] == null ? 0 : Math.abs(h[k] - bars[k])), 0) : 0);
	return hits
		.map(h => ({ ...h, dist: dist(h) }))
		.sort((x, y) => x.dist - y.dist || (y.a + y.d + y.s) - (x.a + x.d + x.s) || x.level - y.level);
}

/** Bars rounded to whole IVs, clamped to 0..15. */
export function roundBars(bars) {
	if (!bars) return null;
	const r = v => Math.min(15, Math.max(0, Math.round(v)));
	return { a: r(bars.a), d: r(bars.d), s: r(bars.s) };
}

/** Levels at which these IVs give this HP, with the CP each would show. */
export function levelsForHp(row, ivs, hp, cpm, maxLevel = 51) {
	const out = [];
	for (const { level, m } of levelTable(cpm)) {
		if (level > maxLevel) break;
		if (hpOf(row, ivs.s, m) === hp) out.push({ level, cp: cpOf(row, ivs.a, ivs.d, ivs.s, m) });
	}
	return out;
}
