// Showcase score.
import { ROW, xsMin } from './gm.js';

/**
 * @param {import('./gm.js').Row} row
 * @param {{h: number, w: number, iv: number, xxlBonus: number}} coef
 * @param {number} heightM   as shown in game (2 decimals)
 * @param {number} weightKg  as shown in game (2 decimals)
 * @param {number} ivSum     atk + def + sta IVs, 0..45
 * @param {boolean} isXXL
 */
export function score(row, coef, heightM, weightKg, ivSum, isXXL) {
	const h0 = row[ROW.H], w0 = row[ROW.W], wsd = row[ROW.WSD];
	const K = row[ROW.XXL_MAX] / h0;
	const wDen = K + 4 * wsd / w0;
	const hPart = coef.h * (heightM / h0) / K;
	const wPart = coef.w * (weightKg / w0) / wDen;
	const ivPart = coef.iv * ivSum / 45;
	const bonus = isXXL ? coef.xxlBonus : 0;
	return {
		K,
		hPart, wPart, ivPart, bonus,
		total: hPart + wPart + ivPart + bonus,
		// height and weight are displayed rounded to 0.01
		band: coef.h * 0.005 / h0 / K + coef.w * 0.005 / w0 / wDen,
	};
}

/**
 * XXL from the displayed height: above the XL upper bound means XXL.
 * Returns true / false, or null when the boundary lies within display rounding.
 */
export function isXXLByHeight(row, heightM) {
	const xl = row[ROW.XL_MAX];
	if (heightM - 0.005 > xl) return true;
	if (heightM + 0.005 <= xl) return false;
	return null;
}

/**
 * XXS from the displayed height: below the XS lower bound (half the average height for nearly all
 * species). Returns true / false, or null within display rounding of the boundary.
 */
export function isXXSByHeight(row, heightM) {
	const xs = xsMin(row);
	if (heightM + 0.005 < xs) return true;
	if (heightM - 0.005 >= xs) return false;
	return null;
}

/**
 * Showcase modes. Both rank the same POKEMON_SIZE score, as the game master's contest
 * settings describe a size showcase: a metric plus a ranking standard, MAX for the biggest. A
 * smallest-size showcase would be the same metric with MIN: the lowest score wins. No such
 * showcase has run since the formula was worked out, so XXS mode is an assumption until an
 * in-game score says otherwise.
 */
/**
 * The score a row counts with: the one shown in game when the user entered it (the game's own
 * number beats a computed one, within its ± band or not), else the computed total; null without
 * either. The list's order, a "score" search and the copied nickname all use it.
 */
export const rowScore = e => e.inGame ?? (e.score ? e.score.total : null);

export const MODES = Object.freeze({
	xxl: { ranking: 'MAX', label: 'Biggest (XXL)', best: -1 },
	xxs: { ranking: 'MIN', label: 'Smallest (XXS)', best: 1 },
});
