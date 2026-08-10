# Firebase setup — the multiplayer backend

Fifteen minutes, once, ever. No credit card. Do it in a browser signed in as
**zach.w.taylor.88@gmail.com** — a personal account, deliberately, not the district
one. Two reasons: Google Workspace for Education commonly blocks staff from creating
third-party projects, and a project owned by a school account dies when that account
is deprovisioned, taking online play with it.

Nothing here runs on your PC. Nothing here costs money at this scale.

---

## 1. Create the project

1. Go to **console.firebase.google.com** and confirm the account chip, top right, says
   the gmail. If it says the district address, sign out and back in — getting this
   wrong is the one mistake in this document that is annoying to undo.
2. **Create a project**. Name it `cubic-chess`. The project *id* it generates
   (something like `cubic-chess-4a1c7`) is what matters later; write it down.
3. **Turn Google Analytics OFF.** The toggle is on by default. It is the only step
   here that would start collecting anything about the people playing, it buys this
   project nothing, and leaving it on would make the data-privacy note in step 7
   untrue.

## 2. Realtime Database — not Firestore

Firebase offers two databases and the console pushes you toward the other one.

1. Left sidebar → **Build** → **Realtime Database**. (If you land on "Firestore
   Database", you are in the wrong product — go back.)
2. **Create Database**.
3. Location: **United States (us-central1)**.
4. **Start in locked mode.** Not test mode. Test mode grants the world read and write
   for 30 days and then silently stops working; locked mode denies everything until
   the rules in step 3 replace it, which is the correct starting point.
5. Copy the URL shown at the top — `https://cubic-chess-xxxxx-default-rtdb.firebaseio.com`
   or `...firebasedatabase.app`. Write it down.

## 3. Publish the rules

1. **Rules** tab, inside Realtime Database.
2. Select everything in the box and replace it with the contents of
   **`firebase/database.rules.json`** from this repo.
3. **Publish.**

That file is strict, comment-free JSON on purpose. In RTDB rules **any key that does
not start with a dot is a child path and must map to an object**, so a `"// note":
"text"` pair — the obvious way to annotate — is rejected by the console with
`Line N: Expected '{'`. It shipped that way once. `tools/check.py` check 8 now walks
the file and fails on any child path that is not an object, so it cannot happen again.
The annotation that used to live in the file is the section below instead.

### What each clause is doing

| Where | Clause | Stops |
|---|---|---|
| `$code` `.write` | `!data.exists() \|\| createdAt < now - 24h` | writing to an existing room through the create grant; lets a day-old code be recycled |
| `$code` `.validate` | `data.exists() \|\| !newData.hasChild('moves')` | **seeding a brand-new room with a fabricated move list.** The create grant cascades to every child, so without this every per-move rule below could be skipped by writing the whole room at once |
| `seats/$c` `.write` | `!data.exists() \|\| uid === auth.uid \|\| lastSeen < now - 90s` | stealing a seat someone is actively sitting in; still allows reclaiming one dark for 90 seconds |
| `seats/$c` `.write` | the trailing `w`/`b` cross-check | one uid holding **both** seats — two tabs on one Chromebook |
| `moves/$ply` `.write` | `!data.exists()` | overwriting or reordering a played move; also makes retries idempotent, so a failed send can safely be resent |
| `moves/$ply` `.write` | seated-uid check | a third party who knows the code writing moves into your game |
| `moves/$ply` `.write` | `lastUid !== auth.uid` | **moving twice in a row.** `root` is pre-write state, so this reads "the last person to move was not me" |
| `moves/$ply` `.validate` | `newData.root()...lastUid === auth.uid` | dodging the above by never updating `lastUid` — forces it into the same atomic write |
| `moves/$ply` `.write` | `$ply !== '0' \|\| w seat is me` | black playing the opening move, when no `lastUid` exists yet |
| `v` `.validate` | `0 … 2097151` | a move integer outside the 21 bits `encodeMove()` produces |
| `$other` everywhere | `false` | inventing new fields anywhere in the tree |

What they deliberately do **not** stop is an illegal *chess* move — no rules language
can play chess. That stays where it is: every inbound move is replayed through
`legalMoves()` before it lands.

These rules are the entire security boundary. There is no server, so nothing else
stands between a student and the database. They stop: enumerating rooms, writing
without auth, taking an occupied live seat, holding both seats yourself, overwriting
or reordering a played move, moving twice in a row, black playing first, writing an
out-of-range move number, forging a uid or a timestamp, names over 12 characters,
adding unknown fields anywhere, and touching another player's stats.

They do **not** stop an illegal chess move — no rules language can play chess. That
stays where it already is: every inbound move is replayed through `legalMoves()`
before it lands, so a forged move stops the board at the last legal position.

### Test them before trusting them

**Rules Playground**, on the same page. These rules have never run against a real
project, so treat them as unproven until these five cases behave:

| Simulate | Location | Expect |
|---|---|---|
| Write, authenticated | `/rooms/WXKB/seats/w` | **Allow** (room does not exist yet) |
| Read, unauthenticated | `/rooms/WXKB` | **Deny** |
| Write, authenticated as a different uid | `/rooms/WXKB/seats/w` when the seat is held and fresh | **Deny** |
| Write, authenticated as the seated uid | `/rooms/WXKB/moves/12` with 12 empty | **Allow** |
| Same write again | `/rooms/WXKB/moves/12` now occupied | **Deny** |

If any of those disagree, stop and tell me rather than working around it — a rule
that fails open is worse than no rule, because it looks fine.

## 4. Turn on Anonymous sign-in

1. Left sidebar → **Build** → **Authentication** → **Get started**.
2. **Sign-in method** tab → **Anonymous** → **Enable** → **Save**.
3. Enable **nothing else** for now. Google sign-in is a later, optional phase and it
   needs a district admin to allowlist the app before students can use it.

"Anonymous" is what makes the room-code flow work: the game silently obtains a token
so the rules have a `uid` to check, with no signup, no email and no password. It is
the closest honest version of "the game makes the account behind the scenes."

## 5. Register the web app and collect two strings

1. Gear icon → **Project settings** → **General**.
2. Under **Your apps**, click the web icon **`</>`**.
3. Nickname `cubic-chess`. **Do not** tick "Also set up Firebase Hosting" — GitHub
   Pages already hosts this.
4. It shows a `firebaseConfig` block. I need exactly two values from it:
   - `apiKey`
   - `databaseURL`

Send me those two. **They are not secrets.** Firebase web API keys are designed to
sit in public HTML — they identify the project, they do not authorise anything. The
rules are what authorise. This key will be committed to the public repo, which is
normal and expected for this product.

## 6. Add a second Owner

**Project settings → Users and permissions → Add member.** Add a second address you
control, role **Owner**.

Ninety seconds, and the highest-value item on this page. Google deletes projects that
look abandoned and warns the owner by email first. One owner is one mailbox between
this project and silent deletion.

## 7. Tell the district — two sentences, not paperwork

Email whoever handles instructional technology or data privacy:

> I'm using a free Firebase project to let students play a chess game against each
> other in the browser. It stores a four-letter room code, a nickname the student
> picks, an anonymous device token, and the list of moves — no names, no email
> addresses, no logins, and nothing that touches a grade.

This turns "a teacher deployed an unapproved tool" into "a teacher disclosed a no-PII
tool." It is a paper trail, not a process.

**One decision to make before the first game, because it changes the answer above:**
if a win/loss record ever feeds a grade, it becomes an education record under FERPA
and belongs in the gradebook, not here. Keep it ungraded and this stays simple.

---

## What you will have when you are done

```
project id     cubic-chess-xxxxx
databaseURL    https://cubic-chess-xxxxx-default-rtdb.firebaseio.com
apiKey         AIza...
Realtime Database   locked mode, rules published
Authentication      Anonymous only
Owners              two
```

Record the first three in this file when they exist, so the next person — including
you in a year — does not have to go looking in a console to find out which Google
account owns the thing.

## The limits you are working inside

Firebase Spark (free) takes no payment method, so the failure mode is a hard stop
rather than a surprise invoice — the right failure mode for a classroom.

- **100 simultaneous connections.** This is the real ceiling: roughly three classes
  playing at the same moment. Sequential periods are fine. A grade-wide tournament in
  the gym is not.
- 1 GB stored, 10 GB/month down. A game is a few hundred bytes; a school year of play
  is single-digit megabytes. You will not approach these.

## The one thing that could still break at school

`*.firebasedatabase.app` is the single genuinely untested domain in this design. The
auth hosts (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`) sit under
`googleapis.com`, which a Google Workspace district cannot block without bricking its
own Chromebooks.

So when you test on a student Chromebook, on the student network, signed in as a
student, and it fails — that domain is the thing to hand IT. The game is built to say
so on screen by name rather than spinning forever.
