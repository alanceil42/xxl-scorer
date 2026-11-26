// "Find in game": a search string for Pokémon GO's storage that finds one Pokémon, e.g. for an
// XXL Tornadus:
//
//   641&xxl&cp1900&hp121&4attack&3defense&4hp&year2024
//
// Pokédex number, size class, CP, HP, the three IV groups and the catch year, joined with "and".
// A term the row has no value for is left out. Without a CP it is wider rather than empty: with
// IVs from the bars alone, a CP range and IV groups for each bar one IV off ("cp1190-1312",
// "2-3defense"); with IVs typed in, the CPs of the levels the HP allows ("cp1238,cp1251").
// English terms only, as the rest.
// src/core/search.js reads the same syntax, so the page can check what a string finds.
import { STAT_STARS, caughtYear } from './search.js';

/** An IV (0-15) → the game's per-stat group 0-4 (0, 1-5, 6-10, 11-14, 15). */
export const ivGroup = v => STAT_STARS.findIndex(([lo, hi]) => v >= lo && v <= hi);

/**
 * The search for one evaluated row (evaluate()'s result), or null without the species. Without
 * the CP it is as narrow as the rest allows without missing the Pokémon: e.near (evaluate's
 * bars one IV off), else the levels' CPs where the HP leaves two open (the game's comma is
 * "or" within the and-group), else no CP term.
 */
export function gameSearch(e) {
	if (!e || e.dex == null) return null;
	const t = [String(e.dex)];
	if (e.xxl) t.push('xxl');
	else if (e.xxs) t.push('xxs');
	const near = e.cp == null ? e.near : null;
	const span = (lo, hi) => (lo === hi ? `${lo}` : `${lo}-${hi}`);
	if (e.cp != null) t.push(`cp${e.cp}`);
	else if (near?.cp) t.push(`cp${span(near.cp.lo, near.cp.hi)}`);
	else if (e.levels && e.cpExpected) t.push([...new Set(e.cpExpected)].map(c => `cp${c}`).join(','));
	if (e.hp != null) t.push(`hp${e.hp}`);
	if (near) for (const [k, w] of [['a', 'attack'], ['d', 'defense'], ['s', 'hp']]) t.push(`${span(ivGroup(near[k].lo), ivGroup(near[k].hi))}${w}`);
	else if (e.ivs) t.push(`${ivGroup(e.ivs.a)}attack`, `${ivGroup(e.ivs.d)}defense`, `${ivGroup(e.ivs.s)}hp`);
	const y = caughtYear(e);
	if (y != null) t.push(`year${y}`);
	return t.join('&');
}
