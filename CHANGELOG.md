# Changelog

What changed from one release to the next, newest first. Versions are MAJOR.MINOR (1.0, 1.1,
2.0), with a third number only for a release that just fixes something (1.0.1); what counts as
which, and how a release is made: docs/RELEASING.md. Changes on main that are not released yet
collect under "Unreleased".


## Unreleased

- A stored Pokémon the page can't score (from an edited backup or an older version) is marked
  to check and can be corrected or deleted; it used to stop the whole list from showing
- Backups: a species that isn't one of the game data's is dropped when importing, and times in
  the future count as now. An import that fails says so instead of doing nothing
- Copying in browsers without the newer clipboard interface no longer shows the hidden text
  field for a moment
- All search terms are explained at the top of the help (the ? button), and the search field's
  placeholder names a few. The hint under the field is gone: shown while the field had focus,
  it pushed the list down, so on a computer the first click on a row after a search missed it
- Self-hosted sites: when config.json's "gm" points to another gm.json, the page loads it at
  once; it used to keep the previous file's data for up to "gmCheckDays", shown under the new
  name


## 1.0.1 - 2026-10-21

A small fix to the footer; nothing to do for self-hosters.

- The legal notice link (on sites that set one) sits in the footer's text, after the version,
  instead of on a line of its own


## 1.0 - 2026-10-21

The first release.

- Showcase points for size showcases from Pokémon GO screenshots, with a ± range for the game's
  rounding; XXL from the height; an XXS mode for showcases of the smallest, should the game run
  them
- Reads species, CP, HP, height, weight, types and catch date, and the IVs from the appraisal
  bars; English game text, iPhone screenshots of 19.5:9 and 16:9 screens tested
- Several screenshots of one Pokémon merge into one row, so a quick swipe through the storage
  works; a screenshot taken mid-swipe is skipped
- A list to sort (score, newest, CP, Pokédex, name, IVs, catch date) and search with the game's
  own terms; every value can be edited
- One tap copies a nickname built from a template (XX1063¹⁸⓿㉚), another a search that finds the
  Pokémon in the game's storage
- Everything runs in the browser and nothing is uploaded; the list stays on the device, and a
  backup file moves it to another one
- Game data loaded by the browser from PokeMiners, or built on a server with tools/build-gm.sh
- Any static host: docs/INSTALL.md for nginx and systemd; each release is published to GitHub
  Pages; an optional legal notice link in the footer
