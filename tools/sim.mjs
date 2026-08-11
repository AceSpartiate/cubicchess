/* A small Realtime Database rules evaluator - enough to run multi-path writes for real.
 *
 * WHY THIS EXISTS. The Firebase Rules Playground simulates ONE path at a time. The
 * client's move is a multi-path write, and RTDB evaluates every leg of such a write
 * against the SAME pre-write snapshot - which is precisely where three shipped rule
 * bugs lived. The Playground could not have caught any of them.
 *
 * CALIBRATED, NOT ASSUMED. Before being trusted, this was run against 29 requests whose
 * real verdicts were known from issuing them to the live project - 6 working exploits
 * and 23 ordinary cases - and agreed on 29/29. Re-calibrate it if the semantics below
 * are ever changed.
 *
 * Models: .write cascading down and not revocable beneath; .validate at the written
 * node and its descendants but NOT its ancestors; .validate skipped for deletes;
 * `root`/`data` pre-write and `newData` post-write; $wildcard capture.
 */
import fs from 'fs';

let RULES = JSON.parse(fs.readFileSync(new URL('../firebase/database.rules.json', import.meta.url), 'utf8')).rules;

/* Point the evaluator at a different rules object. tools/calibrate-sim.mjs uses this
 * to replay a set of rules that were once live, against verdicts recorded from the
 * real Firebase, so the evaluator stays pinned to reality as it changes. */
export function useRules(obj) { RULES = obj.rules || obj; }

// ---- string methods RTDB adds ----
String.prototype.matches = function (re) { return re.test(this.valueOf()); };
String.prototype.contains = function (s) { return this.valueOf().indexOf(s) >= 0; };
String.prototype.beginsWith = function (s) { return this.valueOf().startsWith(s); };
String.prototype.endsWith2 = function (s) { return this.valueOf().endsWith(s); };

// ---- tree helpers ----
const seg = p => String(p).split('/').filter(Boolean);
function at(tree, path) {
  let n = tree;
  for (const k of seg(path)) {
    if (n === null || n === undefined || typeof n !== 'object') return null;
    n = (k in n) ? n[k] : null;
  }
  return n === undefined ? null : n;
}
function setIn(tree, path, val) {
  const s = seg(path);
  if (!s.length) return val;
  const out = (tree && typeof tree === 'object') ? { ...tree } : {};
  const k = s[0];
  if (s.length === 1) {
    if (val === null) { const o = { ...out }; delete o[k]; return o; }
    out[k] = val; return out;
  }
  out[k] = setIn(out[k] ?? null, s.slice(1).join('/'), val);
  return out;
}

class Snap {
  constructor(root, path) { this.root = root; this.path = seg(path).join('/'); }
  _n() { return at(this.root, this.path); }
  val() { const v = this._n(); return v === undefined ? null : v; }
  child(p) { return new Snap(this.root, this.path ? this.path + '/' + p : String(p)); }
  parent() { const s = seg(this.path); s.pop(); return new Snap(this.root, s.join('/')); }
  exists() { return this._n() !== null; }
  // hasChild/hasChildren take a PATH, not a key: hasChild('seats/b') is legal and
  // common. These once did a raw v[k] lookup, so any path form silently returned
  // false — which made every `!newData.hasChild('seats/b')` guard vacuously TRUE and
  // the suite green on rules that were not being tested. A bug in the checker is
  // worse than a bug in the thing checked, because it is invisible and it reassures.
  hasChild(p) { return at(this.root, this.path ? this.path + '/' + p : String(p)) !== null; }
  hasChildren(ps) {
    const v = this._n();
    if (!v || typeof v !== 'object') return false;
    if (!ps) return Object.keys(v).length > 0;
    return ps.every(p => this.hasChild(p));
  }
  isNumber() { return typeof this._n() === 'number'; }
  isString() { return typeof this._n() === 'string'; }
  isBoolean() { return typeof this._n() === 'boolean'; }
  getPriority() { return null; }
}

function evalRule(expr, ctx) {
  if (expr === true || expr === false) return expr;
  const names = ['root', 'data', 'newData', 'auth', 'now', ...Object.keys(ctx.vars)];
  const vals = [ctx.root, ctx.data, ctx.newData, ctx.auth, ctx.now, ...Object.values(ctx.vars)];
  try {
    // eslint-disable-next-line no-new-func
    return !!new Function(...names, 'return (' + expr + ');')(...vals);
  } catch (e) { return { error: e.message }; }
}

