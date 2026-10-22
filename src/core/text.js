// Game text tables: species names and info-line templates per game language.
// tools/build-gm.sh implements the same compaction in jq.

/** Language code → PokeMiners file name part (only checked ones; add more with their rules file). */
export const LANGUAGES = Object.freeze({ en: 'english', de: 'german' });

export const textUrl = lang =>
	`https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Texts/Latest%20APK/JSON/i18n_${LANGUAGES[lang] || lang}.json`;

// appraise_v2_* keys and what their placeholders hold
const CAUGHT = Object.freeze({
	appraise_v2_caught: ['species', 'date', 'place'],
	appraise_v2_date_uncached_loc: ['species', 'date'],
	appraise_v2_dateless_caught: ['species', 'place'],
	appraise_v2_dateless_uncached_loc: ['species'],
});

/**
 * @param {{data: string[]}} i18n  parsed i18n_<language>.json (flat key/value list)
 * @returns {{names: Object<string,string>, caught: Object<string,string>, hp: string, kg: string, m: string}}
 */
export function compactText(i18n) {
	const list = i18n && i18n.data;
	if (!Array.isArray(list)) throw new Error('text table: expected {data: [key, value, ...]}');
	const kv = new Map();
	for (let i = 0; i + 1 < list.length; i += 2) kv.set(list[i], list[i + 1]);
	const names = {};
	for (const [k, v] of kv) {
		const m = /^pokemon_name_(\d{4})$/.exec(k);
		if (m && v) names[String(Number(m[1]))] = v;
	}
	const caught = {};
	for (const k of Object.keys(CAUGHT)) if (kv.has(k)) caught[k] = kv.get(k);
	if (Object.keys(names).length < 100 || !caught.appraise_v2_caught) {
		throw new Error('text table: species names or caught line missing; format changed?');
	}
	return { names, caught, hp: kv.get('general_hp') || 'HP', kg: kv.get('general_kg') || 'kg', m: kv.get('general_m') || 'm' };
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Patterns for the info line, most specific first.
 * Each: {re, roles}; re's capture groups follow roles (species, date, place).
 */
export function caughtPatterns(text) {
	const out = [];
	for (const [key, roles] of Object.entries(CAUGHT)) {
		const tpl = text.caught[key];
		if (!tpl) continue;
		// Cut at the place placeholder: nothing after it is needed and places run into other text.
		const placeIdx = roles.indexOf('place');
		let t = tpl;
		const used = [];
		if (placeIdx >= 0) t = t.slice(0, t.indexOf(`{${placeIdx}}`));
		t = t.replace(/[.。!！]\s*$/, '');
		let src = '';
		let last = 0;
		const ph = /\{(\d)\}/g;
		let m;
		while ((m = ph.exec(t))) {
			src += esc(t.slice(last, m.index)).replace(/\s+/g, '\\s*');
			const role = roles[Number(m[1])];
			src += role === 'species' ? '(.+?)' : role === 'date' ? '(\\S+)' : '.+?';
			if (role !== 'place') used.push(role);
			last = ph.lastIndex;
		}
		src += esc(t.slice(last)).replace(/\s+/g, '\\s*');
		// A trailing lazy group needs a stop: end the species at the next word when nothing follows.
		if (src.endsWith('(.+?)')) src = src.slice(0, -5) + '(\\S+)';
		out.push({ key, re: new RegExp(src, 'u'), roles: used, specificity: used.length + (placeIdx >= 0 ? 1 : 0) });
	}
	return out.sort((a, b) => b.specificity - a.specificity);
}

/** Find species name and catch date in OCR text. */
export function matchCaught(ocrText, patterns) {
	const flat = ocrText.replace(/\s+/g, ' ');
	for (const p of patterns) {
		const m = p.re.exec(flat);
		if (!m) continue;
		const out = { species: null, caught: null };
		p.roles.forEach((role, i) => {
			if (role === 'species') out.species = m[i + 1].trim();
			if (role === 'date') out.caught = m[i + 1].replace(/[.,;:]$/, '');
		});
		return out;
	}
	return { species: null, caught: null };
}

export function normalizeName(s) {
	return String(s || '')
		.normalize('NFKD').replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}♀♂]/gu, '');
}

export function levenshtein(a, b) {
	if (a === b) return 0;
	const m = a.length, n = b.length;
	let prev = Array.from({ length: n + 1 }, (_, j) => j);
	for (let i = 1; i <= m; i++) {
		const cur = [i];
		for (let j = 1; j <= n; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[n];
}

/**
 * Map of normalised name → Pokédex number, plus the list for fuzzy search. Never changed once
 * built: findDex and findDexByName remember their answers per index.
 */
export function nameIndex(text) {
	const exact = new Map();
	for (const [dex, name] of Object.entries(text.names)) exact.set(normalizeName(name), Number(dex));
	return { exact, list: [...exact.entries()] };
}

/**
 * Pokédex number for a name read by OCR: exact after normalising, else a unique best match with
 * Levenshtein ≤ 2 (≤ 1 for names under 5 letters). Returns null when unsure.
 */
export function findDex(name, index) {
	const n = normalizeName(name);
	if (!n) return null;
	if (index.exact.has(n)) return index.exact.get(n);
	return remembered(index, 'fuzzy', n, fuzzyDex);
}

/**
 * Answers per index and normalised name. Merging asks for the same names again and again
 * (every row's species and name, for every screenshot that comes in); a name that isn't exact
 * costs a comparison with every species' name. At most LIMIT names each, then it starts over.
 */
const memo = new WeakMap();
const LIMIT = 20000;
function remembered(index, kind, n, f) {
	let m = memo.get(index);
	if (!m) memo.set(index, m = { fuzzy: new Map(), byName: new Map() });
	const known = m[kind];
	if (known.has(n)) return known.get(n);
	if (known.size >= LIMIT) known.clear();
	const v = f(n, index);
	known.set(n, v);
	return v;
}

function fuzzyDex(n, index) {
	const maxD = n.length < 5 ? 1 : 2;
	let best = null, bestD = Infinity, tie = false;
	for (const [k, dex] of index.list) {
		if (Math.abs(k.length - n.length) > maxD) continue;
		const d = levenshtein(n, k);
		if (d < bestD) { best = dex; bestD = d; tie = false; }
		else if (d === bestD && dex !== best) tie = true;
	}
	return bestD <= maxD && !tie ? best : null;
}

/**
 * Pokédex number for the name line, when it is a species name and not a nickname: exact after
 * normalising, or one character off for names of 6 letters or more (unique). Stricter than
 * findDex: a nickname is any text, and "Xxl" or "Ono" must not become a species.
 */
export function findDexByName(name, index) {
	const n = normalizeName(name);
	if (n.length < 3) return null;
	if (index.exact.has(n)) return index.exact.get(n);
	if (n.length < 6) return null;
	return remembered(index, 'byName', n, oneOffDex);
}

function oneOffDex(n, index) {
	let best = null, n1 = 0;
	for (const [k, dex] of index.list) {
		if (Math.abs(k.length - n.length) > 1) continue;
		if (levenshtein(n, k) === 1 && dex !== best) { best = dex; n1++; }
	}
	return n1 === 1 ? best : null;
}
