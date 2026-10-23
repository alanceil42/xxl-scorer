// One screenshot → readings. Shared by the browser (src/ui/ocr.js) and the local tests.
import { findBars } from './bars.js';
import { REGIONS, boxOf, crop, thresholdWhiteText, thresholdDarkText, badgeText, findHpBar, statsBoxes, dropEdgeBlobs, cpDigits, isLucky, cardOffset, statsShift, findCpBox, yearPillText, cardColumn, columnOf } from './image.js';
import { parseWords, parseCp, parseCrops, parseTypes, parseName, parseYearPill } from './read.js';

/**
 * Adapter around a tesseract.js worker.
 * @param {object} worker   tesseract.js worker (one at a time: calls are sequential)
 * @param {(img: {width: number, height: number, data: Uint8ClampedArray}) => Promise<any>} encode
 *        turns pixels into something worker.recognize accepts (canvas/Blob in the browser, PNG in Node)
 */
export function tesseractEngine(worker, encode) {
	return {
		async words(input) {
			// No inverted second try for the whole screenshot. Tesseract reads a line
			// again inverted when it is unsure (light text on dark); the info card is dark on
			// light, and the white text over the photo (CP) is read from its own crop.
			await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '', tessedit_do_invert: '0' });
			const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
			const out = [];
			for (const b of data.blocks || []) {
				for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) out.push({ text: w.text, bbox: w.bbox });
			}
			return out;
		},
		async line(img, whitelist, psm = '7') {
			await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist, tessedit_do_invert: '1' });
			const { data } = await worker.recognize(await encode(img));
			return data.text;
		},
	};
}

/**
 * @param {{width: number, height: number, data: Uint8ClampedArray}} img  decoded screenshot, RGBA
 * @param {any} source  the original image for full-page OCR (File/Blob in the browser, Buffer in Node)
 * @param {ReturnType<typeof tesseractEngine>} engine
 * @param {ReturnType<import('./read.js').makeRules>} rules
 */
export async function readScreenshot(img, source, engine, rules) {
	const t0 = Date.now();
	// The card is read in its column (an iPad's is narrower than the screen), the whole
	// screenshot as it is: the "was caught" line runs wider than the column there.
	const { x, w } = cardColumn(img.width, img.height);
	const col = columnOf(img);
	const words = (await engine.words(source)).map(wd => (x ? { ...wd, bbox: shift(wd.bbox, -x) } : wd));
	const readings = parseWords(words, w, rules);
	const bar = findHpBar(col);
	const lucky = bar ? isLucky(col, bar) : false;
	const dy = bar ? cardOffset(col, bar, lucky) : 0;
	await readCp(col, engine, readings, dy);
	const bars = findBars(img, w);
	readings.bars = bars ? bars.ivs : null;
	await readCard(col, engine, rules, readings, bars, bar, lucky, dy);
	readings.ms = Date.now() - t0;
	return readings;
}

const shift = (b, dx) => ({ ...b, x0: b.x0 + dx, x1: b.x1 + dx });

/**
 * CP: white digits over the photo, so whatever bright is behind them gets in the way (bokeh, a
 * planet, the sprite). Read three ways: the thresholded crop as a whole, and its digits alone
 * (cpDigits) at two thresholds. The first is `cp`, the others that differ go to `cpAlt`; the bars
 * and HP pick the right one later (evaluate.js), as for the CPs of merged screenshots.
 */
async function readCp(img, engine, readings, dy) {
	const reads = [];
	const add = v => { if (v != null && !reads.includes(v)) reads.push(v); };
	const readAt = async box => {
		const c = crop(img, box);
		const t = thresholdWhiteText(c);
		add(parseCp(await engine.line(t, 'CP0123456789')));
		for (const px of [t, thresholdWhiteText(c, 200)]) {
			const d = cpDigits(px);
			if (d) add(parseCp(await engine.line(d, '0123456789')));
		}
	};
	const box = boxOf(img, REGIONS.cp);
	await readAt(box);
	// The CP sits where the top of the screen puts it, which is not always where it is on an
	// uncut iPhone screenshot: players cut the status bar off before posting, some phones have a
	// taller one. Nothing read: look for the digits (findCpBox), else move the crop as far as
	// the card is off its place (cut off at the top, both move up alike).
	if (!reads.length) {
		const found = findCpBox(img);
		if (found && Math.abs(found.y - box.y) > 0.01 * img.width) await readAt(found);
		else if (Math.abs(dy) > 0.02 * img.width) await readAt(boxOf(img, REGIONS.cp, dy));
	}
	readings.cp = reads[0] ?? null;
	if (reads.length > 1) readings.cpAlt = reads.slice(1);
}

