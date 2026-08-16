/* The rules suite. Offline: no project, no network, no npm.
 *
 *     node tools/test-rules.mjs
 *
 * Reads firebase/database.rules.json and runs every write the honest client must make
 * plus every attack that must be refused. A rule that DENIES honest play is as much a
 * bug as one that permits a cheat, and this project has shipped both - once a rule set
 * under which no move could be played at all, and once one that let any stranger
 * delete a room a day after it was made.
 *
 * Run by tools/check.py. See tools/sim.mjs for what the evaluator does and does not model.
 */
import { request, canRead, SV } from './sim.mjs';

/* Every identity now carries the token shape the real thing carries. Room play is
   anonymous, which is the whole point of a four-letter code, so A/B/C are anonymous -
   and the locker rules below refuse them ON THAT GROUND, which is a thing worth being
   able to test. An auth object without a token would make the locker rules throw rather
   than deny, and a rule that throws is not a rule that was tested. */
const tok = p => ({ firebase: { sign_in_provider: p } });
const A = { uid: 'Ax7aaaaaaaaaaaaaaaaaaaaaaaaq', token: tok('anonymous') };
const B = { uid: 'Bq2bbbbbbbbbbbbbbbbbbbbbbbbm', token: tok('anonymous') };
const C = { uid: 'Cz9ccccccccccccccccccccccccn', token: tok('anonymous') };
/* The same people, signed in. The uid is deliberately the SAME as the anonymous one:
   signing in really does change the uid, but pinning it here means a locker test that
   passes because two uids differed cannot masquerade as one that passed on provider. */
const Apw = { uid: A.uid, token: tok('password') };
const Bpw = { uid: B.uid, token: tok('password') };
const Ago = { uid: A.uid, token: tok('google.com') };
const NOAUTH = null;
const T = 1770000000000;
const oct = n => n.toString(8).padStart(7, '0');

let pass = 0, fail = 0;
function ck(want, res, name) {
  if (res.ok === want) { pass++; }
  else { fail++; console.log(`FAIL [${want ? 'should ALLOW' : 'should DENY'}] ${name}`); res.trace.forEach(t => console.log('     ' + t)); }
  return res;
}
function allow(name, root, writes, auth, now = T) { return ck(true, request(root, writes, auth, now), name); }
function deny(name, root, writes, auth, now = T) { return ck(false, request(root, writes, auth, now), name); }
function rd(want, root, path, auth, name) {
  const got = canRead(root, path, auth);
  if (got === want) pass++; else { fail++; console.log(`FAIL [read ${want}] ${name} -> ${got}`); }
}


/* Taking a seat is TWO writes: claim it, then start its clock.
 *
 * It used to be one atomic PATCH carrying both, and that relied on one leg of a
 * multi-path write being visible to the other leg's rule. The live engine does honour
 * that when the sibling already exists - an atomic rename passes - but not when the
 * sibling is being CREATED, which is exactly the join case, so no one could ever join.
 * Rather than depend on a semantic that is undocumented and that the simulator and the
 * real thing disagree on, no rule reads a sibling leg any more: seats/$c stands alone
 * and seen/$c reads the seat from PRE-write state. Both are ordinary single-path
 * writes, which is the one shape both engines certainly agree on.
 *
 * The gap between the two writes leaves a seat with no clock for a moment, which reads
 * as "dark" and so as reclaimable. That is harmless - the claimer writes the clock
 * immediately - and it is the price of not building on a semantic nobody can cite. */
function seat(root, code, c, auth, nick, now = T) {
  const r1 = request(root, [[`rooms/${code}/seats/${c}`, auth.uid + ':' + nick]], auth, now);
  if (!r1.ok) return r1;
  return request(r1.root, [[`rooms/${code}/seen/${c}`, SV]], auth, now);
}
function allowSeat(name, root, code, c, auth, nick, now = T) {
  return ck(true, seat(root, code, c, auth, nick, now), name);
}
function denySeat(name, root, code, c, auth, nick, now = T) {
  return ck(false, seat(root, code, c, auth, nick, now), name);
}

// ---------------------------------------------------------------- honest play
let r = {};
r = allow('H1 create room, white', r, [['rooms/KMTB', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV }
}]], A).root;

