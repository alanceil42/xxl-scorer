// A tile's name read as tokens → its values (tilename.js), the digits by learned templates
// (digits.js), and the name reader's own paths on drawn names (namereader.js): Tesseract's
// circle readings agreeing or not, "11" from two glyphs, a lettered ring, superscripts without
// templates, circles that touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseName, nameScore, totalOf, IV_PCTS } from '../src/core/tilename.js';
import { glyphVector, classify, readGlyphs, templates, thresholdsOf, encode, normalize, GW, GH } from '../src/core/digits.js';
import { readNameTokens, nameParts } from '../src/core/namereader.js';
import { TEMPLATES } from '../src/core/digit-templates.js';
import { blank, name, nameWidth, fakeEngine, circle, text, rect, INK } from './lib/drawlist.js';

const sup = (t, reads) => ({ kind: 'sup', text: t, ...(reads ? { reads } : {}) });
const disc = t => ({ kind: 'disc', text: t });
const ring = (t, more = {}) => ({ kind: 'ring', text: t, ...more });
const txt = (t, w = 2, h = 1) => ({ kind: 'text', text: t, w, h });

test('parseName: "Name to copy" names, IV % by vote, Max CP after the level', () => {
	const p = parseName([txt('XX1063'), sup('80', ['80', '30', '80']), disc('15'), ring('29'), txt('2650')]);
	assert.deepEqual([p.style, p.prefix, p.ivPct, p.total, p.atk, p.level, p.maxCp, p.pvp], ['new', 'XX1063', 80, 36, 15, 29, 2650, false]);
	assert.equal(p.raw, 'XX1063^80(15)[29]2650');
	assert.equal(nameScore(p), 1063);
	assert.equal(nameScore({ prefix: 'XXA1063' }), 1063, 'a type symbol read as a letter');
	assert.equal(nameScore({ prefix: 'XX' }), null);
	assert.equal(nameScore(null), null);
	assert.equal(parseName([sup('77', ['77']), disc('3'), ring('20')]).ivPct, null, 'no total gives 77 %');
	assert.equal(parseName([sup('80'), disc('3'), ring('20'), txt('2846/2900')]).maxCp, 2900);
});

test('parseName: half levels, a ½ maybe, a shadow, purified, PvP, other apps\' styles', () => {
	assert.equal(parseName([sup('80'), disc('3'), ring('20'), txt('½')]).level, 20.5);
	assert.equal(parseName([sup('80'), disc('3'), ring('20'), txt('½2650')]).maxCp, 2650);
	assert.equal(parseName([sup('80'), disc('3'), ring('20'), txt('1/2', 0.5, 0.6)]).level, 20.5);
	const maybe = parseName([sup('80'), disc('3'), ring('20'), txt('Ya', 0.5)]);
	assert.equal(maybe.level, 20);
	assert.equal(maybe.halfMaybe, true);
	const sh = parseName([{ kind: 'dot', text: '●' }, ring('', { empty: true }), sup('80'), disc('3'), ring('20'), ring('', { letter: 'G' })]);
	assert.deepEqual([sh.shadow, sh.purified, sh.pvp], [true, true, true]);
	assert.equal(parseName([sup('80'), ring('', { empty: true }), ring('20')]).style, 'multi');
	const old = parseName([sup('80'), ring('20')]);
	assert.deepEqual([old.style, old.atk, old.level], ['old', null, 20]);
	assert.equal(parseName([txt('Pidove')]).style, 'none');
	assert.equal(parseName([]).style, 'none');
	const big = parseName([sup('80'), disc('16'), ring('55')]);
	assert.deepEqual([big.atk, big.level], [null, null], 'out of range');
});

test('parseName: no IV % (a 12-character name has no room): Attack and level still say whose', () => {
	const p = parseName([txt('XX1063'), disc('15'), ring('29')]);
	assert.deepEqual([p.style, p.noPct, p.ivPct, p.atk, p.level, p.prefix], ['new', true, null, 15, 29, 'XX1063']);
	assert.equal(parseName([disc('15'), txt('x'), ring('29')]).style, 'none');
	assert.equal(totalOf(80), 36);
	assert.equal(totalOf(77), null);
	assert.equal(IV_PCTS.size, 46);
});

test('digits: a template read back as itself; too small, too wide, unclear: unread', () => {
	const t = templates();
	assert.equal(templates(), t, 'decoded once');
	assert.deepEqual(Object.keys(t).sort(), ['disc', 'ring', 'sup']);
	const vec = s => Float32Array.from(s, c => (c.charCodeAt(0) - 48) / 15);
	for (const kind of ['disc', 'ring', 'sup']) for (const d of '0123456789') assert.equal(classify(vec(TEMPLATES.kinds[kind][d]), kind).d, d, `${kind} ${d}`);
	assert.equal(readGlyphs([vec(TEMPLATES.kinds.disc[1]), vec(TEMPLATES.kinds.disc[5])], 'disc'), '15');
	assert.equal(readGlyphs([vec(TEMPLATES.kinds.disc[1])], 'disc', TEMPLATES, 0), null, 'more glyphs than it may hold');
	assert.equal(readGlyphs([null], 'disc'), null);
	assert.equal(readGlyphs([], 'disc'), null);
	assert.equal(readGlyphs([new Float32Array(GW * GH).fill(0.5)], 'disc'), null, 'nothing like a digit');
	assert.equal(classify(vec(TEMPLATES.kinds.disc[1]), 'nope'), null);
	const own = { kinds: { disc: { 1: TEMPLATES.kinds.disc[1] } }, minScore: 0.5, minLead: 0.1 };
	assert.deepEqual(thresholdsOf('disc', own), { minScore: 0.5, minLead: 0.1 });
	assert.equal(Math.round(classify(vec(TEMPLATES.kinds.disc[1]), 'disc', own).lead), 2, 'one template: its lead over nothing');
	assert.deepEqual(thresholdsOf('sup'), TEMPLATES.per.sup);
	assert.equal(encode([0, 1, 2, -1]), '0??0');
	assert.equal(normalize(new Float32Array(4)).every(x => x === 0), true, 'a flat vector stays flat');
	const box = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
	assert.equal(glyphVector(new Set(), 10, box(0, 0, 3, 3)), null, 'too small');
	assert.equal(glyphVector(new Set(), 100, box(0, 0, 30, 9)), null, 'two digits run together');
	assert.equal(glyphVector(new Set([0]), 10, box(0, 0, 4, 9)).length, GW * GH);
});

