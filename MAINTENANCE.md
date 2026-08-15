# Cubic Chess — Maintenance & Validation Guide

How to change the file without breaking it. The game is one self-contained HTML file, so edits are
direct — but two things must stay true after any change: the two rule implementations must agree
(perft), and every embedded puzzle must stay valid.

## Just run the suite

Everything below this section is now automated. `python tools/check.py` does it, the
pre-commit hook does it for you, and `tools/validate.js` replays all 140 puzzles
through the engine's own `make()` and `scoreAllRoot()` rather than through a third
implementation of the rules written to check the other two.

**A caution earned the hard way.** A check that has never failed is not a passing
check, it is an unproven one. All three content gates here were made to fail on
purpose before being trusted, and the third attempt was inert: it edited `TRI1`,
which `genMoves` never reads — line 780 spells that bound as a literal `26` for both
bishop and queen. The mutation looked like a rules change, changed nothing, and the
green result was the test's fault rather than the gate's. If you add a check, break
the thing it guards and watch it go red before you believe it.

The rest of this section explains what those checks do and how to run the pieces by
hand when you are diagnosing something.

## The golden checks (run after any change)

1. **Syntax.** Extract the main `<script>` and run `node --check` on it. A stray comma in the
   embedded `COACH_DATA` or `PUZZLE_LIB` will break the whole page silently otherwise.
2. **Perft.** Extract the engine block, load it in Node, and confirm `perft(1)=136`, `perft(2)=18479`
   from the start position.

   **This does NOT catch drift between the two rule implementations, and this document said for
   a long time that it did.** perft measures the ENGINE. The display model's `legalMoves()` — the
   rules the UI actually plays by — never executes during it, so the display model could have
   drifted arbitrarily and every check would still have been green. What perft catches is a change
   to the engine's own move generator.

   The drift check is `node tools/agree.mjs`, added later: it loads the real page headless with
   three.js and the DOM stubbed, uses the `?hooks` surface to reach `legalMoves()`, plays random
   games, and compares the FULL legal-move set from both implementations at every ply. Run by
   `check.py` as check 2b. Proven to catch a bishop losing its triagonals, a pawn losing its
   step up a level, and a board one file narrower — each mutated in the display model only.
3. **Puzzle validation.** Walk every Coach and library puzzle: each solution/reply move legal for
   the side on move, the final position matching its declared kind (real mate, or ≥2 material won),
   exactly one king per side, and (library) side-to-move parity matching the ply count.
4. **Smoke test in a browser.** Open it, play a few moves, cycle themes, solve one Coach puzzle and
   one generated puzzle of each length.

## Extracting the pieces for Node testing

The engine block is `<script id="cubicEngine" type="text/js-worker">…</script>`. To run it in Node,
pull that block out and neutralize its worker guard (`if (typeof importScripts === 'function'){` →
`if(false){`), then `eval` it and read `Engine`. Example:

```js
const fs = require('fs');
const html = fs.readFileSync('index.html','utf8');
const eng = /<script id="cubicEngine"[^>]*>([\s\S]*?)<\/script>/
  .exec(html)[1].replace("if (typeof importScripts === 'function'){","if(false){");
(0,eval)(eng);            // now `Engine` exists
Engine.reset();
console.log(Engine.perft(1,0), Engine.perft(2,0));   // expect 136 18479
```

To test the **display model** rules (`legalMoves`, `applyMove`, check/mate) independently of the DOM,
extract the main script and stub the browser bits (no `document`, no three.js) — during development
this was done with a small set of helper modules that re-exported the rules and a `buildRaw`
converter between a plain piece list and the engine's `bd/vg` arrays. Those helpers are not shipped
in the HTML; if you need them again, reconstruct them from the rules in the main script (they're a
thin wrapper: load a piece list into `board[]`, call `legalMoves`, and read results).

## Browser testing offline

Nothing to do — three.js is vendored as `three.min.js` beside the page, so the game already runs
with no network at all. Serve the directory (`python -m http.server`) rather than opening the file
directly: `localStorage` is unreliable over `file://`, so Coach progress and saved settings will not
persist in a `file://` test and you will chase a bug that does not exist. Then drive it with a
headless browser
(Chromium with `--use-gl=swiftshader --enable-webgl --ignore-gpu-blocklist`). Expose internals for
tests by appending assignments after a known line, e.g. after `let coachState = null;`:

```js
window.__coach = () => coachState;
window.__gen   = (c,p,l) => generatePuzzle(c,p,l,0);
window.__sel   = (x,y,z) => select(x,y,z);
window.__prop  = (x,y,z) => propose(x,y,z);
window.__commit= () => commitPending();
```

Prefer these direct hooks over clicking through the UI — overlay/animation timing makes pure-click
tests flaky (a harness problem, not a game bug).

## Common tasks

### Add or edit a theme
`THEMES` is an object of named palettes near the top of the main script. Copy an existing entry,
rename it, adjust the colour values (pieces, board `tileDark`/`tileLight`, optional per-tile
opacity, level-fade). `applyTheme(name)` and the theme picker pick it up automatically. Verify by
cycling every theme (the regression check calls `applyTheme` for each) and eyeballing piece-vs-board
contrast — the tension is that lighter pieces read nicer but can lose contrast against light tiles.

### Edit a Coach puzzle
Find its entry in `COACH_DATA.cats.<key>.puzzles`. Keep the shape
`{pieces:[{t,c,x,y,z,m?}], side, sol:[[...]], reply?:[[...]]}`. After editing, re-run puzzle
validation — an illegal solution move or a "mate" that isn't mate will pass syntax but fail the
check.

### Add puzzles to the generator library
Append entries to `PUZZLE_LIB` in the compact shape
`{p, s, sol, rep?, k, ph, len, ply}` (see PUZZLES.md). Keep `ph`/`len`/`s` accurate — the filters
read them. Validate before shipping. New puzzles should be produced by the self-play mining
approach (real games with realistic errors), not placed by hand, so they stay legal and natural.

### Change movement rules or piece values
This is the highest-risk change: you must update **both** the engine's move generator and the
display model's `legalMoves`, keep them identical, and then **re-derive the perft numbers** (the old
136/18479 will no longer apply). Any previously-mined or curated puzzle may become invalid — re-run
full puzzle validation and expect to regenerate content.

## Ship checklist

- [ ] `node --check` on the main script passes
- [ ] `perft(1)=136`, `perft(2)=18479` (or the new correct numbers if rules changed)
- [ ] All Coach + library puzzles validate (legal lines, correct outcomes, parity, two kings)
- [ ] All 11 themes apply without error
- [ ] Browser smoke test: play, theme-cycle, solve one Coach + one generated puzzle per length
- [ ] `three.min.js` is present beside `index.html` and the tag still reads `src="three.min.js"` —
      no CDN URL has crept back in
