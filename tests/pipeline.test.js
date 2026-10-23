// One screenshot → readings, with a fake engine in place of tesseract.js: canned word lists and
// line reads on drawn images. What is tested is what readScreenshot does with the engine's
// answers (which crop is read, which reading wins), not the text recognition itself, which only
// the local screenshot tests (fixtures.test.js) run. No game art: the images are drawn here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tesseractEngine, readScreenshot } from '../src/core/pipeline.js';
import { HP_BAR_X0, pam } from '../src/core/image.js';
import { makeRules } from '../src/core/read.js';
import { compactText } from '../src/core/text.js';
import { syntheticText } from './synthetic.js';

const en = makeRules(compactText(syntheticText('en')));
const W = 600;

function canvas(W, H, rgb = [250, 250, 250]) {
	const data = new Uint8ClampedArray(W * H * 4);
	for (let i = 0; i < data.length; i += 4) { data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255; }
	const rect = (x0, y0, w, h, c) => {
		for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * W + x) * 4; data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; }
	};
	return { img: { width: W, height: H, data }, rect };
}

/**
 * A screenshot 600 px wide, drawn: the CP over a dark photo (three white digits unless cp is
 * false), the HP bar ('plain' at 0.98 W, 'lucky' at 1.03 W under a line of green "LUCKY
 * POKÉMON" letters, or none), the catch year pill, the appraisal's three bars starting at row
 * `bars`, and with `tags` a row of tag pills under the HP line and the weight's dark text one
 * row lower (otherwise no weight text is drawn).
 */
function screen({ H = 1300, cp = true, bar = 'plain', pill = false, bars = null, tags = false } = {}) {
	const { img, rect } = canvas(W, H);
	rect(180, 60, 240, 66, [40, 60, 90]);
	if (cp) for (const x of [230, 260, 290]) rect(x, 75, 20, 40, [255, 255, 255]);
	if (bar) {
		const x0 = Math.round(W * HP_BAR_X0), y = Math.round(W * (bar === 'lucky' ? 1.03 : 0.98));
		rect(x0, y, Math.round(W * 0.49), 8, [140, 225, 178]);
		if (bar === 'lucky') for (let x = 0.36 * W; x < 0.64 * W; x += 0.03 * W) rect(Math.round(x), y - 26, 9, 12, [110, 200, 150]);
		if (tags) {
			rect(200, y + 54, 90, 30, [170, 90, 200]);
			rect(310, y + 54, 90, 30, [90, 180, 90]);
			for (let x = 60; x < 160; x += 20) rect(x, y + 162, 12, 22, [70, 80, 85]);
		}
	}
	if (pill) {
		rect(450, 470, 140, 70, [255, 188, 90]);
		rect(520, 490, 40, 10, [255, 255, 255]);
	}
	if (bars != null) {
		const seg = Math.round(W * 0.1), x0 = Math.round(W * 0.08);
		[15, 7, 10].forEach((iv, b) => {
			for (let s = 0; s < 3; s++) {
				const filled = Math.round(seg * Math.max(0, Math.min(5, iv - 5 * s)) / 5);
				rect(x0 + s * (seg + 4), bars + b * 40, filled, 12, [240, 150, 40]);
				rect(x0 + s * (seg + 4) + filled, bars + b * 40, seg - filled, 12, [215, 215, 215]);
			}
		});
	}
	return img;
}

const word = (text, x) => ({ text, bbox: { x0: x - 20, y0: 0, x1: x + 20, y1: 10 } });
const caughtLine = (date = '6/20/2026') => `This Testmon was caught on ${date} around Somewhere.`.split(' ').map(t => word(t, 300));

// What each line read is for, by its character whitelist: the whitelists are part of how a
// crop is read, so a changed one fails here rather than passing unnoticed.
const KIND = {
	'CP0123456789': 'cp', '0123456789': 'cpDigits', '': 'name', '0123456789/': 'pill', 'XSL': 'badge',
	'0123456789.,/ HP': 'hp', '0123456789.,kg': 'weight', '0123456789.,m': 'height', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ/ ': 'types',
};

/** An engine with canned answers: `words` for the whole screenshot, `lines[kind]` in call order ('' once used up). */
function fakeEngine(words, lines = {}) {
	const calls = [];
	return {
		calls,
		count: kind => calls.filter(c => c.kind === kind).length,
		async words(source) { calls.push({ kind: 'words', source }); return words; },
		async line(img, whitelist, psm = '7') {
			const kind = KIND[whitelist];
			assert.ok(kind, `unexpected whitelist ${JSON.stringify(whitelist)}`);
			calls.push({ kind, img, psm });
			return (lines[kind] || []).shift() ?? '';
		},
	};
}

