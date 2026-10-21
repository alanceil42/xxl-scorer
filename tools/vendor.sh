#!/usr/bin/env bash
# vendor.sh — keep the text-recognition engine in vendor/.
#
# "Vendored" = third-party files copied into this repository at a fixed version, so the page
# needs no CDN and no package manager. Today: tesseract.js (text recognition) and its English
# model, and the few Lucide icons the buttons use, built into one sprite. vendor/PINS
# says which versions; this script fetches them from the npm registry, checks their SHA-256
# and copies the few files the page needs.
#
# Usage:
#   tools/vendor.sh                  fetch the pinned versions into vendor/ (after a fresh clone
#                                    the files are already committed; this rebuilds them)
#   tools/vendor.sh --check          verify vendor/ against vendor/SHA256SUMS
#   tools/vendor.sh --outdated       list newer versions; exit 1 if there are any (the icons
#                                    are listed but never fail it: Lucide releases weekly)
#   tools/vendor.sh --update         move to the newest versions within the same major version,
#                                    rewrite vendor/PINS, re-vendor
#   tools/vendor.sh --update-major   same, but allow a new major version (expect API changes)
#   tools/vendor.sh --version NAME   print the pinned version of NAME (e.g. tesseract.js)
#
# After --update: run `npm test`, the local screenshot tests, and try the page in a browser.
# Nothing here updates by itself.
#
# Needs: bash, curl, tar, jq, sha256sum or shasum; --update also needs openssl.

set -euo pipefail

cd "$(dirname "$0")/.."
VENDOR="vendor"
PINS="$VENDOR/PINS"
REGISTRY="https://registry.npmjs.org"
# HTTPS only (also after redirects), bounded size and time
curl() { command curl --proto '=https' --proto-redir '=https' --max-filesize 209715200 --max-time 600 "$@"; }
CORE_FILES=(tesseract-core-relaxedsimd-lstm.wasm.js tesseract-core-simd-lstm.wasm.js tesseract-core-lstm.wasm.js)
# Lucide icons in vendor/lucide/icons.svg, referenced by name as icons.svg#<name>.
# Adding one: add its name here (lucide.dev/icons), run tools/vendor.sh, use it in the page.
ICONS=(
	arrow-down-up		# sort menu
	check			# find in game: copied
	circle-help		# which screenshots to take
	clipboard-paste		# paste
	copy			# the nickname button in each row
	hard-drive-download	# backup menu
	list-checks		# select mode
	scan-search		# find in game, in each row
	search			# search field
	settings		# settings
	triangle-alert		# find in game: the search fits other rows too
)
# Packages whose newer versions --outdated lists without failing (no security relevance,
# frequent releases): update them when wanted, with --update.
QUIET=(lucide-static)

sha256() {
	if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}

# PINS: one line per package: name version sha256-of-tarball
pin() { awk -v n="$1" '$1 == n { print $'"$2"' }' "$PINS"; }
names() { awk '!/^#/ && NF == 3 { print $1 }' "$PINS"; }

tarball_url() {
	local name="$1" version="$2"
	echo "$REGISTRY/$name/-/${name##*/}-$version.tgz"
}

# Newest version of $1 with major $2 (any major if empty) and >= $3, no pre-releases.
newest() {
	local name="$1" major="${2:-}" min="${3:-0.0.0}"
	curl -fsSL "$REGISTRY/$name" | jq -r --arg major "$major" --arg min "$min" '
		def v: split(".") | map(tonumber);
		[ .versions | keys[] | select(test("^[0-9]+\\.[0-9]+\\.[0-9]+$")) ]
		| map(select(($major == "" or (v[0] == ($major | tonumber))) and (v >= ($min | v))))
		| sort_by(v) | last // empty'
}

