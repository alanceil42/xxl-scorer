# How xxl-scorer works

For players who code: what is read from a screenshot, and how that becomes showcase points.
Everything runs in the browser; screenshots are never uploaded. Each section names the code
that does it; src/core/ is plain functions without the DOM, so all of it runs in Node too.


## The score

Code: src/core/score.js (score), src/core/gm.js (XXL_BONUS, the constants from the game data).

    score = 800 × (h / h̄) / K
          + 150 × (w / w̄) / (K + 4·σw / w̄)
          +  50 × (Attack + Defense + HP IV) / 45
          + 178 if XXL

- h and w are the Pokémon's height and weight; h̄ and w̄ its species' averages
  (pokedexHeightM, pokedexWeightKg in the game master). σw, the spread of the weight, is w̄/8
  for every species, so the weight's denominator is K + 0.5.
- K is the species' XXL height limit as a multiple of h̄ (xxlUpperBound / pokedexHeightM,
  from the game master's EXTENDED_…_POKEMON_* templates): 1.75 for most species, 1.55 or 2.00
  for the rest, with a few odd forms.
- 800, 150 and 50 are read from the game master (CONTEST_SETTINGS), so they follow the game.
  The XXL bonus of 178 is not in the game data: it is the community's value, and it matches
  the game (a Tornadus: 1144.1 ± 1.7 computed, 1143 shown).
- The game shows height and weight to two decimals, hence the ± range:
  ± = 800 × 0.005 / h̄ / K + 150 × 0.005 / w̄ / (K + 4σw / w̄). Small species get a wide one.
- Species and type showcases use the same formula: each Pokémon is measured against its own
  species.
- XXL means a height above the species' XL limit (1.5 × h̄ for nearly all). Where rounding
  can't tell, the size badge on the card decides.
- XXS mode ranks the same score the other way round, lowest first. That is a guess: no
  showcase of the smallest has run yet to check it against.

Each row has an "in game" field. A score from the game outside the ± range points at a change
in the formula: please open an issue.

Sources: bmenrigh/pogo_size (the weight model); Pokémon GO Hub, "Showcase Scores, XXS and XXL
Pokémon"; pgoxxldb.com.


## IVs from the appraisal bars

Code: src/core/bars.js (readBars), src/core/ivs.js (solveIVs, rankByBars).

CP and HP alone often fit dozens of IV combinations, so the IVs come from the appraisal's three
bars, measured in pixels. Each bar has three segments of 5 points, and a pixel counts as filled
by its colour (orange, or red for a 15); the readings land within 0.15 of a whole number. Then
every combination of IVs and level that gives exactly the CP and HP read is ranked by its
distance to the bars. The bars decide; CP and HP confirm, and catch a misread number or the
wrong form (a screenshot says "Tornadus", not which Tornadus).


## Reading the card

Code: src/core/image.js (REGIONS, crops), src/core/read.js (parseWords, parseCrops),
src/core/pipeline.js (readScreenshot), src/ui/ocr.js (the workers).

- Text recognition is tesseract.js (Tesseract compiled to WebAssembly), run in your browser
  from files the site serves itself: about a second per screenshot, several in parallel.
- The game lays out its card from the screen's width, so every region is located in units of
  the width (the CP 0.13–0.19 widths from the top, the HP bar at 0.98, …): 19.5:9 and 16:9
  screens read alike. A wider screen, such as an iPad's, gets a 16:9 phone's layout as tall as
  the screen, centred; the card is read in that column.
- The whole screenshot gives the species and catch date ("This … was caught on …", matched
  with the game's own texts); close-ups of single regions give HP, weight, height, types and
  the size badge.
- The CP is a cross-check only: the page computes it from bars, HP and level, and takes a
  reading only when it fits (or is one digit off).
- The trainer or the sprite can hide digits ("62" for 1.62 m). A value the species can't have
  is repaired by putting digits back, picking the one that fits the other size, and the row is
  marked to check. Every value can be edited.


## Several screenshots, one Pokémon

Code: src/core/evaluate.js (canMerge, matchScore, mergeReadings).

The appraisal covers part of the card, so most Pokémon need a screenshot with it and one
without; a quick swipe through the storage often catches each one twice or more. Screenshots
merge into one row when nothing contradicts (HP, weight, catch date, species, …) and enough
agrees: HP and weight together are practically a fingerprint. When two rows fit about equally
well, the screenshot stays on its own: better a pair to merge by hand than a wrong merge. Each
value is taken from the screenshot that shows it intact.


## Game data

Code: src/core/gm.js (compactGameMaster), src/core/text.js, src/ui/gamedata.js.

Species sizes, base stats and the game's texts come from PokeMiners' game master and text
tables on GitHub. Your browser fetches them on the first visit and then about once a week,
compacts them (about 95 KB) and keeps them on your device. Nothing from the game is in this
repository. tools/build-gm.sh builds the same file on a server instead, so visitors' browsers
don't have to fetch it.


## Storage

Code: src/ui/db.js (IndexedDB), src/core/backup.js (cleanRow).

Screenshots are decoded, read and dropped in memory. IndexedDB keeps one row per Pokémon (the
readings, the user's edits, a JPEG thumbnail of the sprite area, about 2 KB) and the compacted
game data; scores are computed when shown, so new game data re-scores everything. A backup is
the same rows as one JSON file; on import every row goes through cleanRow, which keeps only known
fields of the right types. Browsers may delete stored data (Safari after 7 days without a visit),
hence the backup. A Content-Security-Policy in index.html lets the page load nothing but its own
files and the game data.