rd(true, r, 'rooms/KMTB', A, 'creator reads own room');
rd(false, r, 'rooms/KMTB', C, 'stranger reads room');
rd(false, r, 'rooms/KMTB/moves', C, 'stranger reads moves');
rd(false, r, 'rooms', A, 'anyone lists rooms');
rd(false, r, 'rooms/KMTB', NOAUTH, 'unauth reads room');

r = allow('H2a join as black, claim the seat', r,
  [['rooms/KMTB/seats/b', B.uid + ':Mira']], B, T + 5000).root;
r = allow('H2b join as black, start the heartbeat', r,
  [['rooms/KMTB/seen/b', SV]], B, T + 5001).root;
deny('H2c a heartbeat for a seat you do not hold', r,
  [['rooms/KMTB/seen/b', SV]], C, T + 5002);

r = allow('H3 heartbeat white', r, [['rooms/KMTB/seen/w', SV]], A, T + 20000).root;
r = allow('H4 heartbeat black', r, [['rooms/KMTB/seen/b', SV]], B, T + 21000).root;

r = allow('H5 white plays ply 0 (12345)', r, [['rooms/KMTB/moves', oct(12345)]], A, T + 30000).root;
r = allow('H6 black plays ply 1 (6789)', r, [['rooms/KMTB/moves', oct(12345) + oct(6789)]], B, T + 31000).root;
r = allow('H7 white plays ply 2 (0)', r, [['rooms/KMTB/moves', oct(12345) + oct(6789) + oct(0)]], A, T + 32000).root;
r = allow('H8 black plays ply 3 (2097151 max)', r, [['rooms/KMTB/moves', oct(12345) + oct(6789) + oct(0) + oct(2097151)]], B, T + 33000).root;
if (r.rooms.KMTB.moves !== '0030071001520500000007777777') { fail++; console.log('FAIL move string wrong: ' + r.rooms.KMTB.moves); } else pass++;

r = allow('H9 white reconnects / renames own seat', r, [
  ['rooms/KMTB/seats/w', A.uid + ':Zed T'],
  ['rooms/KMTB/seen/w', SV]
], A, T + 40000).root;

rd(true, r, 'rooms/KMTB/moves', B, 'seated player reads moves');

