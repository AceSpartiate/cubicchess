# Cubic Chess — Architecture Reference

Everything lives in one file, `index.html`. This document is the map.

## File layout

The HTML contains three `<script>` blocks:

1. **`<script id="cubicEngine" type="text/js-worker">`** — the search engine (alpha-beta). Its
   `type` is `text/js-worker` so the browser does not execute it as a normal script; instead the
   main script turns its source into a Web Worker (or runs it inline as a fallback). This lets the
   AI think without freezing the UI.
2. **three.js** — r128, **vendored** as `three.min.js` beside the page and loaded with
   `<script src="three.min.js">`. It used to come from cdnjs; a school content filter blocking
   the CDN left students with a blank board and no error message, so the file now travels with
   the repo. Nothing about **rendering** touches the network any more.

That leaves exactly one external host, and no doc in this package used to admit it: the online
mode calls **`api.github.com`** from `ghFetch()` (line 2772), authenticating with a Bearer token
and polling every 5 seconds while a game is live. It is the only `fetch` in the file. Both README
and this document once said three.js was the sole external dependency; that was never true, and an
"offline build" made by following the old instructions would still have phoned home.
3. **The main script** — the display model (rules the UI uses), rendering, input handling, themes,
   Coach mode, and the puzzle generator/library.

There are two independent implementations of the movement rules: the **engine's** internal board
(bitboard-ish arrays, used for search) and the **display model's** `legalMoves()` (used by the UI
and by validation). They must agree; the perft cross-check exists to catch drift between them.

## Coordinate system

A cell is addressed by three axes:

- `x` = file, 0–7
- `y` = level, 0–7 (0 is the floor / level 1, 7 is the top / level 8)
- `z` = rank, 0–7

Flat index into the 512-cell board array:

```js
const ID = (x,y,z) => x + 8*y + 64*z;   // x=file, y=level, z=rank
```

World-space position for rendering (board centered on origin):

```js
const W = (x,y,z) => new THREE.Vector3(x-3.5, y-3.5, z-3.5);
```

Pieces are dropped slightly toward the tile with `FLOOR_OFF = -0.46` so they sit on the square
rather than floating at its center.

## Piece encoding

Engine board cells use `TYCODE` with a colour bit:

```js
const TYCODE = {p:1, n:2, b:3, r:4, q:5, k:6};   // black = value | 8
```

The display model represents pieces as objects: `{type, color, moved, group, id}` where `type`
is `'p'|'n'|'b'|'r'|'q'|'k'`, `color` is `'w'|'b'`, `moved` tracks first-move rights, and `group`
is the three.js mesh.

Piece values (used by the engine's static eval and by puzzle classification):
`p=1, n=6, b=11, r=6, q=18, k=100` (king value is a sentinel; it is never actually captured).
Note bishops are worth more than rooks here — in 3D a bishop reaches every cell in the cube, which
makes it unusually strong.

## Movement rules (native 3D)

These are the rules both the engine and `legalMoves()` implement.

- **Pawn.** Moves one step **forward** (increasing `z` for White, decreasing for Black) **or one
  step up a level** (`y+1`). Captures on any forward diagonal (the `z±1` layer, any `x`/`y` offset
  of ±1). Promotes on reaching the far rank (`z=7` White / `z=0` Black) on **any** level.
- **Knight.** The 3D generalization: all permutations of a (2,1,0) offset with independent signs →
  24 destinations. Leaps between levels.
- **Bishop.** Rides face-diagonals **and** true triagonals (all offsets where the non-zero
  components are equal magnitude). Over an empty board it can reach every one of the 512 cells.
- **Rook.** Slides along a single axis at a time: ±x, ±y, ±z — 6 ray directions, including straight
  up and down through the levels.
- **Queen.** Rook + bishop = 26 directions.
- **King.** One step in any of the 26 directions. Castling exists along the floor rank.

## The search engine (inside `#cubicEngine`)

Alpha-beta with transposition table, killers, and history heuristic. Constants:
`INF = 1e9`, `MATE = 900000` (a forced mate scores `MATE - ply`, so shorter mates score higher).

Key API the main thread uses (via the worker, or via the inline fallback `ensureInline()`):

- `reset()` — restore the standard opening position in the engine.
- `loadRaw(bd, vg, side)` — load an arbitrary position. `bd` is an `Int8Array(512)` of `TYCODE`
  values (`|8` for black), `vg` is a `Uint8Array(512)` virgin/first-move flags, `side` is `0`=White
  / `1`=Black to move.
- `scoreAllRoot(depth)` → `[{m, s}, ...]` — every **legal** root move with its search score. Moves
  that leave the mover's own king in check are filtered out. Used everywhere puzzles are analyzed.
- `chooseMove(...)` — pick the AI's move.
- `perft(depth, ply)` — count leaf nodes; the correctness cross-check.

Encoded move `m`: `from = m & 511`, `to = (m>>9) & 511`, `promo = (m>>24) & 7` (promo code
`5=q,4=r,3=b,2=n`). Decode a packed square with `{x: s&7, y: (s>>3)&7, z: s>>6}`.

The main thread builds a position for the engine with `exportPosition()` (from the live `board[]`
and `turn`), or the puzzle code builds `bd`/`vg` arrays directly from a piece list.

### Perft sanity numbers

From the standard start: **depth 1 = 136**, **depth 2 = 18,479**. Re-run after any rules or engine
change; if these move, the two rule implementations have diverged.

## The display model (main script)

- `setupBoard()` — place the 32 starting pieces into `board[]` and set `turn='w'`.
- `legalMoves(x,y,z)` — legal destinations for the piece on that square, honoring check. This is
  the UI's and the validator's source of truth for rules.
- `applyMove(fx,fy,fz, tx,ty,tz, animate, promo)` — mutate `board[]`, handle capture, castling,
  and promotion (`promo` is a type string like `'q'`; on the far rank it promotes, defaulting to
  queen), and move/replace the mesh.
- `inCheck(color)`, and check/mate detection used for status and for puzzle validation.

Game state globals include `board[]` (512 cells), `turn`, `selected`, `history`, `captured`,
`gameOver`, and `coachState` (non-null while a puzzle is active).

## Rendering

three.js scene with an orbit-style camera. The board is an 8×8×8 lattice of translucent tiles plus
grid lines; upper levels are drawn very faint so you can see into the cube, with the floor solid.
Grid lines use additive blending and a small z-lift to avoid the z-fighting that otherwise produced
dark seams at grazing angles. Pieces are simple built meshes tinted by the active theme.

`THEMES` is an object of 11 named palettes (default, wooden, silver, green, pink, lightblue, bw,
red, purple, orange, american). `applyTheme(name)` recolors pieces, retints board tiles (including
per-tile opacity and the level-fade factor), and updates trims. The home-menu board is themed too.

## Input flow

Click selects a piece (`select`), shows its legal destinations, and — depending on the "preview"
toggle — either moves immediately or stages a pending move you confirm (`propose` / `commitPending`).
When `coachState` is active, moves are routed to the Coach handler instead of the normal game flow,
and the AI/online guards are bypassed so you can play whichever side the puzzle asks for.

See PUZZLES.md for Coach mode and the generator, and MAINTENANCE.md for how to validate changes.
