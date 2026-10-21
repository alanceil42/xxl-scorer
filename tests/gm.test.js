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
	assert.deepEqual(formsOf(gm, 'NOSUCHMON'), [], 'a species the game data does not have');
});

/**
 * The game master's odd corners: a species listed only by its forms (NORMAL instead of a base
 * entry), templates without the numbers needed, stats left out, no contest settings.
 */
function edgeGameMaster() {
	const mon = (tid, p) => ({ templateId: tid, data: { pokemonSettings: { pokedexHeightM: 1.2, pokedexWeightKg: 30, type: 'POKEMON_TYPE_ROCK', stats: { baseAttack: 120, baseDefense: 110, baseStamina: 130 }, ...p } } });
	return [
		mon('V9004_POKEMON_EDGEMON_NORMAL', { pokemonId: 'EDGEMON', form: 'EDGEMON_NORMAL' }),
		mon('V9004_POKEMON_EDGEMON_COSTUME', { pokemonId: 'EDGEMON', form: 'EDGEMON_COSTUME' }),
		mon('V9004_POKEMON_EDGEMON_ZETA', { pokemonId: 'EDGEMON', form: 'EDGEMON_ZETA', pokedexHeightM: 1.4 }),
		mon('V9004_POKEMON_EDGEMON_ALPHA', { pokemonId: 'EDGEMON', form: 'EDGEMON_ALPHA', pokedexHeightM: 1.3 }),
		mon('V9005_POKEMON_STATLESS', { pokemonId: 'STATLESS', stats: { baseAttack: 90 } }),
		mon('V9006_POKEMON_NOHEIGHT', { pokemonId: 'NOHEIGHT', pokedexHeightM: undefined }),
		mon('V9007_POKEMON_NOSTATS', { pokemonId: 'NOSTATS', stats: undefined }),
		{ templateId: 'V9008_POKEMON_NOSETTINGS', data: {} },
		mon('X9009_POKEMON_NOTAMON', { pokemonId: 'NOTAMON' }),
		{ templateId: 'PLAYER_LEVEL_SETTINGS', data: { playerLevel: { cpMultiplier: CPM } } },
	];
}

test('a species listed only by its forms: NORMAL stands in for the base, its costume is dropped', () => {
	const gm = compactGameMaster(edgeGameMaster(), { minSpecies: 1 });
	assert.deepEqual(Object.keys(gm.species.EDGEMON.f).sort(), ['ALPHA', 'NORMAL', 'ZETA']);
	assert.deepEqual(formsOf(gm, 'EDGEMON').map(f => f.form), ['ALPHA', 'NORMAL', 'ZETA'], 'no base entry: forms by name');
	assert.equal(gm.species.EDGEMON.dex, 9004);
});

test('templates without height, weight or attack are skipped; missing defence and stamina are 0', () => {
	const gm = compactGameMaster(edgeGameMaster(), { minSpecies: 1 });
	assert.deepEqual(Object.keys(gm.species).sort(), ['EDGEMON', 'STATLESS']);
	assert.deepEqual(gm.species.STATLESS.f[''].slice(4, 8), [90, 0, 0, 'ROCK']);
});

test('no contest settings: the known coefficients, no size showcases', () => {
	const gm = compactGameMaster(edgeGameMaster(), { minSpecies: 1, now: '2026-10-21T00:00:00Z', source: { url: 'local', etag: 'x' } });
	assert.deepEqual(gm.coef, { h: 800, w: 150, iv: 50, xxlAdj: 1, xxlBonus: 178, rankings: [] });
	assert.equal(gm.generated, '2026-10-21T00:00:00Z');
	assert.deepEqual(gm.source, { url: 'local', etag: 'x' });
});

test('not a game master: refused', () => {
	assert.throws(() => compactGameMaster({ templates: [] }), /expected a JSON array/);
	assert.throws(() => compactGameMaster(edgeGameMaster().slice(0, -1), { minSpecies: 1 }), /PLAYER_LEVEL_SETTINGS missing/);
});

test('a compact file from storage or a server: shape check', () => {
	const gm = compactGameMaster(syntheticGameMaster(), { minSpecies: 1 });
	assert.ok(isCompactGm(gm));
	for (const bad of [null, {}, { ...gm, v: 2 }, { ...gm, coef: null }, { ...gm, cpm: gm.cpm.slice(0, 49) }, { ...gm, species: 'x' }]) {
		assert.equal(isCompactGm(bad), false, JSON.stringify(bad)?.slice(0, 40));
	}
});

function haveJq() {
	try { execFileSync('jq', ['--version']); return true; } catch { return false; }
}

test('tools/build-gm.sh writes the same as the JS compaction', { skip: !haveJq() && 'jq not installed' }, () => {
	const dir = mkdtempSync(join(tmpdir(), 'xxl-gm-'));
	try {
		// the odd corners first, without text tables
		writeFileSync(join(dir, 'edge.json'), JSON.stringify(edgeGameMaster()));
		execFileSync('bash', [join(root, 'tools/build-gm.sh'), '-o', join(dir, 'edge-gm.json'), '-g', join(dir, 'edge.json')],
			{ env: { ...process.env, MIN_SPECIES: '1' }, stdio: 'pipe' });
		const edgeSh = JSON.parse(readFileSync(join(dir, 'edge-gm.json'), 'utf8'));
		const edgeJs = compactGameMaster(edgeGameMaster(), { minSpecies: 1 });
		for (const k of ['v', 'coef', 'cpm', 'species']) assert.deepEqual(edgeSh[k], edgeJs[k], `edge: ${k}`);

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
