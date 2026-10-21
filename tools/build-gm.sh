#!/usr/bin/env bash
# build-gm.sh — build the compact game data file (gm.json) that xxl-scorer reads.
#
# Same output as src/core/gm.js + src/core/text.js in the browser; tests/gm.test.js keeps the
# two identical. Use it on a self-hosted server (see
# contrib/systemd/) and point config.json's "gm" at the result.
#
# Usage:  tools/build-gm.sh [-o OUTPUT] [-l LANGS] [-g LATEST_JSON] [-t TEXT_DIR]
#   -o OUTPUT       where to write (default: ./gm.json); replaced atomically, only on success
#   -l LANGS        game languages to include text tables for, comma separated (e.g. en,de)
#   -g LATEST_JSON  use this game master instead of downloading it
#   -t TEXT_DIR     read i18n_<language>.json from this directory instead of downloading
#
# Environment: MIN_SPECIES (default 900) — refuse output with fewer species (format guard).
# Needs: bash, curl, jq (≥ 1.6)

set -euo pipefail

GM_URL="https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json"
TEXT_URL="https://raw.githubusercontent.com/PokeMiners/pogo_assets/master/Texts/Latest%20APK/JSON"
MIN_SPECIES="${MIN_SPECIES:-900}"
# HTTPS only (also after redirects), bounded size and time: the game master is ~20 MB
fetch() { curl -fsSL --proto '=https' --proto-redir '=https' --max-filesize 209715200 --max-time 600 "$@"; }

out="gm.json"
langs=""
gm_src=""
text_dir=""
while getopts "o:l:g:t:h" opt; do
	case "$opt" in
		o) out="$OPTARG" ;;
		l) langs="$OPTARG" ;;
		g) gm_src="$OPTARG" ;;
		t) text_dir="$OPTARG" ;;
		*) sed -n '2,17p' "$0" >&2; exit 2 ;;
	esac
done

lang_file() {
	case "$1" in
		en) echo english ;;
		de) echo german ;;
		*) echo "unknown language: $1 (known: en, de)" >&2; return 1 ;;
	esac
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

etag="local"
if [[ -z "$gm_src" ]]; then
	fetch --compressed -D "$tmp/headers" -o "$tmp/latest.json" "$GM_URL"
	gm_src="$tmp/latest.json"
	etag="$(grep -i '^etag:' "$tmp/headers" | tr -d '\r"' | awk '{print $2}' || true)"
