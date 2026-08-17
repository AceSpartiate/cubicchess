/* Is the tri-dimensional board the board it is supposed to be?
 *
 *     node tools/test-trid.mjs
 *
 * WHY THIS EXISTS. Cubic chess is guarded by two independent implementations agreeing;
 * traditional chess by perft numbers published and cross-verified for decades. Tri-D has
 * NEITHER - no perft exists for any tri-D ruleset, and the Worker engine is cubic-only.
 * Our implementation is the reference, so a wrong lattice would be silently wrong
 * forever and no other check in this repository would notice.
 *
 * So the geometry is asserted against the numbers TRID.md records from the research,
 * written out here by hand rather than derived from the same code they are checking.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* ---- the numbers, from TRID.md, typed in independently ---- */
const BOX      = { nx: 6, ny: 5, nz: 10 };
const SQUARES  = 64;                       // 3 main boards of 16, 4 attack boards of 4
const PER_Y    = [16, 8, 16, 8, 16];       // W, White's ABs, N, Black's ABs, B
const PIECES   = 32;
// Meder's files z,a,b,c,d,e -> x 0..5. Every starting square, spelled out.
const START = {
  w: ['z0/1','a0/1','z1/1','a1/1','d0/1','e0/1','d1/1','e1/1',
      'a1/0','b1/0','c1/0','d1/0','a2/0','b2/0','c2/0','d2/0'],
  b: ['z9/3','a9/3','z8/3','a8/3','d9/3','e9/3','d8/3','e8/3',
      'a8/4','b8/4','c8/4','d8/4','a7/4','b7/4','c7/4','d7/4'],
};

function stub(name) {
  const f = function () { return stub(name + '()'); };
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === 'length' || 'xyzw'.includes(k)) return 0;
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
g.window = g; g.THREE = stub('THREE'); g.document = stub('document');
g.document.getElementById = () => stub('el');
g.document.querySelector = () => stub('el');
g.document.querySelectorAll = () => [];
g.document.createElement = () => stub('el');
g.document.addEventListener = () => {};
g.document.body = stub('body');
g.localStorage = store(); g.sessionStorage = store();
g.location = { search:'?hooks', href:'http://localhost/?hooks', pathname:'/', origin:'http://localhost', protocol:'http:', hash:'', reload(){} };
Object.defineProperty(g, 'navigator', { value:{ onLine:true, userAgent:'node' }, configurable:true, writable:true });
g.addEventListener = () => {};
g.innerWidth = 1280; g.innerHeight = 800; g.devicePixelRatio = 1;
g.screen = { width:1280, height:800 };
g.performance = globalThis.performance || { now: () => 0 };
g.getComputedStyle = () => stub('style');
g.history = { replaceState(){}, pushState(){} };
g.ResizeObserver = function(){ return { observe(){}, disconnect(){} }; };
g.Image = function(){ return stub('img'); };
g.requestAnimationFrame = () => 0;
g.matchMedia = () => ({ matches:false, addEventListener(){} });
g.fetch = () => new Promise(() => {});
g.EventSource = undefined; g.URL = URL; g.URLSearchParams = URLSearchParams;
g.Worker = function(){ return stub('Worker'); };
g.Blob = function(){ return stub('Blob'); };
g.alert = () => {}; g.confirm = () => true;

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?:[^>]*\bid="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
try { (0, eval)(blocks.find(m => !m[1])[2]); }
catch (e) { console.error('headless load failed: ' + e.message); process.exit(2); }
const cc = g.__cc;
if (!cc || !cc.tridSpec) { console.error('?hooks does not expose tridSpec'); process.exit(2); }

const V = cc.tridSpec();
let bad = 0;
const ok  = m => console.log('  ok    ' + m);
const no  = m => { bad++; console.log('  FAIL  ' + m); };
const eq  = (got, want, what) => got === want ? ok(`${what}: ${got}`) : no(`${what}: got ${got}, want ${want}`);

eq(V.nx, BOX.nx, 'files in the bounding box');
eq(V.ny, BOX.ny, 'levels in the bounding box');
eq(V.nz, BOX.nz, 'ranks in the bounding box');
eq(V.cells, BOX.nx*BOX.ny*BOX.nz, 'cells');

