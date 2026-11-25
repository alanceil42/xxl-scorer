// A list tile's nickname, read as tokens (namereader.js), → its values. The names this reads:
//
//   XX1063¹⁸⓿㉚     "Name to copy" (nickname.js): XX, the score, IV % in superscript, Attack in a
//                   filled circle, level circled (½ after it for a half level)
//   XX¹⁸⓿㉚        the same from a template without the score
//   ⁸⁰⓫㉑2650      another app's names: [prefix] [● shadow | ◯ purified] IV % ⓯ level [Max CP]
//                   [Ⓖ53 PvP league and rank]; ◯ for Attack: several IV combinations fit
//
// Anything else (a species name, a nickname of your own) has style 'none'.

/** IV % values a whole IV total can show (0-45 of 45, rounded). */
export const IV_PCTS = new Set(Array.from({ length: 46 }, (_, s) => Math.round((100 * s) / 45)));

/** The IV total behind an IV %, null when no total gives it. */
export function totalOf(pct) {
	for (let s = 0; s <= 45; s++) if (Math.round((100 * s) / 45) === pct) return s;
	return null;
}

/** The IV % most readings agree on, among those the game can show. */
function votePct(reads) {
	const n = new Map();
	for (const r of reads) if (/^\d{1,3}$/.test(r) && IV_PCTS.has(Number(r))) n.set(Number(r), (n.get(Number(r)) || 0) + 1);
	let best = null, k = 0;
	for (const [v, c] of n) if (c > k) { best = v; k = c; }
	return best;
}

const small = t => (/^\d{1,2}$/.test(t) ? Number(t) : null);

/**
 * Tokens (namereader.js) → {style, ivPct, total, atk, level, maxCp, shadow, purified, pvp,
 * prefix, raw}. style: 'new' (Attack in a filled circle), 'multi' (◯ for Attack), 'old' (no
 * Attack), 'none' (no IV % before a circle: a species name, a tag, anything else).
 */
export function parseName(toks) {
	const raw = toks.map(t => (t.kind === 'sup' ? `^${t.text}` : t.kind === 'disc' ? `(${t.text})` : t.kind === 'ring' ? `[${t.text || t.letter || ''}]` : t.text)).join('');
	let k = toks.findIndex((t, i) => t.kind === 'sup' && i + 1 < toks.length && (toks[i + 1].kind === 'disc' || toks[i + 1].kind === 'ring'));
	// no IV %: a name of 12 characters may have no room for it; Attack in its disc and the
	// level's ring right after it still say whose name this is
	const noPct = k < 0;
	if (noPct) {
		k = toks.findIndex((t, i) => t.kind === 'disc' && /^\d{1,2}$/.test(t.text) && toks[i + 1] && toks[i + 1].kind === 'ring' && /^\d{1,2}$/.test(toks[i + 1].text)) - 1;
		if (k < -1) return { style: 'none', raw };
	}
	const pre = toks.slice(0, k + (noPct ? 1 : 0));
	const prefix = pre.filter(t => t.kind === 'text').map(t => t.text).join('').replace(/\s+/g, '');
	const ivPct = noPct ? null : votePct(toks[k].reads || [toks[k].text]);
	const out = {
		style: 'old', raw, prefix,
		shadow: pre.some(t => t.kind === 'dot'),
		purified: pre.some(t => t.kind === 'ring' && t.empty),
		ivPct, total: ivPct == null ? null : totalOf(ivPct),
		atk: null, level: null, maxCp: null, pvp: false,
	};
	if (noPct) out.noPct = true;
	let i = k + 1;
	const a = toks[i];
	if (a.kind === 'disc') { out.style = 'new'; out.atk = small(a.text); i++; }
	else if (a.kind === 'ring' && a.empty && toks[i + 1] && toks[i + 1].kind === 'ring') { out.style = 'multi'; i++; }
	const l = toks[i];
	if (l && l.kind === 'ring' && !l.letter) { out.level = small(l.text); i++; }
	const afterLevel = i;
	for (; i < toks.length; i++) {
		const t = toks[i];
		if (t.kind === 'ring' && t.letter) { out.pvp = true; continue; }
		let s = (t.text || '').replace(/\s+/g, '');
		// maybe a ½: Tesseract reads the glyph as "Ya" or the like. Something narrow right after
		// the level's ring that is no number may be the half, or the edge of a button ("ra",
		// "A"): the level stays whole, and halfMaybe lets the half level agree too (listsync.js)
		if (i === afterLevel && out.level != null && !(out.level % 1) && t.kind === 'text' && t.w != null && t.w < 0.9 && !/\d{3}/.test(s) && !/^½/.test(s) && !/^1?\/?2$/.test(s)) {
			out.halfMaybe = true;
			continue;
		}
		if (out.maxCp == null && out.level != null && !(out.level % 1) && (/^½/.test(s) || (/^1?\/?2$/.test(s) && t.h < 0.95))) {
			out.level += 0.5;
			s = s.replace(/^½/, '');
			if (!s || /^1?\/?2$/.test(s)) continue;
		}
		const m = /^(?:\d{2,4}\/)?(\d{3,4})$/.exec(s);
		if (m && out.maxCp == null) out.maxCp = Number(m[1]);
	}
	if (out.atk != null && out.atk > 15) out.atk = null;
	if (out.level != null && (out.level < 1 || out.level > 51)) out.level = null;
	return out;
}

/**
 * The score in a name's prefix: XX and digits (XX1063), letters after XX allowed as long as the
 * digits end it (a type symbol read as a letter). → a number, or null ("XX", a bare score).
 */
export function nameScore(p) {
	const pre = p && p.prefix ? String(p.prefix).replace(/\s+/g, '') : '';
	const m = /^XX[A-Za-z]*?(\d{3,4})$/i.exec(pre);
	return m ? Number(m[1]) : null;
}
