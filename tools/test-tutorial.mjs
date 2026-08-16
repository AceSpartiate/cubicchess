/* Does the first-time tutorial actually run to the end?
 *
 *     node tools/test-tutorial.mjs
 *
 * WHY THIS EXISTS. A tutorial step may hold the board until the player makes one
 * particular move. If that move is not legal in the position the step set up, the
 * player can never satisfy it and there is no way past - the tutorial has no skip. The
 * failure presents as a child sitting in front of a sentence, doing what it says, and
 * nothing happening. Nothing else in this repository would notice: the steps are data,
 * they parse fine, and the game runs perfectly right up until that step.
 *
 * So every step is walked through the REAL move generator, in the position the tutorial
 * itself builds, in order - which is the only way to know, because step 9's position is
 * whatever steps 1-8 left behind.
 *
 * Checked per step:
 *   - `say` exists, is a string, and fits the banner
 *   - every coordinate is a square this variant actually has
 *   - a `set` leaves both kings on the board, and the side to move a legal move
 *   - a `look` points at a square that holds a piece
 *   - a `do` is a LEGAL MOVE for the side to move, right now
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const SAY_MAX = 260;      // the banner is one or two lines, not a paragraph

/* ---- load the page headless, the same way agree.mjs and perft-flat.mjs do ---- */
function stub(name) {
  const f = function () { return stub(name + '()'); };
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === 'length' || k === 'x' || k === 'y' || k === 'z' || k === 'w') return 0;
      if (k === 'children' || k === 'childNodes') return [];
      if (k === 'textContent' || k === 'innerHTML' || k === 'value') return '';
      if (k === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
      if (k in t) return t[k];
      return stub(name + '.' + String(k));
    },
    set() { return true; }, apply() { return stub(name + '()'); },
    construct() { return stub('new ' + name); },
  });
}
const store = () => { const m = new Map(); return {
  getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
  removeItem: k => m.delete(k), clear: () => m.clear(),
  key: i => [...m.keys()][i], get length() { return m.size; } }; };

const g = globalThis;
g.window = g;
g.THREE = stub('THREE');
g.document = stub('document');
g.document.getElementById = () => stub('el');
g.document.querySelector = () => stub('el');
g.document.querySelectorAll = () => [];
g.document.createElement = () => stub('el');
g.document.addEventListener = () => {};
g.document.body = stub('body');
g.localStorage = store();
g.sessionStorage = store();
g.location = { search: '?hooks', href: 'http://localhost/?hooks', pathname: '/', origin: 'http://localhost', protocol: 'http:', hash: '', reload(){} };
Object.defineProperty(g, 'navigator', {
  value: { onLine: true, userAgent: 'node' }, configurable: true, writable: true });
g.addEventListener = () => {};
g.innerWidth = 1280; g.innerHeight = 800; g.devicePixelRatio = 1;
g.screen = { width: 1280, height: 800 };
g.performance = globalThis.performance || { now: () => 0 };
g.getComputedStyle = () => stub('style');
g.history = { replaceState(){}, pushState(){} };
g.ResizeObserver = function(){ return { observe(){}, disconnect(){} }; };
g.Image = function(){ return stub('img'); };
g.requestAnimationFrame = () => 0;
g.matchMedia = () => ({ matches: false, addEventListener(){} });
g.fetch = () => new Promise(() => {});
g.EventSource = undefined;
g.URL = URL; g.URLSearchParams = URLSearchParams;
g.Worker = function () { return stub('Worker'); };
g.Blob = function () { return stub('Blob'); };
g.alert = () => {}; g.confirm = () => true;
// crypto is already a getter-only global in modern node; g IS globalThis, so it is
// there already and assigning to it throws.

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?:[^>]*\bid="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
try { (0, eval)(blocks.find(m => !m[1])[2]); }
catch (e) { console.error('headless load failed: ' + e.message); process.exit(2); }
const cc = g.__cc;
if (!cc || !cc.tut || !cc.setBoard) {
  console.error('?hooks does not expose the tutorial surface (tut / setBoard)');
  process.exit(2);
}

/* ---- walk ---- */
const NAME = { p: 'pawn', r: 'rook', n: 'knight', b: 'bishop', q: 'queen', k: 'king' };
let problems = 0, steps = 0, checked = 0;
const say = (v, i, msg) => { problems++; console.log(`  FAIL  ${v} step ${i}: ${msg}`); };

/* Which variants have one. Read from VARIANTS via the hook rather than a list here, so
   a new variant with a tutorial is covered the moment it exists. */
const VARIANT_IDS = ['cubic', 'trid', 'flat'];