/** A drawn name alone, as listview.js crops it. */
function nameImg(n, D = 48) {
	const w = nameWidth(n, D) + 40, img = blank(w, D + 20);
	name(img, n, 20, 10, D);
	return img;
}

test('readNameTokens: Tesseract\'s circle readings agree, disagree, or give "1" for two glyphs', async () => {
	const img = nameImg({ prefix: 'XX5', sup: '80', disc: '11', ring: '29' });
	// "1" from the disc's two glyphs: "11"; the ring read alike at both levels
	const r = await readNameTokens(img, fakeEngine({ '0123456789': ['80', '80', '80', '1', '1', '29', '29'] }), { supTemplates: false });
	assert.deepEqual(r.filter(t => t.kind !== 'text').map(t => [t.kind, t.text]), [['sup', '80'], ['disc', '11'], ['ring', '29']]);
	// two readings that disagree: the one with as many digits as glyphs; none: unsure, then the
	// templates
	const u = await readNameTokens(img, fakeEngine({ '0123456789': ['80', '80', '80', '7', '2', '29', '2'] }), { supTemplates: false });
	assert.deepEqual(u[1].reads, ['80', '80', '80'], 'without templates: three readings');
	assert.equal(u[2].text, '11', 'Tesseract unsure, the templates read it');
	assert.equal(u[2].tmpl, true);
	assert.equal(u[3].text, '29', 'one reading of two digits fits');
	assert.equal(u[3].unsure, true);
});

test('readNameTokens: an empty ring, a lettered one, a shadow dot, specks between circles', async () => {
	const img = nameImg({ dot: true, prefix: 'XX5', sup: '80', disc: '3', ringEmpty: true, ring: '20' });
	const r = await readNameTokens(img, fakeEngine());
	assert.deepEqual(r.map(t => t.kind), ['dot', 'text', 'sup', 'disc', 'ring', 'ring']);
	assert.equal(r[4].empty, true);
	assert.equal(parseName(r).purified, false, 'after the IV %: no purified mark');
	// a ring with a letter: no digits read, then GUL
	const g = nameImg({ sup: '80', disc: '3', ring: '20' });
	circle(g, g.width - 30, 34, 20, [255, 255, 255]);
	circle(g, g.width - 30, 34, 20, INK, 3);
	text(g, 'L', g.width - 36, 24, 4);
	const lr = await readNameTokens(g, fakeEngine({ '0123456789': ['7', '8'], GUL: ['L'] }));
	assert.ok(lr.some(t => t.kind === 'ring' && t.letter === 'L'));
	assert.deepEqual(await readNameTokens(blank(100, 40), fakeEngine()), []);
	assert.deepEqual(nameParts(blank(10, 10)).parts, []);
});

test('nameParts: circles that touch are cut at their neck', () => {
	const D = 48, img = blank(200, 80);
	circle(img, 30 + D / 2, 40, D / 2, INK);
	circle(img, 30 + D + D / 2 - 2, 40, D / 2, INK, 3);
	const P = nameParts(img);
	assert.deepEqual(P.parts.map(p => p.kind), ['disc', 'ring']);
	const img2 = blank(200, 80);
	circle(img2, 30 + D / 2, 40, D / 2, INK, 3);
	circle(img2, 30 + D + D / 2 - 2, 40, D / 2, INK);
	assert.deepEqual(nameParts(img2).parts.map(p => p.kind), ['ring', 'disc'], 'the round piece at the right end');
});

test('readNameTokens: a superscript joined to the glyph before it by a stroke is cut free', async () => {
	const D = 48, n = { prefix: 'XX5', sup: '76', disc: '3', ring: '20' };
	const img = blank(nameWidth(n, D) + 40, D + 20);
	name(img, n, 20, 10, D);
	const s = Math.round((0.6 * D) / 5), end = 20 + 3 * 4 * s - s;
	rect(img, end - 1, 10 + 0.4 * D - 3, Math.round(D / 8) + 3, 3, INK);
	const t = await readNameTokens(img, fakeEngine());
	assert.deepEqual(t.map(x => x.kind), ['text', 'sup', 'disc', 'ring']);
	assert.equal(parseName(t).ivPct, 76);
});

test('readNameTokens: a plain name, no circles: text alone, style none', async () => {
	const img = blank(200, 60);
	text(img, 'PLC', 20, 15, 6);
	const t = await readNameTokens(img, fakeEngine());
	assert.deepEqual(t.map(x => [x.kind, x.text]), [['text', 'PLC']]);
	assert.equal(parseName(t).style, 'none');
});