fetch_verified() {	# name version → $tmp/<base>.tgz, checked against the registry's integrity hash
	local name="$1" version="$2" base="${1##*/}"
	local integrity got
	integrity="$(curl -fsSL "$REGISTRY/$name/$version" | jq -r '.dist.integrity')"
	curl -fsSL -o "$tmp/$base.tgz" "$(tarball_url "$name" "$version")"
	got="sha512-$(openssl dgst -sha512 -binary "$tmp/$base.tgz" | openssl base64 -A)"
	if [[ "$got" != "$integrity" ]]; then
		echo "Integrity mismatch for $name@$version" >&2
		exit 1
	fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

case "${1:-}" in
	--check)
		(cd "$VENDOR" && sha256 -c --quiet SHA256SUMS) && echo "vendor/ OK" >&2
		exit
		;;
	--version)
		v="$(pin "${2:?name}" 2)"
		[[ -n "$v" ]] || { echo "not pinned: $2" >&2; exit 1; }
		echo "$v"
		exit
		;;
	--outdated)
		status=0
		for name in $(names); do
			cur="$(pin "$name" 2)"
			same="$(newest "$name" "${cur%%.*}")"
			any="$(newest "$name")"
			if [[ "$same" != "$cur" || "$any" != "$cur" ]]; then
				[[ " ${QUIET[*]} " == *" $name "* ]] || status=1
				echo "$name: pinned $cur, newest same major $same, newest $any"
			else
				echo "$name: $cur is current"
			fi
		done
		exit "$status"
		;;
	--update|--update-major)
		major_ok=0
		[[ "$1" == "--update-major" ]] && major_ok=1
		cur_js="$(pin tesseract.js 2)"
		js="$(newest tesseract.js "$([[ $major_ok == 1 ]] || echo "${cur_js%%.*}")")"
		# The core version tesseract.js itself asks for (e.g. ^7.0.0): newest with that major.
		range="$(curl -fsSL "$REGISTRY/tesseract.js/$js" | jq -r '.dependencies["tesseract.js-core"]')"
		min="${range#[~^]}"
		core="$(newest tesseract.js-core "${min%%.*}" "$min")"
		cur_eng="$(pin @tesseract.js-data/eng 2)"
		eng="$(newest @tesseract.js-data/eng "$([[ $major_ok == 1 ]] || echo "${cur_eng%%.*}")")"
		echo "tesseract.js $cur_js → $js, tesseract.js-core $(pin tesseract.js-core 2) → $core (wants $range), @tesseract.js-data/eng $cur_eng → $eng" >&2
		others=()
		for name in $(names); do
			case "$name" in tesseract.js|tesseract.js-core|@tesseract.js-data/eng) continue ;; esac
			cur="$(pin "$name" 2)"
			others+=("$name $(newest "$name" "$([[ $major_ok == 1 ]] || echo "${cur%%.*}")")")
		done
		{
			echo "# name                  version  sha256 of the npm tarball   (tools/vendor.sh --update rewrites this)"
			for nv in "tesseract.js $js" "tesseract.js-core $core" "@tesseract.js-data/eng $eng" "${others[@]}"; do
				read -r name version <<< "$nv"
				fetch_verified "$name" "$version"
				printf '%-23s %-8s %s\n' "$name" "$version" "$(sha256 "$tmp/${name##*/}.tgz" | cut -c1-64)"
			done
		} > "$tmp/PINS"
		cp "$tmp/PINS" "$PINS"
		echo "vendor/PINS updated; re-vendoring" >&2
		;;
	"")
		;;
	*)
		sed -n '2,22p' "$0" >&2
		exit 2
		;;
esac

# --- fetch the pinned versions into vendor/ ---
for name in $(names); do
	version="$(pin "$name" 2)"
	want="$(pin "$name" 3)"
	base="${name##*/}"
	echo "Fetching $name@$version" >&2
	curl -fsSL -o "$tmp/$base.tgz" "$(tarball_url "$name" "$version")"
	got="$(sha256 "$tmp/$base.tgz" | cut -c1-64)"
	if [[ "$got" != "$want" ]]; then
		echo "Checksum mismatch for $name@$version: got $got" >&2
		exit 1
	fi
	rm -rf "$tmp/$base"
	mkdir -p "$tmp/$base"
	tar -xzf "$tmp/$base.tgz" -C "$tmp/$base"