async function read(img, engine) {
	const r = await readScreenshot(img, 'the file', engine, en);
	assert.equal(typeof r.ms, 'number');
	delete r.ms;
	return r;
}

test('tesseractEngine: the words of the screenshot with their boxes, a line from the encoded crop', async () => {
	const calls = [];
	const box = x => ({ x0: x, y0: 0, x1: x + 10, y1: 10 });
	const worker = {
		async setParameters(p) { calls.push(['set', p]); },
		async recognize(input, opts, output) {
			calls.push(['recognize', input, opts, output]);
			if (input === 'page') {
				return { data: { blocks: [
					{ paragraphs: [{ lines: [{ words: [{ text: 'This', bbox: box(0), confidence: 91 }, { text: 'Testmon', bbox: box(20) }] }, { words: [{ text: '60', bbox: box(40) }] }] }] },
					{ paragraphs: [{ lines: [{ words: [{ text: 'HP', bbox: box(60) }] }] }] },
				] } };
			}
			if (input === 'blank') return { data: { text: '' } };
			return { data: { text: `${input.width}x${input.height}\n` } };
		},
	};
	// stands in for a canvas (browser) or a PNG (Node)
	const encode = async img => ({ width: img.width, height: img.height });
	const e = tesseractEngine(worker, encode);

	assert.deepEqual(await e.words('page'), [
		{ text: 'This', bbox: box(0) }, { text: 'Testmon', bbox: box(20) }, { text: '60', bbox: box(40) }, { text: 'HP', bbox: box(60) },
	], 'all blocks, paragraphs and lines, in reading order');
	assert.deepEqual(calls[0], ['set', { tessedit_pageseg_mode: '11', tessedit_char_whitelist: '', tessedit_do_invert: '0' }], 'sparse text, no whitelist left over, no inverted try');
	assert.deepEqual(calls[1].slice(1), ['page', {}, { text: true, blocks: true }], 'the original image, with word boxes');
	assert.deepEqual(await e.words('blank'), [], 'nothing recognised');

	calls.length = 0;
	const px = { width: 3, height: 2, data: new Uint8ClampedArray(24) };
	assert.equal(await e.line(px, '0123'), '3x2\n');
	assert.deepEqual(calls[0], ['set', { tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123', tessedit_do_invert: '1' }], 'single line by default, inverted tries back on');
	assert.deepEqual(calls[1][1], { width: 3, height: 2 }, 'the encoded crop, not the raw pixels');
	await e.line(px, '0123456789/', '6');
	assert.equal(calls[2][1].tessedit_pageseg_mode, '6');
});

test('pam: the crop\'s pixels as they are, after a header the engine can\'t take for an orientation', () => {
	const px = { width: 3, height: 2, data: Uint8ClampedArray.from({ length: 24 }, (_, i) => i * 10) };
	const b = pam(px);
	assert.ok(b instanceof Uint8Array);
	const end = new TextDecoder().decode(b).indexOf('ENDHDR\n') + 7;
	const head = new TextDecoder().decode(b.subarray(0, end));
	assert.match(head, /^P7\n# -+\nWIDTH 3\nHEIGHT 2\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n$/);
	assert.deepEqual([...b.subarray(end)], [...px.data], 'RGBA, row by row, nothing changed');
	// tesseract.js looks for an EXIF orientation tag ("1 18 0 3 0 0 0 1 0 n") in the first 500
	// bytes of what it is given: here they are header text only, never pixels
	assert.ok(end > 500);
	assert.ok([...b.subarray(0, 500)].every(c => c === 10 || (c >= 32 && c < 127)));
});

test('a plain card: crop readings of the exact shape replace the whole-screenshot ones', async () => {
	const engine = fakeEngine([
		...caughtLine(), word('60', 300), word('/', 300), word('60', 300), word('HP', 300),
		word('22.3', 100), word('079m', 500), word('DARK', 250), word('NORMAL', 350),
	], {
		cp: ['CP217'], cpDigits: ['217', '2174'],
		name: ['Testmon #'],
		hp: ['60 /', '60 / 60'],
		badge: ['XXL'],
		weight: ['22.38kg'],
		height: ['079m', '0.79m'],
	});
	assert.deepEqual(await read(screen(), engine), {
		species: 'Testmon', caught: '6/20/2026', hp: 60, weight_kg: 22.38, height_m: 0.79, types: ['DARK', 'NORMAL'],
		cp: 217, cpAlt: [2174], bars: null, name: 'Testmon', caughtPill: null, lucky: false, badge: 'XXL',
	});
	assert.equal(engine.calls[0].source, 'the file', 'the whole screenshot is read from the original');
	assert.equal(engine.count('cpDigits'), 2, 'the digits alone, at two thresholds');
	assert.equal(engine.count('hp'), 2, 'next threshold until the HP has its shape (label cut off is fine)');
	assert.equal(engine.count('weight'), 1, 'a weight with its point: no more tries');
	assert.equal(engine.count('height'), 2, '"079m" lost its point: tried again');
	assert.equal(engine.count('types'), 0, 'both type labels from the whole screenshot');
	assert.equal(engine.count('pill'), 0, 'no year pill on the card');
});

test('a size crop without its point only fills a gap; the badge falls back to the plain crop', async () => {
	const engine = fakeEngine([...caughtLine(), word('1.62m', 500)], {
		cp: ['CP 500'], cpDigits: ['500', '500'],
		badge: ['', 'XL'],
		weight: ['1kg', '1kg', '1kg'],
		height: ['2m', '2m', '2m'],
		types: ['', 'FIRE', 'FIRE /'],
	});
	const r = await read(screen(), engine);
	assert.equal(r.cp, 500);
	assert.equal(r.cpAlt, undefined, 'the same CP read three times: no alternatives');
	assert.equal(r.name, null);
	assert.equal(r.hp, null, 'no HP anywhere');
	assert.equal(engine.count('hp'), 3, 'all three thresholds tried');
	assert.equal(r.weight_kg, 1, '"1kg" is a real weight: better than none');
	assert.equal(r.height_m, 1.62, '"2m" can be what the trainer leaves of 1.62 m: the whole screenshot\'s reading stays');
	assert.equal(engine.count('weight'), 3);
	assert.equal(r.badge, 'XL');
	assert.equal(engine.count('badge'), 2, 'the pill-only crop read nothing, the plain one did');
	assert.deepEqual(r.types, ['FIRE'], 'the try with the most type names, cut-off words not counted');
	assert.equal(engine.count('types'), 3);
});

test('appraisal bars, a lucky Pokémon, a year pill; no CP digits found', async () => {
	const engine = fakeEngine(caughtLine('4/19/2024'), { pill: ['2024\n04/19'], hp: ['97 / 97 HP'] });
	const r = await read(screen({ cp: false, bar: 'lucky', pill: true, bars: 1000 }), engine);
	assert.equal(r.cp, null, 'the CP crop read nothing');
	assert.ok(!('cpAlt' in r));
	assert.equal(engine.count('cpDigits'), 0, 'nothing digit-like over the photo');
	assert.ok(Math.abs(r.bars.a - 15) < 0.2 && Math.abs(r.bars.d - 7) < 0.2 && Math.abs(r.bars.s - 10) < 0.2, JSON.stringify(r.bars));
	assert.equal(r.covered, undefined, 'the bars sit well below the stats row');
	assert.equal(r.lucky, true);
	assert.equal(r.caughtPill, '2024 04/19');
	assert.equal(engine.calls.find(c => c.kind === 'pill').psm, '6', 'two lines in the pill: block mode');
	assert.equal(r.hp, 97);
	assert.equal(engine.count('badge'), 2);
});

test('lucky by the green line above the HP bar, not by where the bar is', async () => {
	const r = await read(screen({ bar: 'lucky' }), fakeEngine([]));
	assert.equal(r.lucky, true);
	// a bar as low as a lucky one on an iPhone, without the line: a phone that lays the card out
	// lower (some Android phones: 1.017 W)
	const { img, rect } = canvas(W, 1300);
	rect(Math.round(W * HP_BAR_X0), Math.round(W * 1.03), Math.round(W * 0.49), 8, [140, 225, 178]);
	assert.equal((await read(img, fakeEngine([]))).lucky, false);
});

test('a lucky Pokémon with the appraisal higher up: the stats row still readable', async () => {
	// bars 0.57 W below a lucky HP bar: 0.39 W below the weight's text, seen on phones whose
	// appraisal sits higher; the medallion stays below the weight
	const engine = fakeEngine([], { weight: ['57.63kg'] });
	const r = await read(screen({ bar: 'lucky', bars: 960 }), engine);
	assert.equal(r.covered, undefined);
	assert.equal(r.weight_kg, 57.63);
});

test('a screenshot cut off at the top: CP looked for higher up, name and year pill moved with the card', async () => {
	const full = screen({ pill: true });
	const cut = 66;	// 0.11 W, about what a status bar is
	const img = { width: W, height: full.height - cut, data: full.data.slice(cut * W * 4) };
	const engine = fakeEngine([], { cp: ['', 'CP217'], cpDigits: ['', '', '217', '217'], pill: ['2024 04/19'] });
	const r = await read(img, engine);
	assert.equal(r.cp, 217);
	const cps = engine.calls.filter(c => c.kind === 'cp');
	assert.equal(cps.length, 2, 'the usual place read nothing: read again where the digits are');
	assert.equal(r.caughtPill, '2024 04/19', 'the pill found where the card puts it');
	// nothing read at the usual place, and no digits anywhere: no second try
	const none = fakeEngine([], {});
	await read(screen({ cp: false }), none);
	assert.equal(none.count('cp'), 1);
});

test('tags under the HP line: the stats row is read one row lower', async () => {
	const black = img => { let n = 0; for (let i = 0; i < img.data.length; i += 4) if (img.data[i] === 0) n++; return n; };
	const tagged = fakeEngine([]);
	await read(screen({ tags: true }), tagged);
	const crop = tagged.calls.find(c => c.kind === 'weight').img;
	// the text sits 0.27 W below the bar; without the shift the crop would end at 0.236 W
	assert.ok(black(crop) > 100, 'the weight\'s text is in the crop');
});

test('a year pill that reads as nothing like a date gives no catch date', async () => {
	const engine = fakeEngine([], { pill: ['2O24'] });
	assert.equal((await read(screen({ pill: true }), engine)).caughtPill, null);
});

test('16:9 with the appraisal: the stats row is covered, only HP is read there', async () => {
	const words = [...caughtLine(), word('21', 300), word('/', 300), word('21', 300), word('HP', 300), word('22.3', 100), word('kg', 500), word('DARK', 300)];
	const engine = fakeEngine(words, { hp: ['131 / 131 H'] });
	const r = await read(screen({ H: 1067, bars: 700 }), engine);
	assert.equal(r.covered, true);
	assert.equal(r.hp, 131, 'from the crop, its label cut off by the trainer');
	assert.equal(r.weight_kg, null, 'fragments next to the medallion are dropped');
	assert.equal(r.height_m, null);
	assert.deepEqual(r.types, []);
	assert.equal(r.species, 'Testmon', 'the "was caught" line still counts');
	assert.ok(r.bars);
	for (const k of ['badge', 'weight', 'height', 'types']) assert.equal(engine.count(k), 0, k);

	const unread = fakeEngine(words, {});
	assert.equal((await read(screen({ H: 1067, bars: 700 }), unread)).hp, 21, 'HP crop unreadable: the whole screenshot\'s HP stays');
});

test('a screen wider than 9:16 (iPad): the card read in its centred column, as on a phone', async () => {
	// the phone screen of the tests, 600 px wide, as the column of a screen 300 px wider on
	// either side; 1067 px tall, so the column is 9:16 and the appraisal covers the stats row
	const phone = screen({ H: 1067, bars: 760, pill: true });
	const pad = 300, wide = canvas(W + 2 * pad, phone.height, [30, 90, 140]);
	for (let y = 0; y < phone.height; y++) {
		wide.img.data.set(phone.data.subarray(y * W * 4, (y + 1) * W * 4), (y * (W + 2 * pad) + pad) * 4);
	}
	// the whole screenshot's words where they are on each screen; "kg" and "m" by position
	const words = dx => [...caughtLine().map(w => ({ ...w, bbox: { ...w.bbox, x0: w.bbox.x0 + dx, x1: w.bbox.x1 + dx } })),
		word('22.38kg', 100 + dx), word('0.79m', 500 + dx), word('DARK', 300 + dx)];
	const lines = () => ({ cp: ['CP217'], name: ['Testmon'], pill: ['2024 04/19'], hp: ['60 / 60 HP'] });
	const onPhone = await read(phone, fakeEngine(words(0), lines()));
	const engine = fakeEngine(words(pad), lines());
	const onWide = await read(wide.img, engine);
	assert.deepEqual(onWide, onPhone);
	assert.equal(onWide.hp, 60);
	assert.equal(onWide.caughtPill, '2024 04/19', 'the pill at the column\'s right edge');
	assert.deepEqual(onWide.bars, { a: 15, d: 7, s: 10 });
	assert.equal(onWide.covered, true, 'the appraisal reaches up into the stats row, as on a 16:9 phone');
	assert.equal(engine.calls.find(c => c.kind === 'cp').img.width, Math.round(W * 0.40), 'CP cut from the column');
});

test('no HP bar found: name and year pill read, nothing positioned from the bar', async () => {
	const engine = fakeEngine([...caughtLine(), word('60', 300), word('/', 300), word('60', 300), word('HP', 300)], { name: ['Testmon'], pill: ['2024 04/19'] });
	const r = await read(screen({ bar: null, pill: true }), engine);
	assert.equal(r.name, 'Testmon');
	assert.equal(r.caughtPill, '2024 04/19');
	assert.equal(r.hp, 60);
	assert.equal(r.lucky, undefined, 'unknown without the bar');
	for (const k of ['hp', 'badge', 'weight', 'height', 'types']) assert.equal(engine.count(k), 0, k);
});