// walk the rules tree to the node governing `path`, collecting wildcard bindings
function ruleChain(path) {
  const out = [];
  let node = RULES, vars = {};
  out.push({ node, vars: { ...vars }, path: '' });
  let acc = '';
  for (const k of seg(path)) {
    let next = null;
    if (node && Object.prototype.hasOwnProperty.call(node, k)) next = node[k];
    else {
      const wc = node ? Object.keys(node).find(x => x[0] === '$') : null;
      if (wc) { next = node[wc]; vars = { ...vars, [wc]: k }; }
    }
    acc = acc ? acc + '/' + k : k;
    if (!next) { out.push({ node: null, vars: { ...vars }, path: acc }); break; }
    node = next;
    out.push({ node, vars: { ...vars }, path: acc });
  }
  return out;
}

function allowedWrite(preRoot, postRoot, path, auth, now, trace) {
  const chain = ruleChain(path);
  for (const step of chain) {
    if (!step.node || typeof step.node['.write'] === 'undefined') continue;
    const ctx = {
      root: new Snap(preRoot, ''), data: new Snap(preRoot, step.path),
      newData: new Snap(postRoot, step.path), auth, now, vars: step.vars
    };
    const r = evalRule(step.node['.write'], ctx);
    if (r && r.error) { trace.push(`  ERROR .write @${step.path}: ${r.error}`); continue; }
    if (r) { trace.push(`  .write granted @/${step.path}`); return true; }
    trace.push(`  .write false @/${step.path}`);
  }
  return false;
}

// validate at the written location and every descendant that exists post-write
function validateSubtree(preRoot, postRoot, path, auth, now, trace) {
  const chain = ruleChain(path);
  const start = chain[chain.length - 1];
  const rec = (node, vars, p) => {
    const v = at(postRoot, p);
    if (v === null || v === undefined) return true;
    if (node && typeof node['.validate'] !== 'undefined') {
      const ctx = {
        root: new Snap(preRoot, ''), data: new Snap(preRoot, p),
        newData: new Snap(postRoot, p), auth, now, vars
      };
      const r = evalRule(node['.validate'], ctx);
      if (r && r.error) { trace.push(`  ERROR .validate @/${p}: ${r.error}`); return false; }
      if (!r) { trace.push(`  .validate FAILED @/${p}`); return false; }
    }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        let child = null, nv = vars;
        if (node && Object.prototype.hasOwnProperty.call(node, k)) child = node[k];
        else if (node) {
          const wc = Object.keys(node).find(x => x[0] === '$');
          if (wc) { child = node[wc]; nv = { ...vars, [wc]: k }; }
        }
        if (child && !rec(child, nv, p + '/' + k)) return false;
      }
    }
    return true;
  };
  return rec(start.node, start.vars, start.path);
}

// A request = list of [path, value]; value null = delete. {SV:1} = server timestamp.
export function request(preRoot, writes, auth, now, label) {
  const trace = [];
  let postRoot = preRoot;
  const stamped = writes.map(([p, v]) => [p, JSON.parse(JSON.stringify(v), (k, x) =>
    (x && typeof x === 'object' && x['.sv'] === 'timestamp') ? now : x)]);
  for (const [p, v] of stamped) postRoot = setIn(postRoot, p, v);
  let ok = true;
  for (const [p] of stamped) {
    if (!allowedWrite(preRoot, postRoot, p, auth, now, trace)) { trace.push(`  DENIED (no .write) for /${p}`); ok = false; break; }
    if (!validateSubtree(preRoot, postRoot, p, auth, now, trace)) { trace.push(`  DENIED (.validate) for /${p}`); ok = false; break; }
  }
  return { ok, root: ok ? postRoot : preRoot, trace, label };
}

export function canRead(root, path, auth) {
  const chain = ruleChain(path);
  for (const step of chain) {
    if (!step.node || typeof step.node['.read'] === 'undefined') continue;
    const ctx = { root: new Snap(root, ''), data: new Snap(root, step.path), newData: new Snap(root, step.path), auth, now: Date.now(), vars: step.vars };
    if (evalRule(step.node['.read'], ctx) === true) return true;
  }
  return false;
}

export const SV = { '.sv': 'timestamp' };
