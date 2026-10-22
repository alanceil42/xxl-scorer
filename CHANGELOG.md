# Changelog

What changed from one release to the next, newest first. Versions are MAJOR.MINOR (1.0, 1.1,
2.0), with a third number only for a release that just fixes something (1.0.1); what counts as
which, and how a release is made: docs/RELEASING.md. Changes on main that are not released yet
collect under "Unreleased".


## Unreleased


## 1.1 - 2026-10-22

Quicker with long lists, and harder to upset with an edited backup. Nothing stops working;
self-hosters with nginx or the weekly game data job should copy contrib/ again (see below).

- The list is quicker with hundreds of Pokémon, above all on phones: sorting, searching, a tap
  in select mode and saving in the editor draw again only the rows that changed, and cards
  off screen are left until scrolled to. Adding screenshots to a long list keeps the page
  more responsive while they are read. The nickname template in Settings is taken once typing
  pauses or the field is left, rather than at every keystroke
- All search terms are explained at the top of the help (the ? button), and the search field's
  placeholder names a few. The hint under the field is gone: shown while the field had focus,
  it pushed the list down, so on a computer the first click on a row after a search missed it
- A stored Pokémon the page can't score (from an edited backup or an older version) is marked
  to check and can be corrected or deleted; it used to stop the whole list from showing
- A backup with sizes a heavy species can't have no longer holds up the page: putting back
  hidden digits used to try every hundredth up to the species' heaviest, a third of a million
  tries per row, on every visit. The values it finds are the same
- Backups: a species that isn't one of the game data's is dropped when importing, and times in
  the future count as now. An import that fails says so instead of doing nothing
- The text recognition engine runs under the page's Content-Security-Policy too, so it can load
  nothing but the site's own files; no worker may start from a file of the site
- Copying in browsers without the newer clipboard interface no longer shows the hidden text
  field for a moment
- A nickname placeholder such as `{constructor}` stays as typed, like any other unknown one
- Self-hosted sites: when config.json's "gm" points to another gm.json, the page loads it at
  once; it used to keep the previous file's data for up to "gmCheckDays", shown under the new
  name
- Self-hosters with nginx: the example sends the page's whole policy as a header and refuses
  dot files in every folder, not only at the top; the weekly game data job may use 1 GB of
  memory at most. Copy contrib/nginx and contrib/systemd into your configuration again
- Self-hosters publishing with the Pages workflow: it publishes only a release's tag that is on
  main's own line of commits, never a pre-release; to publish a release again, pick its tag
  under "Use workflow from" (the field for a tag is gone). It refuses a site holding symbolic
  links and checks the vendored files itself
- Development: `npm run serve` answers only this computer; `tools/vendor.sh --check` refuses
  symbolic links


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
