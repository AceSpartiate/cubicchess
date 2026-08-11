/* Is tools/sim.mjs still telling the truth?
 *
 *     node tools/calibrate-sim.mjs
 *
 * The evaluator is the only thing standing behind the rules file, and a checker that
 * is wrong in the permissive direction blesses exactly the bugs it exists to catch.
 * That is not hypothetical here: sim.mjs shipped with hasChild() doing a raw property
 * lookup, so every path form - hasChild('seats/b') - silently returned false, which
 * made four guards vacuously true and the suite green on rules it was not testing.
 *
 * So the evaluator is pinned to ground truth. tools/rules-2026-08-10.json is a rules
 * file that was ONCE ACTUALLY PUBLISHED to the live project, and the verdicts below
 * were recorded by issuing these exact requests to real Firebase over the wire - 6 of
 * them working exploits, the rest ordinary play. If sim disagrees with any of them,
 * sim is wrong, whatever the current rules happen to be.
 *
 * This file is deliberately independent of firebase/database.rules.json. Do not
 * update it when the rules change; it is a regression test for the SIMULATOR.
 */
import fs from 'fs';
import { request, canRead, useRules, SV } from './sim.mjs';

useRules(JSON.parse(fs.readFileSync(new URL('./rules-2026-08-10.json', import.meta.url), 'utf8')));

const NOW = 1_800_000_000_000;
const A = { uid: 'uidA' }, B = { uid: 'uidB' }, X = { uid: 'uidX' };

const live = { rooms: { WXKB: {
  createdAt: NOW - 60_000, status: 'open',
  seats: { w: { uid: 'uidA', name: 'A', lastSeen: NOW - 5_000 },
           b: { uid: 'uidB', name: 'B', lastSeen: NOW - 5_000 } } } } };
const empty = {};

// [description, what REAL Firebase did, pre-state, actor, writes]
const cases = [
  ['creator seats ONE uid in BOTH colours', true, empty, A, [
    ['rooms/QQQQ', { createdAt: SV, seats: {
      w: { uid: 'uidA', name: 'Me', lastSeen: SV },
      b: { uid: 'uidA', name: 'Me2', lastSeen: SV } } }]]],
  ['white writes plies 0,1,2 in ONE patch', true, live, A, [
    ['rooms/WXKB/moves/0', { v: 100, uid: 'uidA' }],
    ['rooms/WXKB/moves/1', { v: 101, uid: 'uidA' }],
    ['rooms/WXKB/moves/2', { v: 102, uid: 'uidA' }],
    ['rooms/WXKB/lastUid', 'uidA']]],
  ['BLACK opens using ply key "00"', true, live, B, [
    ['rooms/WXKB/moves/00', { v: 55, uid: 'uidB' }],
    ['rooms/WXKB/lastUid', 'uidB']]],
  ['stranger takes BOTH seats of a LIVE room in one patch', false, live, X, [
    ['rooms/WXKB/seats/w', { uid: 'uidX', name: 'X', lastSeen: SV }],
    ['rooms/WXKB/seats/b', { uid: 'uidX', name: 'X2', lastSeen: SV }]]],
  ['anonymous uid writes bulk data under /users', true, empty, X, [
    ['users/uidX/junk', { a: 'x'.repeat(100), b: { deep: 'z'.repeat(100) } }]]],
  ['room created at a 40-character key', true, empty, X, [
    ['rooms/' + 'Q'.repeat(40), { createdAt: SV,
      seats: { w: { uid: 'uidX', name: 'X', lastSeen: SV } } }]]],
  ['white resigns BLACK with no moves played', true, live, A, [
    ['rooms/WXKB/result', 'b:resign']]],

  ['white creates a room', true, empty, A, [
    ['rooms/TSTA', { createdAt: SV, status: 'open',
      seats: { w: { uid: 'uidA', name: 'TestA', lastSeen: SV } } }]]],
  ['black claims the empty seat', true,
    { rooms: { TSTA: { createdAt: NOW - 1000,
      seats: { w: { uid: 'uidA', name: 'A', lastSeen: NOW - 1000 } } } } }, B, [
    ['rooms/TSTA/seats/b', { uid: 'uidB', name: 'TestB', lastSeen: SV }]]],
  ['white heartbeat (lastSeen only)', true, live, A, [['rooms/WXKB/seats/w/lastSeen', SV]]],
  ['white plays ply 0 (move + lastUid, atomic)', true, live, A, [
    ['rooms/WXKB/moves/0', { v: 12345, uid: 'uidA' }], ['rooms/WXKB/lastUid', 'uidA']]],
  ['seated player sets status', true, live, A, [['rooms/WXKB/status', 'live']]],
  ['stranger writes a move into the room', false, live, X, [
    ['rooms/WXKB/moves/0', { v: 222, uid: 'uidX' }], ['rooms/WXKB/lastUid', 'uidX']]],
  ['stranger steals a live seat', false, live, X, [
    ['rooms/WXKB/seats/w', { uid: 'uidX', name: 'Thief', lastSeen: SV }]]],
  ['white moves without claiming lastUid', false, live, A, [
    ['rooms/WXKB/moves/0', { v: 333, uid: 'uidA' }]]],
  ['stranger forges lastUid', false, live, X, [['rooms/WXKB/lastUid', 'uidX']]],
  ['white writes a move stamped with black uid', false, live, A, [
    ['rooms/WXKB/moves/0', { v: 5000, uid: 'uidB' }], ['rooms/WXKB/lastUid', 'uidA']]],
  ['white grabs the second seat too', false, live, A, [
    ['rooms/WXKB/seats/b', { uid: 'uidA', name: 'A', lastSeen: SV }]]],
  ['unknown field added to the room', false, live, A, [['rooms/WXKB/hack', 'x']]],
  ['move integer out of 21-bit range', false, live, A, [
    ['rooms/WXKB/moves/0', { v: 9999999, uid: 'uidA' }], ['rooms/WXKB/lastUid', 'uidA']]],
  ['stranger deletes the whole room', false, live, X, [['rooms/WXKB', null]]],
  ['stranger overwrites the whole room', false, live, X, [
    ['rooms/WXKB', { createdAt: SV, status: 'done', result: 'X wins', lastUid: 'uidX',
      seats: { w: { uid: 'uidX', name: 'T', lastSeen: SV },
               b: { uid: 'uidX', name: 'T2', lastSeen: SV } },
      moves: { 0: { v: 1, uid: 'uidX' } } }]]],
  ['stranger sets status', false, live, X, [['rooms/WXKB/status', 'done']]],
  ['seated player resets their own room wholesale', false, live, A, [
    ['rooms/WXKB', { createdAt: SV,
      seats: { w: { uid: 'uidA', name: 'A', lastSeen: SV } } }]]],
  ['seated player deletes a played move', false,
    { rooms: { WXKB: { ...live.rooms.WXKB, moves: { 0: { v: 1, uid: 'uidA' } },
      lastUid: 'uidA' } } }, A, [['rooms/WXKB/moves/0', null]]],
  ['stranger writes another players stats', false,
    { users: { uidA: { stats: { w: 1 } } } }, X, [['users/uidA/stats', { w: 99, l: 0, d: 0 }]]],
  ['room CREATED with a fabricated move list', false, empty, X, [
    ['rooms/YYYY', { createdAt: SV,
      seats: { w: { uid: 'uidX', name: 'X', lastSeen: SV } },
      moves: { 0: { v: 1, uid: 'uidX' }, 1: { v: 2, uid: 'uidX' } } }]]],
];