done

js="$tmp/tesseract.js/package"
core="$tmp/tesseract.js-core/package"
eng="$tmp/eng/package/4.0.0_best_int/eng.traineddata.gz"
lucide="$tmp/lucide-static/package"
# The page relies on these names (src/ui/ocr.js; tesseract.js picks a core file by CPU features).
for f in "$js/dist/tesseract.min.js" "$js/dist/worker.min.js" "$eng" "${CORE_FILES[@]/#/$core/}" \
	"$lucide/LICENSE" "${ICONS[@]/#/$lucide/icons/}"; do
	[[ "$f" == "$lucide/icons/"* ]] && f="$f.svg"
	[[ -f "$f" ]] || { echo "Expected file missing in the new version: ${f#"$tmp"/} — layout changed, not vendoring" >&2; exit 1; }
done

# One sprite of <symbol>s, so the page fetches one small file for all icons. Lucide writes one
# child element per line, indented by two spaces; anything else means the layout changed.
{
	echo "<!-- Lucide icons, lucide-static $(pin lucide-static 2), ISC (see LICENSE). Built by tools/vendor.sh. -->"
	echo '<svg xmlns="http://www.w3.org/2000/svg">'
	for name in "${ICONS[@]}"; do
		body="$(grep -E '^  <[a-z]' "$lucide/icons/$name.svg" | sed -e 's/^  /\t\t/' -e 's| />$|/>|')"
		[[ -n "$body" ]] || { echo "No shapes found in $name.svg — layout changed, not vendoring" >&2; exit 1; }
		printf '\t<symbol id="%s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\n%s\n\t</symbol>\n' "$name" "$body"
	done
	echo '</svg>'
} > "$tmp/icons.svg"

rm -rf "$VENDOR/tesseract" "$VENDOR/tessdata" "$VENDOR/lucide" "$VENDOR/fonts"	# fonts/: Inter Tight, until 0.1
mkdir -p "$VENDOR/tesseract/core" "$VENDOR/tessdata"
cp "$js/dist/tesseract.min.js" "$js/dist/worker.min.js" "$js/LICENSE.md" "$VENDOR/tesseract/"
cp "$js"/dist/*.LICENSE.txt "$VENDOR/tesseract/" 2>/dev/null || true
for f in "${CORE_FILES[@]}"; do cp "$core/$f" "$VENDOR/tesseract/core/"; done
cp "$core/LICENSE" "$VENDOR/tesseract/core/"
cp "$eng" "$VENDOR/tessdata/"
mkdir -p "$VENDOR/lucide"
cp "$tmp/icons.svg" "$lucide/LICENSE" "$VENDOR/lucide/"
cat > "$VENDOR/tessdata/NOTICE" <<EOF
eng.traineddata.gz: English LSTM model "4.0.0_best_int" from the npm package
@tesseract.js-data/eng $(pin @tesseract.js-data/eng 2) (MIT), built from tesseract-ocr/tessdata_best (Apache-2.0).
EOF

(cd "$VENDOR" && find tesseract tessdata lucide -type f | LC_ALL=C sort | while read -r f; do sha256 "$f"; done) > "$tmp/SHA256SUMS"
mv "$tmp/SHA256SUMS" "$VENDOR/SHA256SUMS"
echo "vendor/ written: tesseract.js $(pin tesseract.js 2), core $(pin tesseract.js-core 2), eng $(pin @tesseract.js-data/eng 2), lucide-static $(pin lucide-static 2) (${#ICONS[@]} icons)" >&2
du -sh "$VENDOR"/tesseract "$VENDOR"/tessdata "$VENDOR"/lucide >&2
