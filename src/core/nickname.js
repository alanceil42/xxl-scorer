// "Copy name": a nickname built from a template, to paste into the game.

// Score, IV % in superscript, attack IV in a dark circle, level in a circle: XX1063¹⁸⓿㉚
export const DEFAULT_TEMPLATE = 'XX{score}{iv:sup}{a:dcirc}{lvl:circ}';
export const MAX_NICKNAME = 12;	// Pokémon GO's nickname limit, in characters

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** 0..50 as one circled-number character (Unicode ⓪①…⑳㉑…㉟㊱…㊿), else null. */
export function circled(n) {
	if (!Number.isInteger(n) || n < 0 || n > 50) return null;
	if (n === 0) return '⓪';
	if (n <= 20) return String.fromCodePoint(0x2460 + n - 1);
	if (n <= 35) return String.fromCodePoint(0x3251 + n - 21);
	return String.fromCodePoint(0x32B1 + n - 36);
}

/** 0..20 as one dark (negative) circled number (⓿❶…❿⓫…⓴), else null. Fits IVs 0-15. */
export function darkCircled(n) {
	if (!Number.isInteger(n) || n < 0 || n > 20) return null;
	if (n === 0) return '\u24FF';
	if (n <= 10) return String.fromCodePoint(0x2776 + n - 1);
	return String.fromCodePoint(0x24EB + n - 11);
}

const superscript = s => String(s).replace(/\d/g, d => SUP[d]);

/** Values a template can use, from an evaluated row (src/core/evaluate.js). */
export function nameValues(e) {
	const ivs = e.ivs;
	const sum = ivs ? ivs.a + ivs.d + ivs.s : null;
	return {
		score: e.score ? Math.round(e.score.total) : null,
		iv: sum == null ? null : Math.round(sum / 45 * 100),
		ivsum: sum,
		a: ivs ? ivs.a : null,
		d: ivs ? ivs.d : null,
		s: ivs ? ivs.s : null,
		lvl: e.level,
		name: e.name || null,
		xxl: e.xxl ? 'XXL' : '',
		xxs: e.xxs ? 'XXS' : '',
		size: e.xxl ? 'XXL' : e.xxs ? 'XXS' : '',
	};
}

/**
 * Fill a template: {score} {iv} {ivsum} {a} {d} {s} {lvl} {name} {xxl} {xxs} {size}, each optionally with a
 * style: {iv:sup} superscript digits, {lvl:circ} one circled number (whole numbers 0-50),
 * {a:dcirc} one dark circled number (0-20).
 * Unknown placeholders stay as they are; unknown values become "?".
 * @returns {{text: string, length: number, tooLong: boolean, missing: string[]}}
 */
export function formatName(template, values) {
	const missing = [];
	const text = String(template || DEFAULT_TEMPLATE).replace(/\{(\w+)(?::(sup|circ|dcirc))?\}/g, (all, key, style) => {
		if (!(key in values)) return all;
		const v = values[key];
		const label = key === 'xxl' || key === 'xxs' || key === 'size';	// may be empty
		if (v == null || v === '') {
			if (!label) missing.push(key);
			return label ? '' : '?';
		}
		if (style === 'sup') return superscript(v);
		if (style === 'circ') return circled(Number(v)) ?? String(v);
		if (style === 'dcirc') return darkCircled(Number(v)) ?? String(v);
		return String(v);
	});
	const length = [...text].length;
	return { text, length, tooLong: length > MAX_NICKNAME, missing };
}