/* idx and coords must be exact inverses. They are written separately and one of them
   being subtly wrong is how a board silently folds onto itself. */
let inv = 0;
for (let z=0; z<V.nz; z++) for (let y=0; y<V.ny; y++) for (let x=0; x<V.nx; x++) {
  const i = V.idx(x,y,z), c = V.coords(i);
  if (i < 0 || i >= V.cells) { inv++; continue; }
  if (c.x!==x || c.y!==y || c.z!==z) inv++;
}
inv ? no(`idx and coords disagree on ${inv} cell(s)`) : ok('idx and coords are exact inverses on all ' + V.cells);

/* The square set. */
const perY = Array(V.ny).fill(0);
let total = 0;
for (let y=0;y<V.ny;y++) for (let z=0;z<V.nz;z++) for (let x=0;x<V.nx;x++)
  if (V.inside(x,y,z)) { perY[y]++; total++; }
eq(total, SQUARES, 'playable squares');
perY.join()===PER_Y.join()
  ? ok('squares per level: ' + perY.join(' / ') + '  (W / White ABs / N / Black ABs / B)')
  : no('squares per level: got ' + perY.join(' / ') + ', want ' + PER_Y.join(' / '));

/* Nothing outside the box counts as a square. */
let leak = 0;
for (const [x,y,z] of [[-1,0,1],[6,0,1],[1,-1,1],[1,5,1],[1,0,-1],[1,0,10]])
  if (V.inside(x,y,z)) leak++;
leak ? no(`inside() accepts ${leak} coordinate(s) outside the lattice`) : ok('inside() refuses every out-of-range coordinate');

/* The starting position, against squares spelled out by hand from TRID.md. */
const FILE = 'zabcde';
const named = new Set();
for (const c of ['w','b']) for (const s of START[c]) {
  const m = /^([zabcde])(\d)\/(\d)$/.exec(s);
  named.add(`${c}:${FILE.indexOf(m[1])},${m[3]},${m[2]}`);
}
eq(V.start.length, PIECES, 'pieces in the starting position');
const seen = new Map();
let offBoard = 0, collide = 0, unexpected = 0;
for (const p of V.start) {
  if (!V.inside(p.x,p.y,p.z)) { offBoard++; no(`a ${p.c} ${p.t} starts on (${p.x},${p.y},${p.z}), which is not a square`); }
  const k = `${p.x},${p.y},${p.z}`;
  if (seen.has(k)) { collide++; no(`two pieces share (${k}): ${seen.get(k)} and ${p.c}${p.t}`); }
  seen.set(k, p.c+p.t);
  if (!named.has(`${p.c}:${p.x},${p.y},${p.z}`)) { unexpected++; no(`a ${p.c} ${p.t} on (${k}) is not in TRID.md's list`); }
}
if (!offBoard) ok('every piece starts on a real square');
if (!collide)  ok('no two pieces share a square');
if (!unexpected) ok('every starting square matches the one recorded in TRID.md');

for (const c of ['w','b']) {
  const n = V.start.filter(p => p.t==='k' && p.c===c).length;
  n === 1 ? ok(`exactly one ${c==='w'?'white':'black'} king`) : no(`${n} ${c} kings`);
}
/* The count that separates Meder from W3DCF: knights on the MAIN board, not the attack
   boards. Getting this backwards is implementing the ruleset we did not choose. */
const knightsOnAB = V.start.filter(p => p.t==='n' && (p.y===1 || p.y===3)).length;
knightsOnAB === 0
  ? ok('no knight starts on an attack board (Meder, not W3DCF)')
  : no(`${knightsOnAB} knight(s) on attack boards - that is the W3DCF setup, not Meder's`);
const royalsOnAB = V.start.filter(p => (p.t==='k'||p.t==='q') && (p.y===1 || p.y===3)).length;
royalsOnAB === 4
  ? ok('both kings and both queens start on attack boards (Meder)')
  : no(`${royalsOnAB} king/queen on attack boards, want 4`);

console.log(bad ? `\n${bad} problem(s) - the board is not the board TRID.md describes`
                : '\nthe lattice, the square set and the opening position all match TRID.md');
process.exit(bad ? 1 : 0);
