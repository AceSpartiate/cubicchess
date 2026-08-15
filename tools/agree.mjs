/* Do the two rule implementations actually agree?
 *
 *     node tools/agree.mjs [games] [maxPlies]
 *
 * THE GAP THIS FILLS. index.html contains the movement rules TWICE: the search engine
 * in the <script id="cubicEngine"> block, and the display model's legalMoves() in the
 * main script. The UI plays by the second one. Every existing check - perft, the 140
 * puzzles, the whole of validate.js - runs against the FIRST one. So the rules the
 * player actually experiences had no test at all, and perft cannot notice the display
 * model drifting because the display model never runs.
 *
 * That is not a hypothetical worry: it is the exact invariant MAINTENANCE.md says must
 * hold ("they must agree; the perft cross-check exists to catch drift"), asserted
 * nowhere.
 *
 * HOW. The main script is an IIFE that exposes nothing - deliberately - but it already
 * carries a ?hooks surface for harnesses. Stub THREE and the DOM well enough to let the
 * file load, set location.search to '?hooks', and the game hands over legalMoves().
 * Then play random games, and at every ply compare the FULL set of legal moves from
 * each implementation. A disagreement prints the position and the difference.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const GAMES = Number(process.argv[2] || 40);
const MAXPLY = Number(process.argv[3] || 60);

/* ---------- the engine, exactly as validate.js wakes it ---------- */
const engSrc = /<script id="cubicEngine"[^>]*>([\s\S]*?)<\/script>/.exec(html)[1]
  .replace("if (typeof importScripts === 'function'){", 'if(false){');
const Engine = (0, eval)(engSrc + '\n;Engine');

/* ---------- enough of a browser for the main script to load ----------
 * A Proxy that answers every property with another Proxy, and every call with one too.
 * The main script builds a whole three.js scene at top level; none of it has to DO
 * anything, it only has to not throw. */
function stub(name) {
  const f = function () { return stub(name + '()'); };
  f.__stub = name;
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;                    // never look thenable
      if (k === 'length' || k === 'x' || k === 'y' || k === 'z' || k === 'w') return 0;
      if (k === 'style' || k === 'classList' || k === 'dataset') return stub(name + '.' + String(k));
      if (k === 'children' || k === 'childNodes') return [];
      if (k === 'textContent' || k === 'innerHTML' || k === 'value') return '';
      if (k in t) return t[k];
      return stub(name + '.' + String(k));
    },
    set() { return true; },
    apply() { return stub(name + '()'); },
    construct() { return stub('new ' + name); },
  });
}

const store = () => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null),
           setItem: (k, v) => m.set(k, String(v)),
           removeItem: k => m.delete(k),
           clear: () => m.clear(),
           key: i => [...m.keys()][i], get length() { return m.size; } };
};

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
g.location = { search: '?hooks', href: 'http://localhost/?hooks', protocol: 'http:', reload(){} };
// navigator is a getter-only global in modern Node; define over it rather than assign.
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
g.fetch = () => new Promise(() => {});                        // never resolves: no network
g.EventSource = undefined;
g.URL = URL;

g.Worker = function () { return stub('Worker'); };
g.Blob = function () { return stub('Blob'); };
g.alert = () => {}; g.confirm = () => true;

/* ---------- load the main script ---------- */
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?:[^>]*\bid="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
const main = blocks.find(m => !m[1])[2];
try {
  (0, eval)(main);
} catch (e) {
  console.error('the main script threw while loading headless:\n  ' + e.message);
  console.error('\nIf this cannot be stubbed, the cross-check has to run in a browser via\n' +
                '?hooks instead - but then it cannot gate a commit.');
  process.exit(2);
}
const cc = g.__cc;
if (!cc) { console.error('?hooks did not expose window.__cc'); process.exit(2); }

/* ---------- compare ---------- */
const TY = { p: 1, n: 2, b: 3, r: 4, q: 5, k: 6 };
const ID = (x, y, z) => x + 8 * y + 64 * z;
const key = m => `${m.f}>${m.t}${m.p ? '=' + m.p : ''}`;

function engineMoves() {
  return new Set(Engine.scoreAllRoot(1).map(e =>
    key({ f: Engine.mFrom(e.m), t: Engine.mTo(e.m), p: Engine.mPromo(e.m) || 0 })));
}
function displayMoves() {
  const out = new Set();
  for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = cc.at(x, y, z);
    if (!p || p.c !== cc.turn) continue;
    for (const d of cc.legal(x, y, z)) {
      const promo = (p.t === 'p' && (d.z === 7 || d.z === 0)) ? [5, 4, 3, 2] : [0];
      for (const pr of promo) out.add(key({ f: ID(x, y, z), t: ID(d.x, d.y, d.z), p: pr }));
    }
  }
  return out;
}
function sync() {                       // engine <- display model
  const bd = new Int8Array(512), vg = new Uint8Array(512);
  for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const p = cc.at(x, y, z);
    if (!p) continue;
    const i = ID(x, y, z);
    bd[i] = TY[p.t] | (p.c === 'b' ? 8 : 0);
    vg[i] = p.moved ? 0 : 1;
  }
  Engine.loadRaw(bd, vg, cc.turn === 'b' ? 1 : 0);
}

let plies = 0, bad = 0;
let seed = 20260811;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };

for (let game = 0; game < GAMES && bad === 0; game++) {
  cc.newGame();
  for (let ply = 0; ply < MAXPLY; ply++) {
    sync();
    const E = engineMoves(), D = displayMoves();
    const onlyE = [...E].filter(k => !D.has(k));
    const onlyD = [...D].filter(k => !E.has(k));
    if (onlyE.length || onlyD.length) {
      bad++;
      console.log(`\nDISAGREEMENT  game ${game} ply ${ply}, ${cc.turn} to move`);
      if (onlyE.length) console.log('  engine allows, display model does not: ' + onlyE.slice(0, 8).join(' '));
      if (onlyD.length) console.log('  display model allows, engine does not: ' + onlyD.slice(0, 8).join(' '));
      break;
    }
    plies++;
    if (!D.size) break;                       // mate or stalemate
    // play one, through the DISPLAY MODEL, so its own state advances
    const all = [];
    for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const p = cc.at(x, y, z);
      if (p && p.c === cc.turn) for (const d of cc.legal(x, y, z)) all.push([x, y, z, d]);
    }
    if (!all.length) break;
    const [x, y, z, d] = all[Math.floor(rnd() * all.length)];
    cc.select(x, y, z);
    cc.doMove(d.x, d.y, d.z, 'q');
  }
}

console.log(`\n${plies} plies compared across ${GAMES} games; ` +
            (bad ? `${bad} DISAGREEMENT(S)` : 'the two rule implementations agree everywhere'));
process.exit(bad ? 1 : 0);
