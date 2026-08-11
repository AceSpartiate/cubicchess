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

const A = { uid: 'Ax7aaaaaaaaaaaaaaaaaaaaaaaaq' };
const B = { uid: 'Bq2bbbbbbbbbbbbbbbbbbbbbbbbm' };
const C = { uid: 'Cz9ccccccccccccccccccccccccn' };
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

r = allow('H2 join as black (PATCH seat+seen)', r, [
  ['rooms/KMTB/seats/b', B.uid + ':Mira'],
  ['rooms/KMTB/seen/b', SV]
], B, T + 5000).root;

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
g = request(g, [['rooms/QRST/seats/b', B.uid + ':Mira'], ['rooms/QRST/seen/b', SV]], B, T).root;
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
lob = request(lob, [['rooms/HJKL/seats/b', B.uid + ':Mira'], ['rooms/HJKL/seen/b', SV]], B, T).root;
allow('H16 reclaim a seat dark 91s while no moves', lob, [
  ['rooms/HJKL/seats/b', C.uid + ':Rae'], ['rooms/HJKL/seen/b', SV]
], C, T + 95000);

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
dark = request(dark, [['rooms/MNPQ/seats/b', B.uid + ':Mira'], ['rooms/MNPQ/seen/b', SV]], B, T).root;
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
deny('A59 lone seat write with no fresh clock, own seat, mid-game', r, [['rooms/KMTB/seats/w', A.uid + ':Zed']], A, NOWX);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
