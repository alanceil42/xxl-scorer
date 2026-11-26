# How xxl-scorer works

For players who code: what is read from a screenshot, and how that becomes showcase points.
Everything runs in the browser; screenshots are never uploaded. src/core/ is plain functions
without the DOM, so all of it runs in Node too.


## The score

Code: src/core/score.js, src/core/gm.js (XXL_BONUS, the constants from the game data).

    score = 800 × (h / h̄) / K
          + 150 × (w / w̄) / (K + 4·σw / w̄)
          +  50 × (Attack + Defense + HP IV) / 45
          + 178 if XXL

- h, w: height and weight; h̄, w̄ the species' averages (game master). σw = w̄/8 for every
  species, so the weight's denominator is K + 0.5.
- K: the species' XXL height limit as a multiple of h̄, 1.75 for most, 1.55 or 2.00 for the
  rest. 800, 150 and 50 come from the game master; the bonus of 178 is the community's value
  and matches the game (a Tornadus: 1144.1 ± 1.7 computed, 1143 shown).
- ±: the card's two decimals of height and weight carried through; small species get a wide one.
- XXL: a height above the XL limit (1.5 × h̄ for nearly all); where rounding can't tell, the
  size badge decides. No bonus where K is 1 (Super Pumpkaboo, Super Gourgeist).
- XXS mode ranks the same score lowest first, a guess not yet checked against a showcase.

A score from the game outside the ± range (each row's "in game" field) points at a change in
the formula: please open an issue. Sources: bmenrigh/pogo_size; Pokémon GO Hub, "Showcase
Scores, XXS and XXL Pokémon"; pgoxxldb.com.

Evolving (src/core/evolve.js): the place in the XXL band, p = (h/h̄ − 1.5) / (K − 1.5), stays,
and the weight keeps its ratio to the height; IVs and bonus stay. So the score moves only where
K does. A new screenshot of the evolved Pokémon (same catch date and IVs) replaces the old row.


## IVs from the appraisal bars

Code: src/core/bars.js, src/core/ivs.js.

CP and HP alone fit dozens of IV combinations, so the IVs come from the appraisal's three bars,
measured in pixels (readings within 0.15 of a whole number). Every IV and level combination
that gives the CP and HP read is ranked by its distance to the bars: the bars decide, CP and HP
catch a misread number or the wrong form. Without the bars the row shows "IV ?" and the middle
of the fitting scores, ± half their spread. Without the CP, two levels half a level apart often
fit; the row shows both ("28.5 or 29") until the CP is typed.


## Reading the card

Code: src/core/image.js, read.js, pipeline.js; src/ui/ocr.js.

- Text recognition is tesseract.js (WebAssembly) from files the site serves itself, about a
  second per screenshot.
- Regions are located in units of the screen's width, found from the HP bar (a green line),
  so phones of other shapes and cut screenshots read alike; an iPad is read as a 16:9 column.
- Species and catch date come from the whole screenshot, matched with the game's own texts;
  HP, weight, height, types and the size badge from close-ups.
- The CP is a cross-check: taken only when it fits bars, HP and level (or is a digit off).
- A value the species can't have (a digit hidden by the sprite) is repaired and marked to
  check. Every value can be edited.


## Several screenshots, one Pokémon

Code: src/core/evaluate.js.

Most Pokémon need a screenshot with the appraisal and one without. Screenshots merge into one
row when nothing contradicts (HP, weight, catch date, species, …) and enough agrees; HP and
weight together are practically a fingerprint. Two rows fitting about equally well: the
screenshot stays on its own, better a pair to merge by hand than a wrong merge.


## Sync with the game

Code: src/core/listview.js, namereader.js, tilename.js, listsync.js.

Rows stay until deleted, so traded and evolved Pokémon pile up. Screenshots of the game's list
for the search xxl (xxs in XXS mode) bring it back in line. Each tile is found by the green bar
under its name, its CP read above the sprite; the header gives the count. Screenshots are
stitched by the tiles they share, in any order. A tile matches a row by its CP (the CPs its IVs
and HP allow, where none was read), or as a later stage; names and the list's order only narrow
the candidates. What is left:

- a row with no tile is "not in the game", marked only when the tiles add up to the game's
  count, each with its CP. Deleting is your tap (Select them, then Delete, with Undo).
- a row whose tile shows a later stage: "evolved, scan again".
- a tile that fits several rows leaves them "not sure", never gone or new.
- a tile that fits no row is new: counted, with a search for their CPs (xxl&cp512,cp1480).


## Game data

Code: src/core/gm.js, src/core/text.js, src/ui/gamedata.js.

Species sizes, base stats and the game's texts come from PokeMiners' game master and text
tables on GitHub, fetched by your browser about once a week, compacted (about 95 KB) and kept
on your device. Nothing from the game is in this repository; tools/build-gm.sh can build the
same file on a server instead.


## Storage

Code: src/ui/db.js, src/core/backup.js.

Screenshots are read and dropped in memory. IndexedDB keeps one row per Pokémon (readings,
edits, a 2 KB thumbnail of the sprite) and the game data; scores are computed when shown. A
backup is the same rows as JSON; on import, cleanRow keeps only known fields of the right types.
Browsers may delete stored data (Safari after 7 days without a visit), hence the backup. A
Content-Security-Policy lets the page load nothing but its own files and the game data.