fi
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# --- game master ---
jq -c --arg now "$now" --arg etag "$etag" --arg url "$GM_URL" --argjson min "$MIN_SPECIES" '
	# 0 counts as missing, as in gm.js: no size, weight or attack is 0
	def nz: if . == 0 then null else . end;

	. as $all

	# Absolute size bounds (m) per species/form, from the EXTENDED_* templates
	| ([ $all[] | .data.pokemonExtendedSettings? // empty
		| select(.sizeSettings.xxlUpperBound | nz)
		| { key: (.form // .uniqueId), value: .sizeSettings } ]
		| from_entries) as $size

	# One row per species/form:
	# [height m, weight kg, weight σ, XXL max m, atk, def, sta, types, XL max m, XS min m]
	| [ $all[]
		| select(.templateId | test("^V[0-9]{4}_POKEMON_"))
		| .templateId as $tid
		| .data.pokemonSettings? // empty
		| select((.pokedexHeightM | nz) and (.pokedexWeightKg | nz) and (.stats.baseAttack | nz))
		| (.form // .pokemonId) as $key
		| .pokemonId as $pid
		| {
			id: $pid,
			dex: ($tid[1:5] | tonumber),
			form: (if .form then (.form | tostring | ltrimstr($pid) | ltrimstr("_")) else "" end),
			row: [
				.pokedexHeightM,
				.pokedexWeightKg,
				((.weightStdDev | nz) // (.pokedexWeightKg / 8)),
				(($size[$key] // $size[$pid]).xxlUpperBound // (.pokedexHeightM * 1.75)),
				.stats.baseAttack,
				(.stats.baseDefense // 0),
				(.stats.baseStamina // 0),
				([.type, .type2] | map(select(.) | ltrimstr("POKEMON_TYPE_")) | join("/")),
				((($size[$key] // $size[$pid]).xlUpperBound | nz) // (.pokedexHeightM * 1.5)),
				((($size[$key] // $size[$pid]).xsLowerBound | nz) // (.pokedexHeightM * 0.5))
			]
		} ] as $rows

	# Group by species; drop forms identical to the base (costumes etc.)
	| (reduce $rows[] as $r ({};
		.[$r.id].dex = $r.dex
		| .[$r.id].f[$r.form] = $r.row)
	| with_entries(
		.value.f as $f
		| ($f[""] // $f["NORMAL"]) as $base
		| .value.f = ($f | with_entries(select(
			.key == "" or (.key == "NORMAL" and ($f[""] == null)) or .value != $base)))
	)) as $species

	| if ($species | length) < $min then
		error("only \($species | length) species parsed (expected ≥ \($min)); format changed?")
	else . end

	| ([ $all[] | select(.templateId == "PLAYER_LEVEL_SETTINGS") ][0].data.playerLevel.cpMultiplier) as $cpm
	| ([ $all[] | select(.templateId == "CONTEST_SETTINGS") ][0].data.contestSettings) as $cs
	| ($cs.contestScoreCoefficient[0].pokemonSize // {}) as $coef
	# which size showcases the game knows: MAX (biggest), MIN (smallest)
	| ([ ($cs.contestLimits // [])[] | .contestMetric? // empty
		| select(.pokemonMetric == "POKEMON_SIZE") | .rankingStandard ] | unique) as $rankings

	| {
		v: 1,
		generated: $now,
		source: { url: $url, etag: $etag },
		coef: {
			h: ($coef.heightCoefficient // 800),
			w: ($coef.weightCoefficient // 150),
			iv: ($coef.ivCoefficient // 50),
			xxlAdj: ($coef.xxlAdjustmentFactor // 1),
			xxlBonus: 178,
			rankings: $rankings
		},
		cpm: [ $cpm[] | . * 1e8 | round / 1e8 ],
		species: $species
	}
' "$gm_src" > "$tmp/gm.json"

# --- text tables ---
echo '{}' > "$tmp/text.json"
IFS=',' read -r -a lang_list <<< "$langs"
for lang in "${lang_list[@]}"; do
	[[ -n "$lang" ]] || continue
	name="$(lang_file "$lang")"
	src="${text_dir:+$text_dir/i18n_$name.json}"
	if [[ -z "$src" ]]; then
		src="$tmp/i18n_$name.json"
		fetch --compressed -o "$src" "$TEXT_URL/i18n_$name.json"
	fi
	jq -c --arg lang "$lang" --slurpfile acc "$tmp/text.json" '
		.data as $d
		| (reduce range(0; ($d | length) - 1; 2) as $i ({}; .[$d[$i]] = $d[$i + 1])) as $kv
		| {
			names: ($kv | with_entries(select(.key | test("^pokemon_name_[0-9]{4}$")) | select(.value != null and .value != "")
				| .key |= (.[13:] | tonumber | tostring))),
			caught: ($kv | with_entries(select(.key | IN("appraise_v2_caught", "appraise_v2_date_uncached_loc",
				"appraise_v2_dateless_caught", "appraise_v2_dateless_uncached_loc")))),
			hp: ($kv.general_hp // "HP"),
			kg: ($kv.general_kg // "kg"),
			m: ($kv.general_m // "m")
		}
		| if (.names | length) < 100 or (.caught.appraise_v2_caught == null) then
			error("text table \($lang): species names or caught line missing; format changed?")
		else . end
		| . as $t | $acc[0] + { ($lang): $t }
	' "$src" > "$tmp/text.next.json"
	mv "$tmp/text.next.json" "$tmp/text.json"
done

if [[ -n "$langs" ]]; then
	jq -c --slurpfile text "$tmp/text.json" '. + { text: $text[0] }' "$tmp/gm.json" > "$tmp/out.json"
else
	mv "$tmp/gm.json" "$tmp/out.json"
fi

count="$(jq '.species | length' "$tmp/out.json")"
mv "$tmp/out.json" "$out.tmp.$$"
mv "$out.tmp.$$" "$out"
echo "Wrote $out: $count species, languages: ${langs:-none}, $(wc -c < "$out") bytes" >&2
