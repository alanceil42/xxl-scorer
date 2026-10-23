// Text rules: turn OCR words into readings.
import { caughtPatterns, matchCaught } from './text.js';

/** Type labels under the type icons in the stats row (English client). */
export const TYPES = ['NORMAL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'ICE', 'FIGHTING', 'POISON', 'GROUND',
	'FLYING', 'PSYCHIC', 'BUG', 'ROCK', 'GHOST', 'DRAGON', 'DARK', 'STEEL', 'FAIRY'];

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const num = s => Number(String(s).replace(',', '.'));

/**
 * Rules for one game language, built once from its compact text table.
 * @param {{hp: string, kg: string, m: string, caught: object}} text
 */
export function makeRules(text) {
	return {
		kg: text.kg,
		m: text.m,
		hpLabel: text.hp,
		patterns: caughtPatterns(text),
		hp: new RegExp(`(\\d+)\\s*/\\s*(\\d+)\\s*${esc(text.hp)}`, 'u'),
		weight: new RegExp(`^(\\d+[.,]\\d{1,2})(?:${esc(text.kg)})?$`, 'u'),
		height: new RegExp(`^(\\d+(?:[.,]\\d+)?)${esc(text.m)}$`, 'u'),
		// the close-up crops of the stats row (pipeline.js): the unit is required, and the game
		// shows at most two decimals ("1kg", "0.79m", "259.67kg")
		cropWeight: new RegExp(`^(\\d+(?:[.,]\\d{1,2})?)${esc(text.kg)}$`, 'u'),
		cropHeight: new RegExp(`^(\\d+(?:[.,]\\d{1,2})?)${esc(text.m)}$`, 'u'),
		// the label may be cut off by the trainer under the appraisal on a 16:9 screen ("131 / 131 H")
		cropHp: new RegExp(`^(\\d+)\\s*/\\s*(\\d+)\\s*[${esc([...new Set(text.hp)].join(''))}]{0,${text.hp.length}}$`, 'u'),
	};
}

/**
 * @param {Array<{text: string, bbox: {x0: number, y0: number, x1: number, y1: number}}>} words
 *        words of the full screenshot, in reading order (tesseract.js, psm 11)
 * @param {number} width  screenshot width in px
 * @param {ReturnType<typeof makeRules>} rules
 */
export function parseWords(words, width, rules) {
	const text = words.map(w => w.text).join(' ');
	const out = { species: null, caught: null, hp: null, weight_kg: null, height_m: null, types: [] };
	Object.assign(out, matchCaught(text, rules.patterns));
	const hp = rules.hp.exec(text);
	if (hp) out.hp = Math.max(Number(hp[1]), Number(hp[2]));
	// Types: the labels under the icons in the middle of the stats row
	for (const w of words) {
		const t = w.text.trim().toUpperCase();
		const cx = (w.bbox.x0 + w.bbox.x1) / 2;
		if (TYPES.includes(t) && cx > width * 0.25 && cx < width * 0.75 && !out.types.includes(t)) out.types.push(t);
	}
	if (out.types.length > 2) out.types = [];	// not the stats row after all
	// Weight: prefer a number with its unit ("0.16kg"); "kg" is sometimes not recognised, so fall
	// back to a bare decimal by position. The unit pass keeps e.g. a stardust count
	// ("0,980" with its first digit hidden) from being taken.
	for (const w of words) {
		const t = w.text.trim();
		const cx = (w.bbox.x0 + w.bbox.x1) / 2;
		if (cx < width * 0.4 && t.endsWith(rules.kg)) {
			const m = rules.weight.exec(t);
			if (m) { out.weight_kg = num(m[1]); break; }
		}
	}
	for (const w of words) {
		const t = w.text.trim();
		const cx = (w.bbox.x0 + w.bbox.x1) / 2;
		if (out.weight_kg === null && cx < width * 0.4) {
			const m = rules.weight.exec(t);
			if (m) out.weight_kg = num(m[1]);
		}
		if (out.height_m === null && cx > width * 0.6) {
			const m = rules.height.exec(t);
			if (m) out.height_m = num(m[1]);
		}
	}
	return out;
}