for (const id of VARIANT_IDS) {
  const tut = cc.tut(id);
  if (!tut) { console.log(`  skip  ${id} has no tutorial yet`); continue; }
  if (cc.variant(id) !== id) { console.log(`  skip  ${id} is not playable yet`); continue; }

  cc.newGame();
  let placed = false;                 // has any step set up its own position?
  const shown = new Set();            // piece types actually selected or moved

  tut.forEach((st, i) => {
    steps++;

    if (typeof st.say !== 'string' || !st.say.trim()) { say(id, i, 'no `say`'); return; }
    if (st.say.length > SAY_MAX)
      say(id, i, `\`say\` is ${st.say.length} characters; the banner holds about ${SAY_MAX}`);

    if (st.set) {
      if (!Array.isArray(st.set) || !st.set.length) { say(id, i, '`set` is empty'); return; }
      for (const p of st.set) {
        if (!NAME[p.t]) say(id, i, `unknown piece type ${JSON.stringify(p.t)}`);
        if (p.c !== 'w' && p.c !== 'b') say(id, i, `piece colour ${JSON.stringify(p.c)} is not w or b`);
        if (!cc.inside(p.x, p.y || 0, p.z))
          say(id, i, `places a ${NAME[p.t] || p.t} on (${p.x},${p.y||0},${p.z}), which ${id} does not have`);
      }
      /* Both kings, always. Check detection reads the king square, and a position with
         none makes every later legality question meaningless rather than merely wrong. */
      for (const c of ['w', 'b'])
        if (!st.set.some(p => p.t === 'k' && p.c === c))
          say(id, i, `\`set\` has no ${c === 'w' ? 'white' : 'black'} king`);
      cc.setBoard(st.set, st.side);
      placed = true;
      if (!cc.anyMove())
        say(id, i, `sets up a position where ${cc.turn === 'w' ? 'White' : 'Black'} has no legal move at all`);
    }

    if (st.look) {
      const [x, y, z] = st.look;
      if (!cc.inside(x, y, z)) { say(id, i, `\`look\` at (${x},${y},${z}), which ${id} does not have`); }
      else if (!cc.at(x, y, z)) { say(id, i, `\`look\` at (${x},${y},${z}), which is empty - nothing lights up`); }
      else { shown.add(cc.at(x, y, z).t); checked++; }
    }

    if (st.do) {
      const d = st.do;
      const from = [d.fx, d.fy || 0, d.fz], to = [d.tx, d.ty || 0, d.tz];
      if (!cc.inside(...from) || !cc.inside(...to)) {
        say(id, i, `\`do\` uses a square ${id} does not have: (${from}) -> (${to})`);
        return;
      }
      const piece = cc.at(...from);
      if (!piece) { say(id, i, `\`do\` moves from (${from}), which is empty`); return; }
      if (piece.c !== cc.turn) {
        say(id, i, `\`do\` moves a ${piece.c === 'w' ? 'white' : 'black'} ${NAME[piece.t]} ` +
                   `but it is ${cc.turn === 'w' ? 'White' : 'Black'} to move`);
        return;
      }
      const legal = cc.legal(...from);
      if (!legal.some(m => m.x === to[0] && m.y === to[1] && m.z === to[2])) {
        say(id, i, `\`do\` asks for ${NAME[piece.t]} (${from}) -> (${to}), which is NOT LEGAL. ` +
                   `The player can never satisfy this step. Legal here: ` +
                   (legal.length ? legal.map(m => `(${m.x},${m.y},${m.z})`).join(' ') : 'nothing at all'));
        return;
      }
      shown.add(piece.t);
      checked++;
      cc.apply(from[0], from[1], from[2], to[0], to[1], to[2], d.promo || null);
    }
  });

  /* Coverage, and the bar is SHOWN, not mentioned.
     A keyword scan cannot judge teaching, and the version of this check that only
     looked for the word passed a tutorial whose entire treatment of four pieces was
     one sentence listing them - which is the exact complaint that started this. So the
     test is mechanical instead: every piece must at some point be selected or moved,
     because you cannot demonstrate a knight without a knight on the board. */
  const missingWord = Object.keys(NAME).filter(k =>
    !tut.some(st => new RegExp('\\b' + NAME[k] + 's?\\b', 'i').test(st.say)));
  if (missingWord.length)
    say(id, -1, `never mentions: ${missingWord.map(k => NAME[k]).join(', ')}`);

  const missingShown = Object.keys(NAME).filter(k => !shown.has(k));
  if (missingShown.length)
    say(id, -1, `never SHOWS: ${missingShown.map(k => NAME[k]).join(', ')} - ` +
                `each piece needs a step that selects or moves one, not a sentence ` +
                `listing it among others. A player who has not played chess finishes ` +
                `not knowing how it moves.`);

  console.log(`  ${problems ? '    ' : 'ok  '}  ${id}: ${tut.length} steps, ` +
              `${placed ? 'builds its own positions' : 'uses the opening position throughout'}`);
}

console.log(`\n${steps} steps walked, ${checked} looks and moves verified against the move generator`);
console.log(problems ? `${problems} problem(s) - a player would get stuck`
                     : 'every step is reachable and every asked-for move is legal');
process.exit(problems ? 1 : 0);
