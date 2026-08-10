#!/usr/bin/env node
/* Rules and content validation for index.html. Run by tools/check.py; also runnable
 * alone:  node tools/validate.js
 *
 * Two things must stay true after every edit, and neither is visible by reading:
 *
 *   1. PERFT. The engine's move generator and the display model's legalMoves() are
 *      two implementations of one ruleset. perft is a fixed, externally checkable
 *      number that notices when they drift apart. 136 at depth 1, 18479 at depth 2.
 *
 *   2. EVERY PUZZLE STILL WORKS. 90 Coach + 50 library. A puzzle whose solution has
 *      become illegal still parses, still loads, still draws - and simply cannot be
 *      solved. That failure reaches a student, not a test.
 *
 * The replay uses THE ENGINE'S OWN make() and scoreAllRoot(), deliberately. Writing a
 * third mover here to check the other two would be the same drift hazard one level up.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const SRC = path.join(ROOT, 'index.html');
const html = fs.readFileSync(SRC, 'utf8');

const problems = [];
const notes = [];
function bad(m) { problems.push(m); }
function note(m) { notes.push(m); }

/* ---------- extract the engine and wake it up outside a worker ---------- */
const engMatch = /<script id="cubicEngine"[^>]*>([\s\S]*?)<\/script>/.exec(html);
if (!engMatch) {
  console.log(JSON.stringify({ ok: false, problems: ['could not find the <script id="cubicEngine"> block'], notes: [] }));
  process.exit(1);
}
const engSrc = engMatch[1].replace("if (typeof importScripts === 'function'){", 'if(false){');
let Engine;
try {
  Engine = (0, eval)(engSrc + '\n;Engine');
} catch (e) {
  console.log(JSON.stringify({ ok: false, problems: ['the engine block threw while loading: ' + e.message], notes: [] }));
  process.exit(1);
}

/* ---------- 1. perft ---------- */
Engine.reset();
const p1 = Engine.perft(1, 0), p2 = Engine.perft(2, 0);
if (p1 !== 136) bad('perft(1) is ' + p1 + ', expected 136 - the rules changed, or the two move generators have diverged');
if (p2 !== 18479) bad('perft(2) is ' + p2 + ', expected 18479 - the rules changed, or the two move generators have diverged');
note('perft ' + p1 + ' / ' + p2);

/* ---------- pull the two data literals out ---------- *
 * They are single enormous JSON literals. A regex cannot find the end of one
 * reliably, so scan for the balanced closer while respecting string state. */
function literalAfter(name, open, close) {
  const at = html.indexOf(name);
  if (at < 0) return null;
  let i = html.indexOf(open, at);
  if (i < 0) return null;
  const start = i;
  let depth = 0, inStr = false, quote = '', esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return html.slice(start, i + 1); }
  }
  return null;
}

function parseLiteral(name, open, close) {
  const raw = literalAfter(name, open, close);
  if (raw === null) { bad('could not find the ' + name + ' literal'); return null; }
  try { return JSON.parse(raw); }
  catch (e) { bad(name + ' is not valid JSON: ' + e.message); return null; }
}

const COACH = parseLiteral('const COACH_DATA', '{', '}');
const LIB = parseLiteral('const PUZZLE_LIB', '[', ']');

/* ---------- replay helpers, built on the engine ---------- */
const TYCODE = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const ID = (x, y, z) => x + 8 * y + 64 * z;

function loadPieces(pieces, side) {
  const bd = new Int8Array(512), vg = new Uint8Array(512);
  for (const p of pieces) {
    if (!(p.x >= 0 && p.x < 8 && p.y >= 0 && p.y < 8 && p.z >= 0 && p.z < 8)) return { err: 'piece off the board at ' + [p.x, p.y, p.z] };
    const i = ID(p.x, p.y, p.z);
    if (bd[i]) return { err: 'two pieces on the same square ' + [p.x, p.y, p.z] };
    const code = TYCODE[p.t];
    if (!code) return { err: 'unknown piece type ' + p.t };
    bd[i] = p.c === 'b' ? (code | 8) : code;
    vg[i] = p.m ? 0 : 1;           // m = has moved, so virgin is its opposite
  }
  Engine.loadRaw(bd, vg, side === 'b' ? 1 : 0);
  return {};
}

