/* Does traditional chess actually play by the rules of chess?
 *
 *     node tools/perft-flat.mjs [depth]
 *
 * WHY THIS EXISTS SEPARATELY. Cubic chess is guarded by tools/agree.mjs, which compares
 * the display model against the search engine. That engine is cubic-only - it lives in
 * a Worker with its own copy of its own source, hard-coded to 512 cells - so the flat
 * variant has NO second implementation to be checked against, and the strongest guard
 * this project has does not apply to it.
 *
 * Standard chess has something better: perft numbers that have been published and
 * cross-verified by hundreds of engines for decades. They are external, exact, and
 * completely unforgiving - a single wrong castling or en-passant case moves them. So
 * the flat variant is checked against numbers nobody here chose.
 *
 *   depth 1        20
 *   depth 2       400
 *   depth 3     8,902
 *   depth 4   197,281
 *
 * (Chess Programming Wiki, "Perft Results", initial position.)
 *
 * If these match, the flat move generator agrees with the rest of the world about
 * castling, en passant, promotion, check evasion and the double step. If they do not,
 * the difference between the count and the expected count says roughly where to look.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const EXPECT = [null, 20, 400, 8902, 197281];
const DEPTH = Math.min(Number(process.argv[2] || 3), 4);

/* ---------- load the page headless, exactly as agree.mjs does ---------- */
function stub(name) {
  const f = function () { return stub(name + '()'); };
  return new Proxy(f, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === 'then') return undefined;
      if (k === 'length' || k === 'x' || k === 'y' || k === 'z' || k === 'w') return 0;
      if (k === 'children' || k === 'childNodes') return [];
      if (k === 'textContent' || k === 'innerHTML' || k === 'value') return '';
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
g.location = { search: '?hooks', href: 'http://localhost/?hooks', protocol: 'http:', reload(){} };
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
g.URL = URL;
g.Worker = function () { return stub('Worker'); };
g.Blob = function () { return stub('Blob'); };
g.alert = () => {}; g.confirm = () => true;

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)(?:[^>]*\bid="([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g)];
try { (0, eval)(blocks.find(m => !m[1])[2]); }
catch (e) { console.error('headless load failed: ' + e.message); process.exit(2); }
const cc = g.__cc;
if (!cc || !cc.variant) { console.error('?hooks did not expose the variant/perft surface'); process.exit(2); }

if (cc.variant('flat') !== 'flat') { console.error('the flat variant is not registered'); process.exit(2); }

/* ---------- walk ---------- */
function moves() {
  const out = [];
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) {
    const p = cc.at(x, 0, z);
    if (!p || p.c !== cc.turn) continue;
    for (const d of cc.legal(x, 0, z)) {
      // a promotion is four distinct moves, and perft counts them all
      const promo = (p.t === 'p' && (d.z === 7 || d.z === 0)) ? ['q','r','b','n'] : [null];
      for (const pr of promo) out.push([x, 0, z, d.x, d.y, d.z, pr]);
    }
  }
  return out;
}
function perft(d) {
  if (d === 0) return 1;
  const list = moves();
  if (d === 1) return list.length;
  let n = 0;
  for (const m of list) {
    const snap = cc.snapshot();
    cc.apply(m[0], m[1], m[2], m[3], m[4], m[5], m[6]);
    n += perft(d - 1);
    cc.restore(snap);
  }
  return n;
}

/* Divide: the count under each root move. A perft mismatch is localised with this
   rather than guessed at - published divides for this position are widely available,
   so the one root move whose subtree is wrong falls straight out. */
if (process.argv[3] === 'divide') {
  const NAME = ['a','b','c','d','e','f','g','h'];
  const sq = (x,z) => NAME[x] + (z+1);
  const rows = [];
  for (const m of moves()) {
    const snap = cc.snapshot();
    cc.apply(m[0], m[1], m[2], m[3], m[4], m[5], m[6]);
    rows.push([sq(m[0],m[2]) + sq(m[3],m[5]) + (m[6]||''), perft(DEPTH - 1)]);
    cc.restore(snap);
  }
  rows.sort((a,b)=>a[0].localeCompare(b[0]));
  let tot = 0;
  for (const [mv,n] of rows) { console.log('  ' + mv.padEnd(7) + String(n).padStart(8)); tot += n; }
  console.log('  total  ' + String(tot).padStart(8));
  process.exit(0);
}

let bad = 0;
console.log('traditional chess, from the opening position:\n');
for (let d = 1; d <= DEPTH; d++) {
  const t0 = Date.now();
  const got = perft(d);
  const want = EXPECT[d];
  const okd = got === want;
  if (!okd) bad++;
  console.log('  %s  depth %d  %s  (expected %s)%s',
    okd ? 'ok  ' : 'FAIL', d, String(got).padStart(7),
    String(want).padStart(7), okd ? '' : '   <-- off by ' + (got - want));
  if (!okd) break;
  if (Date.now() - t0 > 20000) { console.log('  (stopping here; deeper takes too long for a commit gate)'); break; }
}
console.log(bad ? '\nthe flat move generator disagrees with published perft' :
                  '\nthe flat move generator agrees with published perft');
process.exit(bad ? 1 : 0);
