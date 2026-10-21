// Made-up game data in the real file structure. No game data in the repo.

/** CP multipliers: increasing, made-up. 60 whole levels. */
export const CPM = Array.from({ length: 60 }, (_, i) => Math.round((0.1 + 0.0125 * i) * 1e8) / 1e8);

const mon = (dex, id, form, h, w, stats, types, extra = {}) => ({
	templateId: `V${String(dex).padStart(4, '0')}_POKEMON_${form || id}`,
	data: {
		pokemonSettings: {
			pokemonId: id,
			...(form ? { form } : {}),
			type: `POKEMON_TYPE_${types[0]}`,
			...(types[1] ? { type2: `POKEMON_TYPE_${types[1]}` } : {}),
			stats: { baseAttack: stats[0], baseDefense: stats[1], baseStamina: stats[2] },
			pokedexHeightM: h,
			pokedexWeightKg: w,
			...extra,
		},
	},
});

const ext = (dex, id, form, xl, xxl, xs) => ({
	templateId: `EXTENDED_V${String(dex).padStart(4, '0')}_POKEMON_${form || id}`,
	data: { pokemonExtendedSettings: { uniqueId: id, ...(form ? { form } : {}), sizeSettings: { ...(xs ? { xsLowerBound: xs } : {}), xlUpperBound: xl, xxlUpperBound: xxl } } },
});

/** A synthetic latest.json: three species, forms, a costume to drop, size bounds, levels, coefficients. */
export function syntheticGameMaster() {
	return [
		{ templateId: 'SOME_OTHER_SETTINGS', data: { other: true } },
		mon(9001, 'TESTMON', null, 1.0, 20.0, [150, 120, 140], ['NORMAL'], { weightStdDev: 2.5 }),
		mon(9001, 'TESTMON', 'TESTMON_COSTUME', 1.0, 20.0, [150, 120, 140], ['NORMAL'], { weightStdDev: 2.5 }),
		mon(9001, 'TESTMON', 'TESTMON_GIANT', 2.0, 50.0, [200, 150, 160], ['NORMAL', 'FLYING'], { weightStdDev: 6.25 }),
		mon(9002, 'FAKEON', null, 0.5, 8.0, [100, 100, 100], ['WATER']),
		mon(9003, 'MR_FAKE', null, 1.3, 55.0, [180, 170, 120], ['PSYCHIC', 'FAIRY']),
		ext(9001, 'TESTMON', null, 1.5, 1.75),
		ext(9001, 'TESTMON', 'TESTMON_GIANT', 3.0, 3.1, 0.9),
		ext(9003, 'MR_FAKE', null, 1.95, 2.6),
		{ templateId: 'PLAYER_LEVEL_SETTINGS', data: { playerLevel: { cpMultiplier: CPM } } },
		{
			templateId: 'CONTEST_SETTINGS',
			data: { contestSettings: {
				contestLimits: [
					{ contestMetric: { pokemonMetric: 'POKEMON_SIZE', rankingStandard: 'MAX' }, contestOccurrence: 'DAILY', perContestMaxEntries: 150 },
					{ contestMetric: { pokemonMetric: 'POKEMON_SIZE', rankingStandard: 'MAX' }, contestOccurrence: 'HOURLY', perContestMaxEntries: 20 },
					{ contestMetric: { pokemonMetric: 'POKEMON_OTHER', rankingStandard: 'MIN' } },
				],
				contestScoreCoefficient: [{ pokemonSize: { heightCoefficient: 800, weightCoefficient: 150, ivCoefficient: 50, xxlAdjustmentFactor: 1 } }],
			} },
		},
	];
}

/** A synthetic i18n_<language>.json: flat key/value list. */
export function syntheticText(lang = 'en') {
	const de = lang === 'de';
	const kv = [
		['pokemon_name_9001', 'Testmon'],
		['pokemon_name_9002', 'Fakeon'],
		['pokemon_name_9003', 'Mr. Fake'],
		['appraise_v2_caught', de ? 'Dieses {0} wurde am {1} in der Nähe von {2} gefangen.' : 'This {0} was caught on {1} around {2}.'],
		['appraise_v2_date_uncached_loc', de ? 'Dieses {0} wurde am {1} gefangen.' : 'This {0} was caught on {1}'],
		['appraise_v2_dateless_caught', de ? 'Dieses {0} wurde in der Nähe von {1} gefangen.' : 'This {0} was caught around {1}.'],
		['appraise_v2_dateless_uncached_loc', de ? 'Dieses {0} wurde gefangen.' : 'This {0} was caught'],
		['general_hp', de ? 'KP' : 'HP'],
		['general_kg', 'kg'],
		['general_m', 'm'],
		['unrelated_key', 'Something else'],
	];
	for (let i = 1; i <= 120; i++) kv.push([`pokemon_name_${String(i).padStart(4, '0')}`, `Filler${i}mon`]);
	return { data: kv.flat() };
}
