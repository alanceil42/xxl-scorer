# Changelog

What changed from one release to the next, newest first. Versions are MAJOR.MINOR (1.0, 1.1,
2.0), with a third number only for a release that just fixes something (1.0.1); what counts as
which, and how a release is made: docs/RELEASING.md. Changes on main that are not released yet
collect under "Unreleased".


## Unreleased


## 1.6 - 2026-10-27

Each row shows its place by score, so the top ten need no counting.

- Each row starts with the Pokémon's place by score among the Pokémon shown (with a search,
  among those it finds), whatever the list is sorted by; on phones it stands before "ok". The
  top ten are tinted
- Select mode keeps the find and copy buttons (dimmed), so the list no longer jumps when it ends
- Closing a Pokémon's details with Cancel no longer leaves a green outline on its row; after
  the keyboard (Escape, Enter on Save), its row has the keyboard focus again, after Save too

## 1.5 - 2026-10-26

A backup brings back the "Name to copy" pattern too.

- A backup holds the "Name to copy" pattern too, and importing it brings the pattern back
  (unless the one in the browser was set more recently)


## 1.4 - 2026-10-26

A preview for links to the page.

- A link to the page shows a preview picture and title in chats and on Reddit


## 1.3.3 - 2026-10-24

Fixes: a score entered by hand counts, and nicknames with a half level fit the game.

- A score entered as "Score in game" counts instead of the computed one: the copied nickname
  uses it, the list is sorted by it, and a score search finds it; the row shows it, with the
  computed score below
- A half level in the copied nickname is its whole level circled plus ½ (XX990⁴⁰❽②½), no longer
  digits (XX990⁴⁰❽2.5), which made some nicknames longer than the game's 12 characters


## 1.3.2 - 2026-10-23

Fixes: CPs and HPs read better, more screenshots merge, two buttons look right.

- A CP whose first digit ran into the small "CP" in front of it is read whole, and an HP whose
  label was read as a digit ("60 / 60 HP" as 601) no longer keeps a Pokémon's two screenshots
  apart
- A CP read exactly as one the IVs and HP allow is taken, even when another possible CP looks
  like one of the reads too
- On 16:9 screens, a Pokémon whose CP is hidden behind it on both screenshots is merged when
  the screenshot without its species shows type labels and a size that fit it, and the same
  nickname
- The sort button is as tall as the search field in older Safari (iOS 16), where it was half
  as tall
- The settings button is tinted green while the settings are open, like the sort button while
  the list is not sorted by score


## 1.3.1 - 2026-10-23

Screenshots from other players' phones read better (tested on screenshots posted to Reddit).

- Screenshots cut off at the top (the status bar cropped away): the CP and the name are read
  again, found from where the card is
- Tags under the HP line: height and weight are read one row lower, where the tags pushed them;
  before, they stayed empty
- Phones that lay the card out a little lower (some Android phones), or the card scrolled up a
  little: name and catch-year pill are read where they are
- A lucky Pokémon is told by the "LUCKY POKÉMON" line, not by where the HP bar sits; and the
  appraisal no longer counts as covering height and weight on phones where it sits a little
  higher
- A height or weight read as a whole number on a screenshot with the appraisal ("1 m") is
  marked to check: most often the trainer hides the rest of it (2.01 m)
- Appraisal bars in recompressed screenshots: a bar with a broken row counted as two bars, and
  the IVs came from the wrong three (15/14/15 read as 14/14/15)


## 1.3 - 2026-10-22

- iPad screenshots are read: the game lays out the card there as on a 16:9 phone, centred on
  the wider screen, and the page now reads it in that column. Before, most iPad screenshots
  were skipped as if taken mid-swipe, and height and weight stayed empty. Other screens wider
  than a 16:9 phone (tablets, unfolded foldables) are read the same way; only the iPad is
  tested so far
- Screenshots taken mid-swipe, between two Pokémon, are no longer looked for and skipped: the
  check misjudged screenshots of other screen shapes, and such a screenshot is rare
- Fewer banners to dismiss after adding screenshots: none for screenshots merged into Pokémon
  already in the list, and the time it took moved to a line under the footer
- A Pokémon with forms of equal HP (Dialga and Origin Dialga) gets the form whose CP was read
  exactly, instead of one whose CP only looks like a misread; before, the page took the first
  form and asked to check it


## 1.2.1 - 2026-10-22

Nothing changes in how the page works: new pictures in the README and two tidy-ups in the code.

- The README opens with a picture of the list, light and dark, filled with made-up Pokémon;
  the drawing of which screenshots to take moved to docs/help.png (was docs/screenshot.png)
  and shows today's buttons. tools/readme-picture.mjs draws both from the page itself
- Code no longer used since 1.2 removed from the screenshot reader in its own worker


## 1.2 - 2026-10-22

Screenshots are read sooner, with the same readings, and the footer says which version is
running. Nothing to do for self-hosters; returning visitors download the text recognition's
language model (about 3 MB) once more.

- Screenshots are read sooner: the text recognition starts while the page is idle and while
  the file picker is open, each screenshot is decoded while the one before is being read, and
  the close-ups go to the engine as plain pixels rather than as PNG images. In Chrome, Edge and
  other Chromium browsers decoding and the work on the pixels leave the page's main thread
  altogether, so more of the computer's cores are put to use. After a batch, a note says how
  many screenshots were read and how long it took. Readings are the same as before
- Reading the whole screenshot no longer has the text recognition try each unsure line a
  second time inverted (for light text on dark), which the card doesn't have: about 5-10 %
  quicker per screenshot
- Long lists are quicker again: species names are looked up once per name rather than for
  every row each time screenshots come in, and in a window just too narrow for the table,
  sorting 1000 Pokémon takes about a third less time
- The text recognition's language model is stored under a name of the site's own, which
  includes the model's version: a newer model reaches returning visitors, and the copy stored
  under the old name is deleted
- The footer names what is running: the version when the files are exactly a release, otherwise
  the branch and the commit, linking to it. git fills these in when it packs the files
  (`git archive`, as the public copy and a tarball of a commit are made); a plain git checkout
  keeps showing the last release's number
- A picture of more than 40 megapixels is refused by the size in its PNG or JPEG header, before
  it is decoded, instead of after: it no longer takes the tab's memory first
- Importing a backup keeps a Pokémon's thumbnail only when it is a JPEG image, which is all the
  page has ever stored: an image of another kind labelled as JPEG is dropped
- Game data whose "was caught" line repeats a placeholder, has more of them than the line's
  own, or is over 200 characters long no longer freezes the page: that variant of the line is
  left out. The game's own texts are not affected


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