/* Find the engine's own encoding of a [fx,fy,fz,tx,ty,tz,promo?] move among the
 * LEGAL moves for the side to move. Returns null when the move is not legal, which
 * is the whole question being asked. */
function findLegal(mv) {
  const from = ID(mv[0], mv[1], mv[2]), to = ID(mv[3], mv[4], mv[5]);
  const want = mv[6] || 0;
  for (const e of Engine.scoreAllRoot(1)) {
    if (Engine.mFrom(e.m) !== from || Engine.mTo(e.m) !== to) continue;
    const got = Engine.mPromo(e.m) || 0;
    if (want && got !== want) continue;
    return e.m;
  }
  return null;
}

/* Walk a whole puzzle: solution move, scripted reply, solution move, ... */
function replay(label, pieces, side, sol, rep) {
  const l = loadPieces(pieces, side);
  if (l.err) { bad(label + ': ' + l.err); return; }

  const kings = { w: 0, b: 0 };
  for (const p of pieces) if (p.t === 'k') kings[p.c]++;
  if (kings.w !== 1 || kings.b !== 1) bad(label + ': needs exactly one king per side, has ' + kings.w + ' white / ' + kings.b + ' black');

  let ply = 0;
  for (let i = 0; i < sol.length; i++) {
    const m = findLegal(sol[i]);
    if (m === null) { bad(label + ': solution move ' + (i + 1) + ' ' + JSON.stringify(sol[i]) + ' is not legal for the side to move'); return; }
    Engine.make(m, ply++);
    if (rep && i < rep.length) {
      const r = findLegal(rep[i]);
      if (r === null) { bad(label + ': scripted reply ' + (i + 1) + ' ' + JSON.stringify(rep[i]) + ' is not legal for the side to move'); return; }
      Engine.make(r, ply++);
    }
  }
}

/* ---------- 2. Coach puzzles ---------- */
let coachCount = 0;
if (COACH) {
  const cats = COACH.cats || {};
  for (const key of (COACH.order || [])) {
    if (!cats[key]) { bad('COACH_DATA.order names "' + key + '" but cats has no such category'); continue; }
  }
  for (const key of Object.keys(cats)) {
    if (!(COACH.order || []).includes(key)) bad('COACH_DATA.cats has orphan category "' + key + '" not in order');
    const puzzles = cats[key].puzzles || [];
    puzzles.forEach((p, i) => {
      coachCount++;
      replay('coach ' + key + '#' + (i + 1), p.pieces, p.side, p.sol || [], p.reply);
    });
  }
  note('coach puzzles replayed: ' + coachCount);
  if (coachCount !== 90) bad('expected 90 Coach puzzles, found ' + coachCount);
}

/* ---------- 3. Library puzzles ---------- */
if (LIB) {
  LIB.forEach((e, i) => {
    const label = 'lib #' + (i + 1);
    replay(label, e.p, e.s, e.sol || [], e.rep);

    // The tags are not decoration - the three UI filters read them, so a wrong tag
    // silently hides a puzzle from the player who asked for exactly it.
    if ((e.sol || []).length !== e.len) bad(label + ': len is ' + e.len + ' but the solution has ' + (e.sol || []).length + ' moves');
    const wantPh = e.ply <= 10 ? 0 : e.ply <= 20 ? 1 : 2;
    if (e.ph !== wantPh) bad(label + ': ph is ' + e.ph + ' but ply ' + e.ply + ' falls in bucket ' + wantPh);
    if (e.s !== 'w' && e.s !== 'b') bad(label + ': side is ' + JSON.stringify(e.s));
    if (e.k !== 'mate' && e.k !== 'win') bad(label + ': kind is ' + JSON.stringify(e.k) + ', expected "mate" or "win"');
    if (e.len > 1 && !e.rep) bad(label + ': is ' + e.len + ' moves long but carries no scripted reply');
    if (e.len === 1 && e.rep) bad(label + ': is one move long but carries a scripted reply');
  });
  note('library puzzles replayed: ' + LIB.length);
  if (LIB.length !== 50) note('library size is ' + LIB.length + ' (was 50 when this check was written - fine if you added some)');
  const kinds = {};
  for (const e of LIB) kinds[e.k] = (kinds[e.k] || 0) + 1;
  note('library by kind: ' + JSON.stringify(kinds));
}

console.log(JSON.stringify({ ok: problems.length === 0, problems, notes }));
process.exit(problems.length === 0 ? 0 : 1);