/**
 * A second, closer look at the info card: name, catch year pill, and the stats row (HP, weight
 * and height cropped one by one, positioned from the HP bar). The whole-screenshot pass misses
 * about one weight in five on appraisal screenshots (the darkened card) and reads "1kg" or
 * "2.51m" badly; the crops don't. Each crop reading replaces the whole-screenshot one only when
 * it has the exact expected shape.
 * Also: the XXL/XL/XS/XXS badge above the height and "LUCKY POKÉMON" (`lucky`).
 * On a 16:9 screen the appraisal covers the stats row (`covered`): then only HP is read there.
 */
async function readCard(img, engine, rules, readings, bars, bar, lucky, dy) {
	const W = img.width;
	// the name: the species when the Pokémon has no nickname (resolved against the game's names
	// later, evaluate.js); a nickname is kept as read, for comparing screenshots. Name and year
	// pill are on the card, so they move with it (cardOffset).
	readings.name = parseName(await engine.line(crop(img, boxOf(img, REGIONS.name, dy)), ''));
	// the catch year pill, for Pokémon caught in an earlier year: a catch date on screenshots
	// without the "was caught" line
	const pill = yearPillText(crop(img, boxOf(img, REGIONS.year, dy)));
	readings.caughtPill = pill ? parseYearPill(await engine.line(pill, '0123456789/', '6')) : null;
	if (!bar) return;
	readings.lucky = lucky;
	// Tags under the HP line push the stats row down (statsShift).
	const shift = statsShift(img, bar);
	// The appraisal (bottom-anchored) reaches up into the stats row when its bars sit less than
	// 0.33 W below the top of the weight's text: 0.1 W on an iPhone 8 (16:9), 0.52 W on an iPhone
	// 17 Pro, 0.41 W on phones whose appraisal sits higher, 0.17-0.29 W on those with tags. The
	// star medallion, the bar panel and the trainer then cover weight, types and height; a reading
	// there would be a fragment ("kg" next to the medallion).
	const covered = !!bars && (bars.y[0] - bar.y - shift) / W - 0.178 < 0.33;
	const box = statsBoxes(img, bar, shift);
	const digits = '0123456789.,';
	const letters = s => [...new Set(s)].join('');
	// HP: grey text; the appraisal's tint lightens the card (Instinct) or darkens it (Mystic), so
	// a few thresholds, the first reading of the right shape wins. The trainer's hair reaches into
	// the line on a 16:9 screen: dropEdgeBlobs.
	const t = {};
	for (const level of [140, 185, 110]) {
		t.hp = await engine.line(dropEdgeBlobs(thresholdDarkText(crop(img, box.hp), level)), `${digits}/ ${letters(rules.hpLabel)}`);
		if (parseCrops({ hp: t.hp }, rules).hp != null) break;
	}
	if (!covered) t.badge = await engine.line(badgeText(crop(img, box.badge)), 'XSL');
	// Sizes: the decimal point is the character most often lost ("685m" for 6.85 m, "046m"),
	// and which threshold keeps it varies with the card's tint. Try a few; a reading with the
	// point wins.
	const sizeOf = async (k, unit) => {
		const wl = digits + letters(unit);
		const tries = [px => thresholdDarkText(px), px => thresholdDarkText(px, 100), px => px];
		let first = null;
		for (const f of tries) {
			const txt = await engine.line(f(crop(img, box[k])), wl);
			const v = parseCrops({ [k]: txt }, rules)[k === 'weight' ? 'weight_kg' : 'height_m'];
			if (v == null) continue;
			if (/[.,]/.test(txt)) return { v, sure: true };
			if (first == null) first = v;
		}
		return first == null ? null : { v: first, sure: false };
	};
	if (covered) {
		const c = parseCrops({ hp: t.hp }, rules);
		if (c.hp != null) readings.hp = c.hp;
		readings.weight_kg = readings.height_m = null;
		readings.types = [];
		readings.covered = true;
		return;
	}
	let c = parseCrops(t, rules);
	if (c.badge == null) {
		t.badge = await engine.line(crop(img, box.badge), 'XSL');
		c = parseCrops(t, rules);
	}
	if (c.hp != null) readings.hp = c.hp;
	for (const [k, key, unit] of [['weight', 'weight_kg', rules.kg], ['height', 'height_m', rules.m]]) {
		const r = await sizeOf(k, unit);
		// without its point a crop reading is only better than nothing: "1kg" is a real
		// weight, but "2m" can be what the trainer's hair leaves of 1.62 m
		if (r && (r.sure || readings[key] == null)) readings[key] = r.v;
	}
	readings.badge = c.badge;
	// Type labels: light grey, on a white card (plain crop reads best) or on the appraisal's
	// darkened one (thresholded reads best). The try with the most type names wins.
	if (readings.types.length < 2) {
		for (const f of [px => px, px => thresholdDarkText(px), px => thresholdDarkText(px, 170)]) {
			const ty = parseTypes(await engine.line(f(crop(img, box.types)), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ/ '));
			if (ty.length > readings.types.length) readings.types = ty;
			if (readings.types.length === 2) break;
		}
	}
}
