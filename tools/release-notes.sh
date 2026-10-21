#!/usr/bin/env bash
# Print one version's section of CHANGELOG.md as the notes of its GitHub release
# (docs/RELEASING.md): without its heading, wrapped lines joined, since
# GitHub may show every line break in release notes as one.
#
#   tools/release-notes.sh 1.1                  print, to copy into the release form
#   tools/release-notes.sh 1.1 > /tmp/notes.md  for gh release create --notes-file
set -euo pipefail

v=${1:?usage: $0 VERSION [CHANGELOG.md]}
file=${2:-"$(dirname "$0")/../CHANGELOG.md"}

awk -v v="$v" '
	function flush() {
		if (line == "") return
		if (out) for (; blanks > 0; blanks--) print ""
		blanks = 0; out = 1
		print line; line = ""
	}
	/^## / {
		if (in_section) exit
		in_section = index($0, "## " v " ") == 1
		found = found || in_section
		next
	}
	!in_section { next }
	/^$/ { flush(); blanks++; next }
	/^(#|- )/ { flush(); line = $0; next }
	{ sub(/^ +/, ""); line = (line == "" ? $0 : line " " $0) }
	END {
		flush()
		if (!found) { print "no section \"## " v " - ...\" in the changelog" > "/dev/stderr"; exit 1 }
	}
' "$file"
