// Evaluated rows, kept for as long as their inputs live. The list evaluates every row on every
// sort, keystroke in the search and tap, and the batch looks for duplicates among all rows for
// every new screenshot; evaluate() costs a fraction of a millisecond per row, which adds up to
// seconds over a batch and to most of a redraw on a phone.
import { evaluateSafely } from '../core/evaluate.js';

/** The edits of a row stored without any (older versions): one object for all such rows. */
export const NO_EDITS = Object.freeze({});

const cache = new WeakMap();	// game data context → reading → edits → evaluateSafely's result

/**
 * evaluateSafely(reading, ctx, edits), computed once per (ctx, reading, edits), by identity.
 * Correct only because readings and edits are never changed in place: a merge, an edit, a
 * replacement or an import makes new objects (tests/immutable.test.js). New game data makes a
 * new context. The result is shared by all callers, so it must not be changed either.
 */
export function evaluateRow(reading, ctx, edits) {
	if (edits === undefined) edits = NO_EDITS;
	// whatever can't be a key (no game data, a reading or edits that aren't objects) is
	// evaluated as before, every time
	if (!ctx || !isObject(reading) || !isObject(edits)) return evaluateSafely(reading, ctx, edits);
	let byReading = cache.get(ctx);
	if (!byReading) cache.set(ctx, (byReading = new WeakMap()));
	let byEdits = byReading.get(reading);
	if (!byEdits) byReading.set(reading, (byEdits = new WeakMap()));
	let e = byEdits.get(edits);
	if (!e) byEdits.set(edits, (e = evaluateSafely(reading, ctx, edits)));
	return e;
}

const isObject = x => x !== null && typeof x === 'object';