let agree = 0;
const wrong = [];
for (const [desc, real, pre, auth, writes] of cases) {
  const r = request(pre, writes, auth, NOW, desc);
  if (r.ok === real) agree++; else wrong.push([desc, real, r.ok, r.trace]);
}
for (const [desc, real, got] of [
  ['seated player reads the room', true, canRead(live, 'rooms/WXKB', B)],
  ['enumerate all rooms', false, canRead(live, 'rooms', A)],
]) {
  if (got === real) agree++; else wrong.push([desc, real, got, []]);
}

/* ---- the evaluator's own primitives ----
 * The recorded cases above would NOT have caught the hasChild() bug, because the
 * archived rules only ever call it with a single segment. Path forms get asserted
 * directly, against tiny purpose-built rule objects. Add to this whenever a rule
 * starts leaning on a snapshot method in a way nothing else exercises. */
const prim = [];
function probe(desc, ruleExpr, tree, writes, want) {
  useRules({ rules: { probe: { '.write': ruleExpr } } });
  const got = request(tree, writes, A, NOW, desc).ok;
  prim.push([desc, got === want]);
  if (got !== want) wrong.push([`primitive: ${desc}`, want, got, []]);
}

probe('hasChild with a PATH sees a nested child',
  "newData.hasChild('a/b')", {}, [['probe', { a: { b: 1 } }]], true);
probe('hasChild with a PATH is false when absent',
  "newData.hasChild('a/b')", {}, [['probe', { a: { c: 1 } }]], false);
probe('!hasChild with a PATH actually forbids',
  "!newData.hasChild('a/b')", {}, [['probe', { a: { b: 1 } }]], false);
probe('hasChildren accepts paths',
  "newData.hasChildren(['a/b','a/c'])", {}, [['probe', { a: { b: 1, c: 2 } }]], true);
probe('hasChildren fails when one path is missing',
  "newData.hasChildren(['a/b','a/c'])", {}, [['probe', { a: { b: 1 } }]], false);
probe('child() with a path reads through',
  "newData.child('a/b').val() === 7", {}, [['probe', { a: { b: 7 } }]], true);
probe('parent() climbs the POST-write tree',
  "newData.parent().child('probe/a/b').val() === 7", {}, [['probe', { a: { b: 7 } }]], true);
probe('root is PRE-write, so it cannot see this write',
  "root.child('probe/a/b').val() === 7", {}, [['probe', { a: { b: 7 } }]], false);
probe('data is PRE-write and sees the old value',
  "data.child('a/b').val() === 1", { probe: { a: { b: 1 } } }, [['probe/a/b', 2]], true);

useRules(JSON.parse(fs.readFileSync(new URL('./rules-2026-08-10.json', import.meta.url), 'utf8')));
agree += prim.filter(([, good]) => good).length;

const total = cases.length + 2 + prim.length;
console.log(`sim agrees with recorded live Firebase + its own primitives on ${agree}/${total}`);
if (wrong.length) {
  console.log('\nTHE SIMULATOR IS WRONG HERE:');
  for (const [desc, real, got, trace] of wrong) {
    console.log(`  ${desc}\n    live=${real ? 'allow' : 'deny'}  sim=${got ? 'allow' : 'deny'}`);
    for (const t of (trace || []).slice(-3)) console.log('      ' + t);
  }
  process.exit(1);
}
