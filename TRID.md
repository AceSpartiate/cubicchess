# Tri-dimensional chess — the ruleset, and why

Researched 16 Aug 2026 across three parallel sweeps. This file exists because the
research cost more than the code will, and because **our implementation is the
reference**: cubic chess is guarded by two independent implementations agreeing, and
traditional chess by published perft, but tri-D has neither. No perft numbers exist for
any tri-D ruleset, and the Worker engine is cubic-only. Nothing will catch us being
wrong except this document.

## The ruleset is Meder

Zach chose W3DCF first, on my description of it as "Bartmess plus tournament
clarifications." **That description was wrong**, and the correction is the main finding
of the research:

- **"W3DCF" and "Standard Tournament Rules" are two different things.** W3DCF's laws are
  the *Hawkins rules* (attributed to RAF Flying Officer John Hawkins, 1992) — an
  independent ruleset, not Bartmess with amendments.
- W3DCF puts a **rook and a knight** on each attack board, main rear rank B-Q-K-B.
  Bartmess and Meder put a **rook and the queen or king** there, main rear rank N-B-B-N.
  Different games from move zero.
- W3DCF's movement is *step-and-shift*: walk the horizontal path, and at any intermediate
  point shift to an unoccupied square directly above or below **the next square on the
  path**, then continue. Vertical travel within a move is one-directional. That is not
  Meder's "your 2D move on the projection, land where you like."

Three things ruled W3DCF out for this project specifically:

1. **It never states the blocking rule.** The complete Laws were read; there is no
   sentence resolving whether a piece on another level blocks a sliding line. Evidence
   points both ways. That single question decides every legal-move list.
2. **The Laws are edited in place, with no version number and no changelog.** The core
   movement rule was materially rewritten between the June 2021 and June 2023 captures:
   "above or below **the intermediate point**" became "above or below **the very next
   square on the path**". Those are different geometries. A future reader could not tell
   whether we implemented it wrong or it moved under us.
3. **There is nothing to validate against.** No worked examples, no sample game, no
   diagrams, no FAQ. Provenance is one self-published site making uncorroborated claims
   of RAF and US Navy adoption.

Bartmess was never obtainable: *Federation Standard 5.0* is a printed booklet sold by
post, his own site is dead, and the two surviving second-hand descriptions contradict
each other precisely on blocking.

**Meder is the only one of the three that can be implemented correctly.** Numbered
articles, an explicit notation, blocking stated outright, vertical-only moves explicitly
forbidden, non-existent squares handled by name.

## Geometry — all three rulesets agree

This part is the physical board, so nothing above changes it.

Meder's notation is files `z a b c d e`, ranks `0`-`9`, levels `W`/`N`/`B`, and
attack-board pins `QL1`-`QL6` / `KL1`-`KL6`. Our lattice maps it as:

| Meder | ours |
|-------|------|
| file z a b c d e | `x` = 0 1 2 3 4 5 |
| rank 0-9 | `z` = 0-9 |
| level | `y`, see below |

Five `y` levels, because the attack boards sit between the main boards and a lattice
needs somewhere to put them:

| `y` | what | squares |
|-----|------|---------|
| 0 | White's Board (W) | files a-d, ranks 1-4 |
| 1 | White's attack boards QL1, KL1 | files z,a and d,e — ranks 0-1 |
| 2 | Neutral Board (N) | files a-d, ranks 3-6 |
| 3 | Black's attack boards QL6, KL6 | files z,a and d,e — ranks 8-9 |
| 4 | Black's Board (B) | files a-d, ranks 5-8 |

The three main boards are 4×4, offset by exactly half a board (2 ranks), so the plan view
is 8 ranks by 4 files. Attack boards are 2×2. **64 squares** in the starting arrangement
(3×16 + 4×4), inside a 6×5×10 bounding box of 300 — so most of the box is air, which is
what `V.inside()` is for and why the renderer was taught about holes first.

An attack board's inner-forward square sits directly above (White) or below (Black) the
main board's corner square, so `a1` names two distinct squares at two levels. That is
correct and not a bug.

## Movement, per Meder

Verbatim article numbers are his.

- **3.1(a)** A move is the ordinary 2D move applied to the **vertical projection**, and
  the landing level is a **free choice** — every overlapping square is the same colour.
- **3.1(c)** A piece on any individual square **blocks at all levels**: the projection
  column is blocked. But the moving piece may land above or below the occupied square.
  So a blocker stops the line *through* its column while leaving that column landable.
- **3.1(b)** Destination obstruction is **level-specific**: you may not land on a
  same-level friendly piece, but you may land above or below one.
- **3.1(d)** Purely vertical moves are **forbidden** — a piece may not move to the same
  square on another level.
- **3.1(e)** A move may **pass over** a non-existent square but may not **end** on one.
- **3.3** Knights jump, are defined on the projection, and choose their landing level.

## The opening has 20 moves, and that is the finding

With the attack boards **pinned**, White's opening position yields exactly 20 legal
moves: 16 pawn moves and 4 knight moves. Nothing else on the board can move at all.

That is not a bug, and `tools/test-trid.mjs` asserts it. It falls out of the geometry:

- Files `z` and `e` exist **only** on the attack boards, at ranks 0-1 and 8-9. A pawn
  standing on `z1` has no square ahead of it at any level, because `z2` does not exist.
- The two attack-board pawns that *do* have a square ahead (`a1`, `d1`) are blocked by
  White's own main-board pawns standing on it.
- Every piece on an attack board — both rooks, the queen, the king — is walled in by its
  own neighbours, and the queen's long diagonals run straight into friendly pieces.

So **attack-board movement is not an optional extra; it is the game.** Meder's boards
move precisely because a static tri-D board is this cramped. Phase 1 is a correct and
verifiable implementation of a position that a real game leaves almost immediately.

The count is recorded in the test so that a change to the generator has to be deliberate.
It is not ground truth — nothing here is — but it is the most this variant can be given
until a Meder-legal game record turns up to check against.

## What is still open

- **Pawn direction, promotion rank and the double step** were not settled by this sweep.
  They are asked for before attack boards move, because a moving board can carry a pawn.
- **Attack board movement** — the pin graph, who may move a board, how many pieces may
  ride — is deliberately out of scope for phase 1 and unresearched here.
- **Nothing to test against.** The one piece of move-level ground truth found anywhere is
  Bartmess's own 35-move sample game, which is a different ruleset and so cannot validate
  Meder. If a Meder-legal corpus is ever found, it belongs in a `tools/test-trid.mjs`.

## Do not confuse it with

A fourth, unrelated fan ruleset (Michael Grant's) permits purely vertical moves — "the
bishop may also move vertically straight up or down" — and is not any of the three above.
