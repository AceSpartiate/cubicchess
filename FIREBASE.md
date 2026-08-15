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

### The data model

```
/rooms/$code                 $code matches ^[BCDFGHJKLMNPQRSTVWXZ]{4}$   (160,000 codes,
                             no vowels so no accidental words, no confusable glyphs)
  createdAt : number, always === now
  moves     : ONE string. 7 octal digits per ply, append-only, <= 2800 (400 plies)
  seats/w   : "<uid>:<nickname>"   one leaf, so it cannot be half-written
  seats/b   : same, absent until someone joins
  seen/w    : number === now       the heartbeat
  seen/b    : number === now
  over/w    : "w" | "b" | "d"      white's signed claim, write-once
  over/b    : "w" | "b" | "d"      black's signed claim, write-once
```

Stored nowhere, derived instead: **ply count** is `length / 7`; **whose turn** is
`length % 14` (0 = white, 7 = black); **your colour** is the seat whose prefix before
the `:` is your uid; **seat is live** if `now - seen < 90s`; **the outcome** is
`over/w === 'b'` (white resigned), `over/b === 'w'` (black resigned), both agreeing
(a draw), or otherwise whatever replaying the moves says.

### Why moves are one string and not one node per ply

This is the whole design, and it is the fix for a bug class rather than a bug.

The obvious model is `moves/0`, `moves/1`, `moves/2`. It cannot work, because **RTDB
rules cannot count children or do arithmetic on a key** — so "exactly one move was
appended" and "it is your turn" are *inexpressible*. Worse, a multi-path write is
evaluated at each path against the **same pre-write snapshot**, so ten plies written in
one request all see "the last mover wasn't me" and all pass. That was live in this
project: a player could write the entire rest of the game in a single request, and
black could open the game by using the key `"00"` instead of `"0"`.

As one string, none of that is reachable:

| Guarantee | How |
|---|---|
| Exactly one move per write | `newData.length === data.length + 7` — and a PATCH cannot carry two legs at the same path |
| Whose turn it is | `data.length % 14`, read from **pre-write** state, so batching cannot move it |
| Append-only | `beginsWith(data.val())` — history cannot be edited or reordered |
| Move fits 21 bits | the alphabet `[0-7]` **is** the range check: 8⁷ = 2²¹ exactly. Base 36 or 64 would have silently admitted out-of-range values |
| No key aliasing | there are no keys |
| Game length | `<= 2800` chars = 400 plies |

### What the other clauses stop

| Where | Stops |
|---|---|
| `$code` `.write` | Writing to an existing room at all. Creation only — plus a recycle that can *only* land a fresh, empty room over one whose seats have both gone quiet, and which denies DELETE because `newData` is null there |
| `$code` `.read` | Reading a room you are not seated in — so codes cannot be swept for nicknames or game state |
| `seats/$c` `.write` | Taking a seat someone is still using. Claiming a seat and starting its clock are **two separate writes** — no rule reads a sibling leg of the same request, because the engines disagree about whether it can. A **lobby** seat frees after 5 minutes dark, a seat in a **live game** after 10. Both were 90 seconds, which is under Chrome's background-tab timer throttle — a child who tabbed to Classroom for two minutes came back to a stranger in their chair. The long mid-game window is the compromise for a student whose device was re-imaged: they can get back into their own game, but not quickly enough to be a griefing tool |
| `seats/$c` `.validate` | One uid holding both colours — checked through `newData`, i.e. **post-write**, so a single PATCH claiming both is refused. Also caps the nickname at 12 characters and keeps `<`, `>`, `&`, `"` and colons out of it, while allowing accented and apostrophed names — José and O'Neil are students, not attacks |
| `seats/$c` | Being one leaf means a seat cannot be partly overwritten to inherit the previous player's nickname |
| `seen/$c` `.write` | Heartbeating a seat that is not yours; forging a timestamp |
| `over/$c` `.write` | Writing the *other* player's claim — white can only ever write `over/w`, so "resign your opponent" is unreachable rather than merely validated against. Write-once, and impossible before a move exists, which stopped a stranger taking an open lobby seat and killing the game before it began |
| `moves` `.write` | Playing on after the game is genuinely decided — a resignation, or two matching claims. An **unresolved** claim does not freeze the board: the freeze once keyed on the `over` parent existing, so a player about to lose could write their own win claim and kill the game unappealably |
| `$other`, both levels | Any key not named above, anywhere — including the `/users` blob store that any anonymous uid could previously have filled the free tier with |

What none of it stops is an illegal *chess* move; no rules language can play chess.
Every inbound move is still replayed through `legalMoves()` before it lands.

### Five things the console accepts and then does not do

Every one of these was published without complaint and found only by writing to the
real database. `tools/check.py` check 8 now refuses each of them by name.

| Written | What actually happened |
|---|---|
| `"// note": "text"` as a comment | rejected outright: any non-dot key is a child path and must map to an object |
| `newData.root()` | no such method — `root` is a standalone variable holding pre-write state |
| a `"` or `\` inside a regex literal | rejected: *Illegal regular expression* |
| `newData.parent().parent()` reading a sibling leg | honoured when the sibling exists, **not** when it is being created, so nobody could join a game |
| `[^:

]` in a character class | parsed as the **letters n and r** — every Aaron, Brian and Erin silently refused |

The last two are the dangerous kind: the file publishes cleanly and the game is simply
broken for some people. Neither is findable by reading, and neither is findable in the
Rules Playground.

### Testing them

```
node tools/test-rules.mjs
```

95 cases — 22 things honest play must be allowed to do, including a complete 400-ply
game played to the cap, and 73 that must be refused. **Offline: no project, no network,
no npm.** `tools/check.py` runs it, so it gates every commit.

**Do not rely on the Rules Playground.** It simulates one path at a time, and every
serious bug this project has had lived in how RTDB evaluates a write spanning two.
`tools/sim.mjs` evaluates multi-path writes the way the real thing does. Before it was
trusted it was calibrated against 29 requests whose real verdicts were known from
issuing them to the live project — 6 working exploits and 23 ordinary cases — and it
agreed on all 29.

The honest track record, since it is the argument for the harness: **three** rule sets
shipped here that the console accepted without complaint. One under which no move could
be played at all. One where any stranger could delete or rewrite any game a day after
it was created. One where a player could write the whole rest of the game in a single
request. None was findable by reading, and none was findable in the Playground.

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

## Tested at school, 11 Aug 2026 — it works

A game was played on a **school device on the school wifi**. That settles the one
domain this design could not test from anywhere else: `*.firebasedatabase.app` is not
filtered, and neither are the two `googleapis.com` auth hosts. Nothing here needs an
IT ticket.

Keep this note. If online play ever stops working at school, it is a CHANGE to the
filter, not a thing that was never tried - and that is a different conversation with
IT than "please allow this".

## The section this replaced, kept for the domain names

`*.firebasedatabase.app` is the single genuinely untested domain in this design. The
auth hosts (`identitytoolkit.googleapis.com`, `securetoken.googleapis.com`) sit under
`googleapis.com`, which a Google Workspace district cannot block without bricking its
own devices.

So when you test on a student device, on the student network, signed in as a
student, and it fails — that domain is the thing to hand IT. The game is built to say
so on screen by name rather than spinning forever.
