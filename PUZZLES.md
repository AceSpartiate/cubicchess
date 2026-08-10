# Cubic Chess — Puzzle Systems

There are two puzzle systems: **Coach mode** (90 curated puzzles) and the **generator**
(a 50-puzzle library mined from engine self-play, served instantly with filters). Both use the
same solving UI and the same move/promo encoding.

## Move encoding used by both systems

A solution move is `[fx, fy, fz, tx, ty, tz, promo?]` — from-square, to-square, and an optional
promotion code (`5=q, 4=r, 3=b, 2=n`; `0` or absent = no promotion). Multi-move puzzles also carry
an opponent **reply** list in the same format; when the player makes the correct move, the game
auto-plays the scripted reply before asking for the next move.

## Coach mode

### Data shape

`COACH_DATA` is embedded in the main script:

```
COACH_DATA = {
  order: [openings, piece_p, piece_n, piece_r, piece_b, piece_q, piece_k, forks, mate],
  cats: {
    <key>: {
      label, tip,
      puzzles: [ { pieces:[{t,c,x,y,z,m?}], side:'w'|'b', sol:[[...]], reply?:[[...]] }, ... ]
    }
  }
}
```

9 categories × 10 levels = **90 puzzles**. Each puzzle lists its pieces, whose move it is, the
solution line, and (for multi-move puzzles) the scripted opponent replies.

### What each category teaches

- **openings** — developing moves toward the centre and upper levels (knight/bishop/queen posts).
  Every position is reachable by real alternating play (correct move-count parity), a mix of
  white-to-move and black-to-move.
- **piece_p / piece_n / piece_r / piece_b / piece_q** — "using your <piece>". Each uses that piece
  but mixes **motifs**: captures plus, respectively, pawn promotions, knight leaps between levels,
  and rook/bishop/queen skewers, so the ten levels aren't repetitive.
- **piece_k** — king play: escape a check by capturing the checker, or stepping up / down a level.
- **forks** — knight, rook, pawn, queen forks, plus two multi-move forks (a check that forces the
  king, then a fork), including royal forks.
- **mate** — mate delivered by different pieces and patterns: queen, rook, bishop (along a
  triagonal, crossing levels), knight, and pawn.

### Solving flow (functions in the main script)

- `startPuzzle(cat, lvl)` loads a puzzle: clears the board, places the pieces, sets `turn` to the
  puzzle's side, and shows the banner ("White/Black to move").
- `coachHandleMove(mv)` checks the move against the solution: a wrong move is rejected with
  "try again" (board unchanged); a correct move is played, the scripted reply (if any) auto-plays,
  and on the last step it shows "Solved!" and marks progress.
- `requestHint()` in Coach mode previews the correct move for the current step (it reads the
  known solution, not an engine search).
- Progress persists in `localStorage['cc_coach']`. The category screen shows "X / 90 solved" and
  has a **Reset all progress** button (`resetCoach()`), which asks for a confirm click.

## The generator (real-game library)

### Why a library instead of live generation

Clean tactics are genuinely rare in real games on a 512-cell board. On-demand mining took roughly
13 seconds per game for about half a usable puzzle — far too slow to make a player wait. So puzzles
were **pre-mined offline** and embedded; the button serves them instantly. This mirrors how real
puzzle sites work (they serve from a database).

### How the puzzles were produced

1. **Two engines play a full game** from the standard start, at "club strength": mostly good moves
   with a realistic error rate (occasional clearly-sub-optimal moves — *not* hung pieces). Because
   the whole game is real alternating play, **every position is legal and its side-to-move parity is
   correct by construction** — this is what eliminated the earlier "white moved twice" bug.
2. **Positions right after a mistake** are examined. If the side to move has a clearly-best move
   (verified by a deeper engine search) whose forced line ends in mate or a stable material win of
   the requested length, it's a candidate.
3. **The tactic is classified** and boring cases are rejected. A puzzle is kept only if it's a
   fork, a multi-move combination, or a forced mate — never "capture the free piece sitting en
   prise". Each kept puzzle records how many moves into the game it occurred (its phase) and whose
   move it is (its colour).

### Library data shape

`PUZZLE_LIB` is embedded in the main script; entries are compact:

```
{ p:[{t,c,x,y,z,m?}],  // pieces
  s:'w'|'b',           // side to move (solver)
  sol:[[...]],         // solution moves
  rep?:[[...]],        // scripted opponent replies (multi-move only)
  k:'mate'|'win',      // kind
  ph:0|1|2,            // phase: 0 early(1-10) / 1 mid(11-20) / 2 late(21+)
  len:1|2|3,           // solution length
  ply:<number> }       // exact moves into the game
```

Current library: **50 puzzles** — 23 one-move, 17 two-move, 10 three-move; 27 White-to-move,
23 Black-to-move; 6 early / 10 middle / 34 late.

### Serving and filters

`generatePuzzle(colorFilter, phase, wantLen)` filters the library by length + phase + colour and
returns a random match instantly (in coach-puzzle format, via `startGeneratedPuzzle`). If nothing
matches the exact phase/colour it relaxes gracefully (phase first, then colour) and the UI tells the
player it loaded the closest available match. The three UI controls are colour (White / Black /
Random), phase (Early 1–10 / Middle 11–20 / Late 21+), and length (One / Two / Three moves).

Generated puzzles solve through the same Coach flow (wrong-move retry, auto-played replies, "Solved!"),
show "White/Black to move", and support the Hint. They don't count toward the 90-puzzle Coach
progress.

## Validation — every puzzle was checked

No puzzle shipped without passing an engine check:

- **Legality:** every move in the solution (and every scripted reply) is legal for the side on move.
- **Outcome:** "mate" puzzles are a real mate at the stated length; "win" puzzles genuinely net ≥2
  material that the opponent can't immediately win back.
- **Integrity:** exactly one king per side; and for library puzzles, side-to-move parity matches the
  move count (the specific bug that was fixed — verified 0 violations across all 50).

MAINTENANCE.md contains the exact validation approach so you can re-run it after editing puzzles.

## Growing or regenerating the library

The mining pipeline (self-play → error injection → tactic detection → classification → validation)
is not embedded in the shipped HTML; it was a set of Node scripts run offline against the extracted
engine and rules. To grow the library you re-run that mining to produce more validated entries and
append them to `PUZZLE_LIB`. Practical notes:

- Mining is slow and yields unevenly — expect it to skew late-game and toward material-winning
  combinations. Early-game and pure-fork puzzles are the scarcest.
- Keep the compact entry shape above, keep the `ph`/`len`/`s` tags accurate (the filters depend on
  them), and re-run full validation before embedding.
- If you change the movement rules or piece values, previously-mined puzzles may no longer be
  correct — re-validate the whole library.
