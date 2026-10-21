import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compactGameMaster, formsOf, dexIndex, isCompactGm } from '../src/core/gm.js';
import { compactText } from '../src/core/text.js';
import { syntheticGameMaster, syntheticText, CPM } from './synthetic.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('compacts species, forms, size bounds and coefficients', () => {
	const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
	assert.equal(Object.keys(gm.species).length, 3);
	assert.deepEqual(Object.keys(gm.species.TESTMON.f).sort(), ['', 'GIANT'], 'costume equal to base is dropped');
	assert.deepEqual(gm.species.TESTMON.f[''], [1.0, 20.0, 2.5, 1.75, 150, 120, 140, 'NORMAL', 1.5, 0.5]);
	assert.deepEqual(gm.species.TESTMON.f.GIANT, [2.0, 50.0, 6.25, 3.1, 200, 150, 160, 'NORMAL/FLYING', 3.0, 0.9]);
	// no weightStdDev → w/8; no EXTENDED template → 1.75 / 1.5 / 0.5 × height
	assert.deepEqual(gm.species.FAKEON.f[''], [0.5, 8.0, 1.0, 0.875, 100, 100, 100, 'WATER', 0.75, 0.25]);
	assert.equal(gm.species.MR_FAKE.dex, 9003);
	// size showcases the game knows (contest limits of the POKEMON_SIZE metric), once each
	assert.deepEqual(gm.coef, { h: 800, w: 150, iv: 50, xxlAdj: 1, xxlBonus: 178, rankings: ['MAX'] });
	assert.deepEqual(gm.cpm, CPM);
	assert.ok(isCompactGm(gm));
});

test('refuses too few species (format guard)', () => {
	assert.throws(() => compactGameMaster(syntheticGameMaster()), /only 3 species/);
});

test('forms and dex lookup', () => {
	const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
	assert.deepEqual(formsOf(gm, 'TESTMON').map(f => f.form), ['', 'GIANT']);
	assert.deepEqual(dexIndex(gm).get(9002), ['FAKEON']);
});

function haveJq() {
	try { execFileSync('jq', ['--version']); return true; } catch { return false; }
}

test('tools/build-gm.sh writes the same as the JS compaction', { skip: !haveJq() && 'jq not installed' }, () => {
	const dir = mkdtempSync(join(tmpdir(), 'xxl-gm-'));
	try {
		writeFileSync(join(dir, 'latest.json'), JSON.stringify(syntheticGameMaster()));
		writeFileSync(join(dir, 'i18n_english.json'), JSON.stringify(syntheticText('en')));
		writeFileSync(join(dir, 'i18n_german.json'), JSON.stringify(syntheticText('de')));
		execFileSync('bash', [join(root, 'tools/build-gm.sh'), '-o', join(dir, 'gm.json'), '-l', 'en,de',
			'-g', join(dir, 'latest.json'), '-t', dir], { env: { ...process.env, MIN_SPECIES: '1' }, stdio: 'pipe' });
		const sh = JSON.parse(readFileSync(join(dir, 'gm.json'), 'utf8'));
		const js = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
		for (const k of ['v', 'coef', 'cpm', 'species']) assert.deepEqual(sh[k], js[k], k);
		assert.deepEqual(sh.text.en, compactText(syntheticText('en')));
		assert.deepEqual(sh.text.de, compactText(syntheticText('de')));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
