// One screenshot → readings. Shared by the browser (src/ui/ocr.js) and the local tests.
import { findBars } from './bars.js';
import { REGIONS, boxOf, crop, thresholdWhiteText, thresholdDarkText, badgeText, findHpBar, statsBoxes, dropEdgeBlobs, cpDigits, isSlid, isLucky, yearPillText } from './image.js';
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
			await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: '' });
			const { data } = await worker.recognize(input, {}, { text: true, blocks: true });
			const out = [];
			for (const b of data.blocks || []) {
				for (const p of b.paragraphs) for (const l of p.lines) for (const w of l.words) out.push({ text: w.text, bbox: w.bbox });
			}
			return out;
		},
		async line(img, whitelist, psm = '7') {
			await worker.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: whitelist });
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
	const words = await engine.words(source);
	const readings = parseWords(words, img.width, rules);
	await readCp(img, engine, readings);
	const bars = findBars(img);
	readings.bars = bars ? bars.ivs : null;
	await readCard(img, engine, rules, readings, bars);
	readings.ms = Date.now() - t0;
	return readings;
}

/**
 * CP: white digits over the photo, so whatever bright is behind them gets in the way (bokeh, a
 * planet, the sprite). Read three ways: the thresholded crop as a whole, and its digits alone
 * (cpDigits) at two thresholds. The first is `cp`, the others that differ go to `cpAlt`; the bars
 * and HP pick the right one later (evaluate.js), as for the CPs of merged screenshots.
 */
async function readCp(img, engine, readings) {
	const c = crop(img, boxOf(img, REGIONS.cp));
	const reads = [];
	const add = v => { if (v != null && !reads.includes(v)) reads.push(v); };
	const t = thresholdWhiteText(c);
	add(parseCp(await engine.line(t, 'CP0123456789')));
	for (const px of [t, thresholdWhiteText(c, 200)]) {
		const d = cpDigits(px);
		if (d) add(parseCp(await engine.line(d, '0123456789')));
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
 * Also: the XXL/XL/XS/XXS badge above the height, "LUCKY POKÉMON" (`lucky`), and whether the
 * card is shifted sideways (a screenshot taken while swiping between two Pokémon: `slid`).
 * On a 16:9 screen the appraisal covers the stats row (`covered`): then only HP is read there.
 */
async function readCard(img, engine, rules, readings, bars) {
	const W = img.width;
	const bar = findHpBar(img);
	readings.slid = !!bar && isSlid(bar, W, !!bars);
	if (readings.slid) return;
	// the name: the species when the Pokémon has no nickname (resolved against the game's names
	// later, evaluate.js); a nickname is kept as read, for comparing screenshots
	readings.name = parseName(await engine.line(crop(img, boxOf(img, REGIONS.name)), ''));
	// the catch year pill, for Pokémon caught in an earlier year: a catch date on screenshots
	// without the "was caught" line
	const pill = yearPillText(crop(img, boxOf(img, REGIONS.year)));
	readings.caughtPill = pill ? parseYearPill(await engine.line(pill, '0123456789/', '6')) : null;
	if (!bar) return;
	readings.lucky = isLucky(bar, W);
	// The appraisal (bottom-anchored) reaches up into the stats row when its bars sit less than
	// 0.6 W below the HP bar: 0.26-0.31 W on an iPhone 8 (16:9), 0.71 W on an iPhone 17 Pro.
	// The star medallion, the bar panel and the trainer then cover weight, types and height; a
	// reading there would be a fragment ("kg" next to the medallion).
	const covered = !!bars && (bars.y[0] - bar.y) / W < 0.6;
	const box = statsBoxes(img, bar);
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
