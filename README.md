# Cubic Chess

Three-dimensional chess on an 8×8×8 cube. Pawns advance forward *or* up a level,
bishops ride true triagonals and reach every one of the 512 cells, rooks slide
straight up through the floors. One self-contained HTML file with a full search
engine, an AI opponent, 11 themes, and 140 engine-verified puzzles.

**Play it: https://acespartiate.github.io/cubicchess/**

## What's here

| File | What it is |
|------|------------|
| `index.html` | The entire game — markup, styles, engine, and all puzzle data. |
| `three.min.js` | three.js r128, vendored. See below. |
| `tools/check.py` | The pre-flight checks. Run before committing; the hook runs it for you. |
| `tools/validate.js` | Gates perft and replays all 140 puzzles. Called by `check.py`. |
| `tools/test-rules.mjs` | 148 cases against the database rules. Offline. Called by `check.py`. |
| `tools/test-tutorial.mjs` | Walks every tutorial step through the real move generator. Called by `check.py`. |
| `tools/calibrate-sim.mjs` | Pins the evaluator to verdicts recorded from the live project. |
| `tools/test-rules-live.py` | The same ground against the real database. Run after publishing rules. |
| `tools/sim.mjs` | A Realtime Database rules evaluator that does multi-path writes properly. |
| `tools/stamp.py` | Writes the build id into `index.html` and `version.txt` together. |
| `firebase/` | The database rules and the project config. |
| `FIREBASE.md` | Setting the backend up, and the five console traps found the hard way. |
| `ARCHITECTURE.md` | Coordinate system, movement rules, engine API, rendering, file layout. |
| `PUZZLES.md` | How Coach mode and the puzzle generator work, and how the puzzles were produced. |
| `MAINTENANCE.md` | How to change the file without breaking it: the validation harness and regression checks. |

## Running it

Open the link above. Nothing to install.

To run it locally, **serve the folder** rather than double-clicking the file:

```
python -m http.server 8131
```

then open `http://localhost:8131/`. `localStorage` is unreliable over `file://`,
so opening `index.html` directly will silently fail to save Coach progress and
settings — and you will spend an afternoon chasing a bug that is not there.

It needs WebGL. Rendering, Play, Coach, the AI and all 140 puzzles need **no network at
all** — that is what vendoring three.js bought. Only online play reaches out, and when it cannot,
the game says **Offline Play Only** and the other three modes carry on.

## Check before committing

```
python tools/check.py
```

Numbered checks. The three that matter most need `node`: every `<script>` block
must parse **on its own** (Chrome loads three of them separately), and `validate.js`
must gate perft at **136 / 18479** and replay every line of all 140 puzzles through
the engine's own move generator. The third walks every first-time-tutorial step through
that same generator: a step asking for a move that is not legal in the position it set up
can never be satisfied and never be skipped, and it reaches a child as a sentence telling
them to do something that does nothing. The rest catch absolute URLs, ids the script reaches
for that the markup does not have, unbalanced storage keys, a missing `three.min.js`,
and a build stamp that disagrees with `version.txt`. Each check skips loudly rather
than vanishing when its tool is absent.

You do not have to remember to run it. `.githooks/pre-commit` runs it and refuses the
commit if anything fails. It is tracked, so it travels with the repo, but git has to
be pointed at it **once per clone**:

```
git config core.hooksPath .githooks
```

`git commit --no-verify` gets past a failure on purpose.

Before deploying, stamp the build so a cached copy can notice it is stale:

```
python tools/stamp.py
```

That writes the same id to `index.html` and `version.txt`. Committing one without the
other is a check failure, not a surprise in a fortnight.

## Hosting

`index.html` is at the repository root, so GitHub Pages serves it with
**Settings → Pages → Deploy from a branch → `main` / `/root`**. Pages needs the
repo public on a free account.

## three.js is vendored on purpose

three.js r128 used to load from cdnjs. It is now committed as `three.min.js` and
loaded with a relative tag. The reason is students: a school content filter that
blocks the CDN gives them a blank board and no error message, and the failure
looks exactly like a broken game. The file is 603KB, it never changes, and it
removes the last thing about this page that could fail for reasons outside the
repository.

**Do not restore the CDN tag.** If you upgrade three.js, replace the file and
re-run the checks in `MAINTENANCE.md`.

## What the game does

- **A tutorial the first time you play each game.** Asked once per game, not once per
  player — knowing the cube inside out tells you nothing about traditional chess here,
  and vice versa. Some steps hold the board until you make the move they describe.
  It teaches **all six pieces**, for a player who has never played any chess. Steps that
  need one build their own position: a rook on a full opening board has no legal moves at
  all, which is why the earlier version could only ever explain what happens to be legal
  on move one.
- **Three buttons.** Play, Coach, Play online. Which game you play is the next screen,
  so a new variant never adds a button. Two taps to a board.
- **Play vs AI or hot-seat.** Selectable strength; "off" gives two-player local play.
- **Native 3D movement.** Every piece is generalized to three axes — see `ARCHITECTURE.md`.
- **11 themes.** default, wooden, silver, green, pink, lightblue, bw, red, purple, orange, american.
- **Coach mode.** 90 curated puzzles across 9 categories, 10 each, with hints and saved progress.
- **Puzzle generator.** 50 tactics mined from engine self-play, filtered by colour, game phase,
  and length. Every one is a real fork or combination that nets material — never a free-piece grab.
  **None of the 50 is a forced mate.** Older versions of these docs claimed otherwise; the `k` tag
  reads `win` on all fifty. Mates live in Coach mode's `mate` category instead.
- **Play online.** Type a name, tap **Start a game**, read the four letters out.
  Your opponent taps **Join** and types them in. No account, no password, no email.

## Online play

Four letters, read aloud. Behind it: an anonymous Firebase token so the database
rules have something to check, and one append-only string of moves — seven octal
digits per ply, because 8⁷ is exactly 2²¹ and `encodeMove()` already yields a
21-bit integer. `firebase/database.rules.json` is the whole security boundary and
`FIREBASE.md` explains every clause.

Moves arrive over Server-Sent Events, with a 3-second poll as the fallback: SSE is
ordinary HTTPS on 443, and a WebSocket upgrade is the part school proxies get wrong.

Finished games are counted in the browser: five characters each, the room code plus
W, L or D, shown on the online panel. No account, no server node, nothing anyone else
can read. The code is stored so that a reload cannot count a game twice.

**With no connection the button reads "Offline Play Only"** and says so plainly. Play
and Coach need no network at all, so two of the three buttons carry on working and the
game does not pretend otherwise.

Practice and Competitive used to be two of four buttons on the home screen, which meant
choosing before you had seen a board and restarting to change your mind. They were only
ever three things — undo, the hint button, and threat markers — so they are one switch in
Settings now, on by default, flippable mid-game. Online still forces them off: undo
cannot mean anything once the other player has seen the move.

The previous mode stored each game as an issue in a private GitHub repo, needing an
account, collaborator access, and a personal access token pasted into the game by
every player. It is gone. Besides the signup burden it let any player post moves
into any other player's game, because the reader checked that a move was *legal*
and never *who wrote it* — and it kept a live token in plaintext in `localStorage`
on shared devices. Loading the game now deletes that key.

## Before you change anything

Read `MAINTENANCE.md`. Two things must stay true after every edit: the engine's
move generator and the display model's `legalMoves()` must agree (the perft
cross-check catches drift), and every embedded puzzle must still validate.
