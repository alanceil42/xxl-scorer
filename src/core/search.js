// Search the list: free text plus the common part of Pokémon GO's own
// search syntax, in English.
//
//   cranidos  char      name or form contains it (accents and case ignored)
//   25  1-151  387-     Pokédex number or range
//   cp713  cp700-800  cp-500  cp2500-        CP; the same for hp…  (and score…, not in the game)
//   xxl  xxs            XXL, XXS
//   lucky               lucky Pokémon ("LUCKY POKÉMON" under the name)
//   fire  rock          type
//   4*  3-4*  0*        appraisal stars by IV sum: 4* = 45, 3* = 37-44, 2* = 30-36, 1* = 23-29,
//                       0* = 0-22
//   4attack  0-1defense  3-4hp                IV per stat as the game's search groups them:
//                       0 = 0, 1 = 1-5, 2 = 6-10, 3 = 11-14, 4 = 15
//   year2024  year2020-2022                   catch year
//   check               rows marked to check (not a game term; the "n to check" button)
//   ! before a term     not
//   , ; :               or     (binds tighter than and, as in the game: fire,water&xxl)
//   & |  space          and
import { TYPES } from './read.js';
import { rowScore } from './score.js';

const STARS = [[0, 22], [23, 29], [30, 36], [37, 44], [45, 45]];
/** The game's per-stat IV groups: 0attack = 0, 1attack = 1-5, …, 4attack = 15 (Find in game uses them too). */
export const STAT_STARS = [[0, 0], [1, 5], [6, 10], [11, 14], [15, 15]];
const TYPE_WORDS = new Set(TYPES.map(t => t.toLowerCase()));
const STATS = { attack: 'a', defense: 'd', hp: 's' };

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "25" → [25, 25], "10-20", "-30", "40-" → open ends as ±Infinity; null if not a number range. */
export function parseRange(s) {
	const m = /^(\d+(?:\.\d+)?)?(-)?(\d+(?:\.\d+)?)?$/.exec(s);
	if (!m || (m[1] == null && m[3] == null)) return null;
	const lo = m[1] != null ? Number(m[1]) : -Infinity;
	const hi = m[3] != null ? Number(m[3]) : m[2] ? Infinity : lo;
	return lo <= hi ? [lo, hi] : [hi, lo];
}

const inRange = (v, r) => v != null && v >= r[0] && v <= r[1];

/** Star range (0-4) → an IV range, via one of the tables above. */
const starsToIvs = (r, table) => {
	const lo = Math.max(0, Math.ceil(r[0])), hi = Math.min(4, Math.floor(r[1]));
	return lo > hi ? null : [table[lo][0], table[hi][1]];
};

/** Catch year from the catch date as read (the only 4-digit number in it), or null. */
export const caughtYear = e => {
	const m = /\b(\d{4})\b/.exec(e.caught || '');
	return m ? Number(m[1]) : null;
};

/** A row with an issue to look at; notes (info) don't count. */
export const needsCheck = e => e.issues.some(i => !i.info);

/** One term (no operators) → predicate over an evaluated row (evaluate()'s result). */
function term(word) {
	let m;
	if (word === 'xxl') return e => e.xxl === true;
	if (word === 'xxs') return e => e.xxs === true;
	if (word === 'lucky') return e => e.lucky === true;
	if (word === 'check') return needsCheck;
	if ((m = /^(cp|hp|score|year)(.+)$/.exec(word)) && parseRange(m[2])) {
		const r = parseRange(m[2]);
		if (m[1] === 'cp') return e => inRange(e.cp, r);
		if (m[1] === 'hp') return e => inRange(e.hp, r);
		if (m[1] === 'year') return e => inRange(caughtYear(e), r);
		return e => inRange(rowScore(e), r);
	}
	if ((m = /^(.+)\*$/.exec(word)) && parseRange(m[1])) {
		const r = starsToIvs(parseRange(m[1]), STARS);
		return e => !!r && !!e.ivs && inRange(e.ivs.a + e.ivs.d + e.ivs.s, r);
	}
	if ((m = /^(.+?)(attack|defense|hp)$/.exec(word)) && parseRange(m[1])) {
		const r = starsToIvs(parseRange(m[1]), STAT_STARS), k = STATS[m[2]];
		return e => !!r && !!e.ivs && inRange(e.ivs[k], r);
	}
	const dex = parseRange(word);
	if (dex) return e => inRange(e.dex, dex);
	if (TYPE_WORDS.has(word)) return e => fold(e.types).split('/').includes(word);
	return e => fold(`${e.name} ${e.formName}`).includes(word);
}

/**
 * Compile a search into a predicate over evaluated rows; null for an empty search (show all).
 * Unknown words are free text, so a typo finds nothing rather than raising an error.
 */
export function compileSearch(query) {
	const groups = fold(query).split(/[&|]/).map(g => g.split(/[,;:]/)
		.map(alt => alt.trim().split(/\s+/).filter(w => w && w !== '!').map(w => {
			const neg = w.startsWith('!');
			const p = term(neg ? w.slice(1) : w);
			return neg ? e => !p(e) : p;
		}))
		.filter(words => words.length))
		.filter(alts => alts.length);
	if (!groups.length) return null;
	return e => groups.every(alts => alts.some(words => words.every(p => p(e))));
}