/**
 * Readings from the close-up crops of the stats row (pipeline.js). Each is null unless the text
 * has exactly the expected shape, unit included; then it is more trustworthy than the same
 * value picked out of the whole screenshot's words.
 * @param {{hp?: string, weight?: string, height?: string, badge?: string}} t  raw texts
 */
export function parseCrops(t, rules) {
	const clean = s => String(s || '').trim().replace(/\s+/g, ' ');
	const size = (s, re) => { const m = re.exec(clean(s).replace(/ /g, '')); return m ? num(m[1]) : null; };
	// "60 / 60 HP" read as "60/601P": the H became a 1 stuck to the second number. Any other
	// "P" alone is fine, it is what other clients' labels leave ("120/120 P" for KP or PS).
	const hp = rules.cropHp.exec(clean(t.hp).replace(/^(\d+)(\s*\/\s*)\1 ?1P$/u, '$1$2$1 HP'));
	// at most three digits: no Pokémon has 1000 HP, and "131 / 131 H" can come out as "1314"
	const hpVal = hp && Number(hp[1]) <= Number(hp[2]) && Number(hp[2]) > 0 && Number(hp[2]) < 1000 ? Number(hp[2]) : null;
	const b = clean(t.badge).replace(/ /g, '');
	return {
		hp: hpVal,
		weight_kg: size(t.weight, rules.cropWeight),
		height_m: size(t.height, rules.cropHeight),
		badge: ['XXL', 'XL', 'XS', 'XXS'].includes(b) ? b : null,
	};
}

/** Type names in the text of the type labels' crop ("DARK / NORMAL"); words cut off don't count. */
export function parseTypes(s) {
	const out = [];
	for (const w of String(s || '').toUpperCase().split(/[^A-Z]+/)) if (TYPES.includes(w) && !out.includes(w)) out.push(w);
	return out.length <= 2 ? out : [];
}

/**
 * The name line as read: a nickname or, without one, the species. Kept for comparing screenshots
 * of one Pokémon and resolved to a species only when it is exactly a species name (evaluate.js).
 * The pencil icon after it comes out as a stray character or two.
 */
export function parseName(s) {
	const t = String(s || '').replace(/\s+/g, ' ').trim()
		.replace(/(?:\s+\S{1,2})+$/u, '')	// the pencil: " #", " 7", " /"
		.replace(/^[^\p{L}\p{N}?]+|[^\p{L}\p{N}.'♀♂?]+$/gu, '');
	return t || null;
}

/** The catch year pill, "2024" over "04/04", as "2024 04/04"; null unless it has that shape. */
export function parseYearPill(s) {
	const m = /(\d{4})\D*?(\d{1,2})\s*\/\s*(\d{1,2})/.exec(String(s || ''));
	if (!m) return null;
	const y = Number(m[1]), a = Number(m[2]), b = Number(m[3]);
	if (y < 2016 || y > 2099 || !a || !b || a > 31 || b > 31 || (a > 12 && b > 12)) return null;
	return `${m[1]} ${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
}

/**
 * A catch date as {y, md}: the year and the other two numbers, sorted, so that the "was caught"
 * line ("4/19/2024", in the device's date order) and the year pill ("2024 04/19") compare.
 */
export function dateParts(s) {
	const n = String(s || '').match(/\d+/g);
	if (!n || n.length !== 3) return null;
	const y = n.find(x => x.length === 4);
	if (!y) return null;
	const rest = [...n]; rest.splice(n.indexOf(y), 1);
	return { y: Number(y), md: rest.map(Number).sort((a, b) => a - b).join('/') };
}

/** Two catch dates (caught line or year pill) that can be compared: 'eq' / 'diff', else null. */
export function dateRelation(a, b) {
	const x = dateParts(a), y = dateParts(b);
	if (!x || !y) return null;
	return x.y === y.y && x.md === y.md ? 'eq' : 'diff';
}

/** The year pill as a date in the "was caught" line's order (month/day/year in English): 4/4/2024. */
export function pillAsCaught(pill) {
	const m = /^(\d{4}) (\d{2})\/(\d{2})$/.exec(String(pill || ''));
	return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : null;
}

/** CP from the single-line read of the CP crop ("CP1900" → 1900). */
export function parseCp(s) {
	const d = String(s || '').replace(/\D/g, '');
	if (!d) return null;
	const n = Number(d);
	return n >= 10 && n <= 99999 ? n : null;
}