// a full 400-ply game runs to the cap and stops
let g = {};
g = request(g, [['rooms/QRST', { createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A, T).root;
g = seat(g, 'QRST', 'b', B, 'Mira', T).root;
let s = '';
let capOk = true;
for (let i = 0; i < 400; i++) {
  const who = i % 2 === 0 ? A : B;
  s += oct(i * 5237 % 2097152);
  const res = request(g, [['rooms/QRST/moves', s]], who, T + i);
  if (!res.ok) { capOk = false; console.log('FAIL 400-ply game denied at ply ' + i); res.trace.forEach(t => console.log('   ' + t)); break; }
  g = res.root;
}
if (capOk) pass++; else fail++;
deny('H10 the 401st ply is refused', g, [['rooms/QRST/moves', s + oct(1)]], A, T + 500);

// outcomes
let o = JSON.parse(JSON.stringify(r));
allow('H11 white resigns (writes own over)', o, [['rooms/KMTB/over/w', 'b']], A, T + 50000);
let d = JSON.parse(JSON.stringify(r));
d = allow('H12 white offers draw', d, [['rooms/KMTB/over/w', 'd']], A, T + 50000).root;
d = allow('H13 black agrees draw', d, [['rooms/KMTB/over/b', 'd']], B, T + 51000).root;
let m = JSON.parse(JSON.stringify(r));
allow('H14 black concedes after mate', m, [['rooms/KMTB/over/b', 'w']], B, T + 50000);

// creator may take black instead
allow('H15 create room, creator takes black', {}, [['rooms/PLDN', {
  createdAt: SV, moves: '', seats: { b: A.uid + ':Zed' }, seen: { b: SV }
}]], A);

// reclaim a dark seat in a lobby that never started
let lob = request({}, [['rooms/HJKL', { createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A, T).root;
lob = seat(lob, 'HJKL', 'b', B, 'Mira', T).root;
deny('H16 a lobby seat dark only 91s is NOT reclaimable', lob, [
  ['rooms/HJKL/seats/b', C.uid + ':Rae'], ['rooms/HJKL/seen/b', SV]
], C, T + 95000);
allowSeat('H16b a lobby seat dark 6 minutes is reclaimable', lob, 'HJKL', 'b', C, 'Rae', T + 360000);

// recycle
const stale = T + 700000;
allow('H17 recycle a moveless room dark 10min (PUT)', lob, [['rooms/HJKL', {
  createdAt: SV, moves: '', seats: { w: C.uid + ':Nia' }, seen: { w: SV }
}]], C, stale);
allow('H18 recycle via PATCH clearing stale children', lob, [
  ['rooms/HJKL/createdAt', SV],
  ['rooms/HJKL/moves', ''],
  ['rooms/HJKL/seats/w', C.uid + ':Nia'],
  ['rooms/HJKL/seats/b', null],
  ['rooms/HJKL/seen/w', SV],
  ['rooms/HJKL/seen/b', null],
  ['rooms/HJKL/over', null]
], C, stale);
allow('H19 recycle a played-out room dark 24h', r, [['rooms/KMTB', {
  createdAt: SV, moves: '', seats: { w: C.uid + ':Nia' }, seen: { w: SV }
}]], C, T + 86400000 + 100000);

// ---------------------------------------------------------------- attacks
// r = live game, white=A black=B, 4 plies played, seen fresh at T+40000
const NOWX = T + 45000;
const M = r.rooms.KMTB.moves;

deny('A1 two plies in one write (length delta 14)', r, [['rooms/KMTB/moves', M + oct(5) + oct(6)]], A, NOWX);
deny('A2 rest of the game in one write', r, [['rooms/KMTB/moves', M + oct(1).repeat(40)]], A, NOWX);
deny('A3 white moves twice (wrong parity)', request(r, [['rooms/KMTB/moves', M + oct(9)]], A, NOWX).root, [['rooms/KMTB/moves', M + oct(9) + oct(10)]], A, NOWX);
deny('A4 black moves out of turn', r, [['rooms/KMTB/moves', M + oct(9)]], B, NOWX);
deny('A5 move built on a stale string', r, [['rooms/KMTB/moves', M.slice(0, 14) + oct(9)]], A, NOWX);
deny('A6 rewrite history (prefix broken)', r, [['rooms/KMTB/moves', oct(1) + M.slice(7) + oct(2)]], A, NOWX);
deny('A7 truncate the move list', r, [['rooms/KMTB/moves', M.slice(0, 7)]], A, NOWX);
deny('A8 delete the move list', r, [['rooms/KMTB/moves', null]], A, NOWX);
deny('A9 non-octal chunk', r, [['rooms/KMTB/moves', M + '0030078']], A, NOWX);
deny('A10 short chunk', r, [['rooms/KMTB/moves', M + '003007']], A, NOWX);
deny('A11 stranger plays a move', r, [['rooms/KMTB/moves', M + oct(9)]], C, NOWX);
deny('A12 unauthenticated move', r, [['rooms/KMTB/moves', M + oct(9)]], NOAUTH, NOWX);

deny('A13 one uid takes both seats at creation (PUT)', {}, [['rooms/VWXZ', {
  createdAt: SV, moves: '', seats: { w: C.uid + ':E1', b: C.uid + ':E2' }, seen: { w: SV, b: SV }
}]], C);
deny('A14 one uid takes both seats at creation (PATCH legs)', {}, [
  ['rooms/VWXZ/createdAt', SV], ['rooms/VWXZ/moves', ''],
  ['rooms/VWXZ/seats/w', C.uid + ':E1'], ['rooms/VWXZ/seats/b', C.uid + ':E2'],
  ['rooms/VWXZ/seen/w', SV], ['rooms/VWXZ/seen/b', SV]
], C);
// two dark seats grabbed atomically
let dark = request({}, [['rooms/MNPQ', { createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A, T).root;
dark = seat(dark, 'MNPQ', 'b', B, 'Mira', T).root;
deny('A15 one uid grabs two stale seats in one PATCH', dark, [
  ['rooms/MNPQ/seats/w', C.uid + ':E1'], ['rooms/MNPQ/seen/w', SV],
  ['rooms/MNPQ/seats/b', C.uid + ':E2'], ['rooms/MNPQ/seen/b', SV]
], C, T + 200000);
deny('A16 second seat taken by a uid already seated', lob, [
  ['rooms/HJKL/seats/b', A.uid + ':Zed2'], ['rooms/HJKL/seen/b', SV]
], A, T + 200000);

deny('A17 occupy a dark seat by writing the seat alone (no fresh clock)', dark, [
  ['rooms/MNPQ/seats/b', C.uid + ':Eve']
], C, T + 200000);
deny('A18 write a seat carrying someone else\'s uid', dark, [
  ['rooms/MNPQ/seats/b', B.uid + ':Mira'], ['rooms/MNPQ/seen/b', SV]
], C, T + 200000);
deny('A19 take a LIVE seat', lob, [
  ['rooms/HJKL/seats/b', C.uid + ':Eve'], ['rooms/HJKL/seen/b', SV]
], C, T + 10000);
deny('A20 take a dark seat MID-GAME', r, [
  ['rooms/KMTB/seats/b', C.uid + ':Eve'], ['rooms/KMTB/seen/b', SV]
], C, T + 40000 + 200000);
deny('A21 seat with a markup nickname', {}, [['rooms/VWXZ', {
  createdAt: SV, moves: '', seats: { w: C.uid + ':<script>' }, seen: { w: SV }
}]], C);
deny('A22 seat as an object instead of a string', {}, [['rooms/VWXZ', {
  createdAt: SV, moves: '', seats: { w: { uid: C.uid, name: 'Eve' } }, seen: { w: SV }
}]], C);
deny('A23 write the whole seats node', dark, [['rooms/MNPQ/seats', { w: C.uid + ':E1', b: C.uid + ':E2' }]], C, T + 200000);
deny('A24 bogus seat key', {}, [['rooms/VWXZ', {
  createdAt: SV, moves: '', seats: { w: C.uid + ':Eve', x: C.uid + ':Eve' }, seen: { w: SV }
}]], C);

deny('A25 heartbeat the opponent\'s seat', r, [['rooms/KMTB/seen/b', SV]], A, NOWX);
deny('A26 heartbeat with a client-supplied number', r, [['rooms/KMTB/seen/w', NOWX - 1]], A, NOWX);
deny('A27 delete a heartbeat', r, [['rooms/KMTB/seen/b', null]], A, NOWX);

deny('A28 create at a lowercase code', {}, [['rooms/kmtb', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A29 create at a 5-letter code', {}, [['rooms/KMTBX', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A30 create at a vowel code', {}, [['rooms/AEIO', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A31 create at a long junk key', {}, [['rooms/' + 'X'.repeat(40), { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A32 create with a client-supplied createdAt', {}, [['rooms/VWXZ', { createdAt: T - 1, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A33 create with no heartbeat', {}, [['rooms/VWXZ', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' } }]], C);
deny('A34 create with a fabricated move list', {}, [['rooms/VWXZ', { createdAt: SV, moves: oct(1) + oct(2), seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A35 create with an outcome already set', {}, [['rooms/VWXZ', { createdAt: SV, moves: '', over: { b: 'w' }, seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A36 create with an extra child', {}, [['rooms/VWXZ', { createdAt: SV, moves: '', chat: 'hi', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C);
deny('A37 create while unauthenticated', {}, [['rooms/VWXZ', { createdAt: SV, moves: '', seats: { w: 'x:E' }, seen: { w: SV } }]], NOAUTH);

deny('A38 overwrite a LIVE room', r, [['rooms/KMTB', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C, NOWX);
deny('A39 recycle a played room dark only 15 min', r, [['rooms/KMTB', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C, T + 40000 + 900000);
deny('A40 inject a fabricated history through the recycle grant', lob, [['rooms/HJKL', {
  createdAt: SV, moves: oct(1) + oct(2), seats: { w: C.uid + ':E' }, seen: { w: SV }
}]], C, stale);
deny('A41 recycle straight into a two-seat room', lob, [['rooms/HJKL', {
  createdAt: SV, moves: '', seats: { w: C.uid + ':E1', b: C.uid + ':E2' }, seen: { w: SV, b: SV }
}]], C, stale);
deny('A42 delete a whole room', r, [['rooms/KMTB', null]], A, NOWX);
deny('A43 delete a room you do not sit in', r, [['rooms/KMTB', null]], C, T + 86400000 + 100000);
deny('A44 bump createdAt on a live room', r, [['rooms/KMTB/createdAt', SV]], A, NOWX);
deny('A45 write at /rooms itself', r, [['rooms', { ZZZZ: { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } } }]], C, NOWX);

deny('A46 declare the opponent\'s outcome', r, [['rooms/KMTB/over/b', 'w']], A, NOWX);
deny('A47 rewrite your own outcome', request(r, [['rooms/KMTB/over/w', 'b']], A, NOWX).root, [['rooms/KMTB/over/w', 'w']], A, NOWX + 1000);
deny('A48 write the whole over node', r, [['rooms/KMTB/over', { w: 'b', b: 'b' }]], A, NOWX);
deny('A49 an outcome outside the enum', r, [['rooms/KMTB/over/w', 'white wins by resignation']], A, NOWX);
deny('A50 a boolean outcome', r, [['rooms/KMTB/over/w', true]], A, NOWX);
deny('A51 an outcome from a stranger', r, [['rooms/KMTB/over/w', 'b']], C, NOWX);
const solo = request({}, [['rooms/ZKMB', { createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A, T).root;
deny('A52 an outcome before the room has two seats', solo, [['rooms/ZKMB/over/w', 'b']], A, T + 1000);
deny('A53 move after the game is over', request(r, [['rooms/KMTB/over/w', 'b']], A, NOWX).root, [['rooms/KMTB/moves', M + oct(9)]], A, NOWX + 1000);

deny('A54 arbitrary child under a room', r, [['rooms/KMTB/chat', 'hello']], A, NOWX);
deny('A55 blob under /users', {}, [['users/' + C.uid + '/junk', 'x'.repeat(1000)]], C);
deny('A56 write a top-level junk path', {}, [['junk', { a: 1 }]], C);
deny('A57 write the database root', {}, [['', { rooms: {} }]], C);
deny('A58 move where black never joined', solo, [['rooms/ZKMB/moves', oct(1)]], A, T + 1000);
allow('A59 rewriting your OWN seat needs no clock in the same write', r, [['rooms/KMTB/seats/w', A.uid + ':Zed']], A, NOWX);
deny('A60 nickname longer than 12 characters', {}, [['rooms/VWXZ', { createdAt: SV, moves: '', seats: { w: C.uid + ':ThirteenChars' }, seen: { w: SV } }]], C);
deny('A61 seat string with no colon', {}, [['rooms/VWXZ', { createdAt: SV, moves: '', seats: { w: C.uid }, seen: { w: SV } }]], C);
deny('A62 seen written for a seat that does not exist', solo, [['rooms/ZKMB/seen/b', SV]], C, T + 1000);
deny('A63 seen key outside w/b', solo, [['rooms/ZKMB/seen/x', SV]], A, T + 1000);
deny('A64 moves node written as an object', r, [['rooms/KMTB/moves', { 0: 1 }]], A, NOWX);
deny('A65 two rooms squatted in one PATCH at bad codes', {}, [
  ['rooms/aaaa', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }],
  ['rooms/bbbb', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]
], C);

deny('A66 recycle a lobby whose creator is still heartbeating', solo, [['rooms/ZKMB', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C, T + 30000);
deny('A67 recycle a lobby dark only 5 minutes', solo, [['rooms/ZKMB', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C, T + 300000);
allow('H20 recycle a lobby dark 11 minutes', solo, [['rooms/ZKMB', { createdAt: SV, moves: '', seats: { w: C.uid + ':E' }, seen: { w: SV } }]], C, T + 660000);

/* ---------------------------------------------------------------- the second attack pass
 * Each of these was a finding against the redesign. They were written here and watched
 * to fail before the rule was touched. */

// A live game, two seated players, two plies played.
function game(now = T) {
  let x = request({}, [['rooms/KMTB', {
    createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A, now).root;
  x = seat(x, 'KMTB', 'b', B, 'Mira', now).root;
  x = request(x, [['rooms/KMTB/moves', oct(1)]], A, now).root;
  x = request(x, [['rooms/KMTB/moves', oct(1) + oct(2)]], B, now).root;
  return x;
}

// F11. `over` freezes on the PARENT node, so ANY claim killed the game. A player about
// to lose wrote over/w='w' and the move list was dead, unappealably. An unresolved
// claim must not freeze; only a resignation or an agreed outcome may.
let f = game();
f = allow('F1 white claims a win (unresolved)', f, [['rooms/KMTB/over/w', 'w']], A).root;
allow('F2 black plays on through an unresolved claim', f,
  [['rooms/KMTB/moves', oct(1) + oct(2) + oct(3)]], A);

let f2 = game();
f2 = allow('F3 white resigns (names black the winner)', f2, [['rooms/KMTB/over/w', 'b']], A).root;
deny('F4 nobody plays on after a resignation', f2,
  [['rooms/KMTB/moves', oct(1) + oct(2) + oct(3)]], A);

let f3 = game();
f3 = allow('F5 white offers a draw', f3, [['rooms/KMTB/over/w', 'd']], A).root;
f3 = allow('F6 black agrees to the draw', f3, [['rooms/KMTB/over/b', 'd']], B).root;
deny('F7 nobody plays on after an agreed draw', f3,
  [['rooms/KMTB/moves', oct(1) + oct(2) + oct(3)]], A);

// F5/F18. A stranger takes the open seat of a lobby and ends the game before it starts,
// pinning the code. An outcome cannot exist before a move does.
let pre = request({}, [['rooms/PLKN', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A, T).root;
pre = seat(pre, 'PLKN', 'b', C, 'Eve', T).root;
deny('F8 an outcome claimed before any move exists', pre, [['rooms/PLKN/over/b', 'w']], C);

// F0. $other/.validate:false only guards depth 1 - .validate never runs on an ancestor
// of the written leg, so a blob two levels down rode in on the create grant.
deny('F9 blob smuggled two levels deep at create time', {}, [
  ['rooms/WXZB', { createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }],
  ['rooms/WXZB/junk/deep', 'x'.repeat(500)]
], A);
deny('F10 blob three levels deep at create time', {}, [
  ['rooms/WXZC', { createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }],
  ['rooms/WXZC/a/b/c', 'x'.repeat(500)]
], A);

// F12. 90s is UNDER Chrome's background-tab throttle (~1 timer tick a minute), so a kid
// who tabs to Classroom for two minutes came back to a stranger in their seat.
let pre2 = request({}, [['rooms/TRKN', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A, T).root;
denySeat('F11 take a lobby seat dark only 2 minutes', pre2, 'TRKN', 'w', C, 'Eve', T + 120000);
allowSeat('F12 take a lobby seat dark 6 minutes', pre2, 'TRKN', 'w', C, 'Eve', T + 360000);

// F6/F13. A seat welded to one anonymous uid forever orphans a student whose device
// was re-imaged or whose site data was cleared. Reclaim mid-game, but only after long
// enough that it is not a griefing window.
let mid = game();
denySeat('F13 take a mid-game seat dark 2 minutes', mid, 'KMTB', 'b', C, 'Eve', T + 120000);
allowSeat('F14 rejoin a mid-game seat dark 11 minutes', mid, 'KMTB', 'b', C, 'Eve', T + 660000);

// F7/F20. If matches() is Java-flavoured, `$` sits before a final line terminator, so a
// newline slips into the alphabet check - and moves re-validates the WHOLE string every
// write, so once one is in, no further ply ever validates and the game is bricked.
deny('F15 a newline inside the move string', game(),
  [['rooms/KMTB/moves', oct(1) + oct(2) + '00000\n0']], A);

// F14/F15. The nickname charset rejected accented names - a real set of students here -
// and the uid half of that regex could only ever produce false rejections.
allow('F16a a nickname containing n and r', {}, [['rooms/JSFT', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':Fran' }, seen: { w: SV } }]], A);
allow('F16b every vowel-free name a child might have', {}, [['rooms/JSFV', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':Aaron' }, seen: { w: SV } }]], A);
allow('F16 an accented nickname', {}, [['rooms/JSFB', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':José' }, seen: { w: SV } }]], A);
allow('F17 a nickname with an apostrophe', {}, [['rooms/JSFC', {
  createdAt: SV, moves: '', seats: { w: A.uid + ":O'Neil" }, seen: { w: SV } }]], A);
const LONG = { uid: 'Z'.repeat(200) };
allow('F18 a uid longer than 128 characters', {}, [['rooms/JSFD', {
  createdAt: SV, moves: '', seats: { w: LONG.uid + ':Zed' }, seen: { w: SV } }]], LONG);
deny('F19 a nickname of 13 characters', {}, [['rooms/JSFG', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':1234567890123' }, seen: { w: SV } }]], A);
deny('F20 a nickname containing a colon', {}, [['rooms/JSFH', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':a:b' }, seen: { w: SV } }]], A);

/* ---------------------------------------------------------------- the locker
 * users/$uid holds the only two things worth carrying between devices: the name you
 * play under and your record. It is the FIRST node in this database that is not a room,
 * and the first that cares who you signed in AS rather than merely that you are someone.
 *
 * The provider test is a WHITELIST, not "not anonymous". A blacklist would silently hand
 * a locker to whatever provider gets switched on next in the Firebase console - a
 * console click, made by someone who was not thinking about this file, would widen the
 * database. L14 is that test.
 */
const LOCK = { nick: 'Zed', rec: 'KMTBWQRSTL' };

allow('L01 signed in with a password, writing own locker', {}, [['users/'+Apw.uid, LOCK]], Apw);
allow('L02 signed in with Google, writing own locker',      {}, [['users/'+Ago.uid, LOCK]], Ago);
allow('L03 updating just the nickname', { users: { [Apw.uid]: LOCK } },
  [['users/'+Apw.uid+'/nick', 'Zedd']], Apw);
allow('L04 appending to the record', { users: { [Apw.uid]: LOCK } },
  [['users/'+Apw.uid+'/rec', 'KMTBWQRSTLBCDFW']], Apw);
allow('L05 clearing the locker entirely', { users: { [Apw.uid]: LOCK } },
  [['users/'+Apw.uid, null]], Apw);
rd(true,  { users: { [Apw.uid]: LOCK } }, 'users/'+Apw.uid, Apw, 'L06 reading own locker');

/* Who you are not */
rd(false, { users: { [Apw.uid]: LOCK } }, 'users/'+Apw.uid, Bpw, 'L07 reading someone else’s locker');
deny('L08 writing someone else’s locker', {}, [['users/'+Apw.uid, LOCK]], Bpw);
rd(false, { users: { [Apw.uid]: LOCK } }, 'users/'+Apw.uid, NOAUTH, 'L09 reading a locker signed out');
deny('L10 writing a locker signed out', {}, [['users/'+Apw.uid, LOCK]], NOAUTH);

/* An anonymous player has no locker, by design: it could never be signed back into, so
   it would be a node nobody can ever reach again, written once per tab. */
deny('L11 an anonymous player writing a locker', {}, [['users/'+A.uid, LOCK]], A);
rd(false, { users: { [A.uid]: LOCK } }, 'users/'+A.uid, A, 'L12 an anonymous player reading a locker');
/* Anonymous CAN still play - the whole room path is untouched by any of this. */
allow('L13 an anonymous player can still make a room', {}, [['rooms/JSFM', {
  createdAt: SV, moves: '', seats: { w: A.uid + ':Zed' }, seen: { w: SV } }]], A);
/* The whitelist, tested as a whitelist. */
deny('L14 a provider nobody put on the list', {}, [['users/'+A.uid, LOCK]],
  { uid: A.uid, token: tok('facebook.com') });

/* Shape. .validate runs at the written node and BELOW it, never above - so a deep write
   never meets the parent's rule, and only a per-depth $other refusal stops junk. */
deny('L15 a nickname of 13 characters', {}, [['users/'+Apw.uid, { nick: '1234567890123' }]], Apw);
deny('L16 a nickname containing a colon', {}, [['users/'+Apw.uid, { nick: 'a:b' }]], Apw);
deny('L17 a nickname containing a tag bracket', {}, [['users/'+Apw.uid, { nick: '<b>' }]], Apw);
deny('L18 a record that is not whole games', {}, [['users/'+Apw.uid, { rec: 'KMTBWQ' }]], Apw);
deny('L19 a record using a letter outside the code alphabet', {},
  [['users/'+Apw.uid, { rec: 'KMTAW' }]], Apw);
deny('L20 a record longer than the cap', {},
  [['users/'+Apw.uid, { rec: 'KMTBW'.repeat(300) }]], Apw);
deny('L21 an unknown child', {}, [['users/'+Apw.uid, { nick: 'Zed', evil: 'x' }]], Apw);
deny('L22 an unknown child written on its own', { users: { [Apw.uid]: LOCK } },
  [['users/'+Apw.uid+'/evil', 'x']], Apw);
deny('L23 junk buried three deep', { users: { [Apw.uid]: LOCK } },
  [['users/'+Apw.uid+'/a/b/c', 'x']], Apw);
deny('L24 the locker written as a bare string', {}, [['users/'+Apw.uid, 'gotcha']], Apw);
deny('L25 the locker written as a number', {}, [['users/'+Apw.uid, 7]], Apw);
deny('L26 a nickname written as an object', {}, [['users/'+Apw.uid, { nick: { a: 1 } }]], Apw);
/* Nothing outside rooms/ and users/ is reachable at all. */
deny('L27 a node that is neither a room nor a locker', {}, [['scores/'+Apw.uid, 1]], Apw);
rd(false, {}, 'users', Apw, 'L28 reading the whole users collection');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
