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
| `tools/check.py` | Eight pre-flight checks. Run before committing; the hook runs it for you. |
| `tools/validate.js` | Gates perft and replays all 140 puzzles. Called by `check.py`. |
| `tools/stamp.py` | Writes the build id into `index.html` and `version.txt` together. |
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

It needs WebGL. Rendering, Practice, Competitive, the AI and all 140 puzzles need **no network at
all** — that is what vendoring three.js bought. The one exception is the online mode, which still
calls `api.github.com`; see below, it is being replaced.

## Check before committing

```
python tools/check.py
```

Eight numbered checks. The two that matter most need `node`: every `<script>` block
must parse **on its own** (Chrome loads three of them separately), and `validate.js`
must gate perft at **136 / 18479** and replay every line of all 140 puzzles through
the engine's own move generator. The rest catch absolute URLs, ids the script reaches
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

- **Play vs AI or hot-seat.** Selectable strength; "off" gives two-player local play.
- **Native 3D movement.** Every piece is generalized to three axes — see `ARCHITECTURE.md`.
- **11 themes.** default, wooden, silver, green, pink, lightblue, bw, red, purple, orange, american.
- **Coach mode.** 90 curated puzzles across 9 categories, 10 each, with hints and saved progress.
- **Puzzle generator.** 50 tactics mined from engine self-play, filtered by colour, game phase,
  and length. Every one is a real fork or combination that nets material — never a free-piece grab.
  **None of the 50 is a forced mate.** Older versions of these docs claimed otherwise; the `k` tag
  reads `win` on all fifty. Mates live in Coach mode's `mate` category instead.
- **Play online.** Trade turns with someone else. *Being rebuilt — see below.*

## Online play is being replaced

The online mode currently in this file stores each game as an issue in a private
GitHub repo, which means every player needs a GitHub account, collaborator
access, and a personal access token pasted into the game. That is far too much
to ask of a student, and the shared token has real problems besides: it lets any
player post moves into any other player's game, since the move reader validates
that a move is *legal* but never checks *who wrote it*.

It is being replaced with a room-code flow — type a name, get a four-letter code,
read it to your opponent — with optional Google or email sign-in for anyone who
wants a saved record. Until that ships, treat the online button as unsupported.

## Before you change anything

Read `MAINTENANCE.md`. Two things must stay true after every edit: the engine's
move generator and the display model's `legalMoves()` must agree (the perft
cross-check catches drift), and every embedded puzzle must still validate.
