#!/usr/bin/env python3
"""
Pre-flight checks for index.html.

Run after any change:

    python tools/check.py

Exit code is non-zero if anything fails, so it can gate a commit - which is what
.githooks/pre-commit does with it.

Two checks shell out to `node` and one asks `git` what is staged. Each SKIPS rather
than fails when its tool is missing, so a machine with only Python still runs the
rest. A check that silently disappears is worse than one that says it is absent.

WHY THESE CHECKS AND NOT OTHERS. Each one stands between the repository and a
failure that presents to a player as something other than its cause:

  1  a syntax error anywhere kills the whole page - blank screen, no message
  2  a rules change silently invalidates puzzles; a puzzle that cannot be solved
     looks to a student like a student who cannot solve it
  3  an absolute URL is a school content filter's foothold - this project already
     lost the 3D board once to a blocked CDN
  4  an id the script reaches for and the markup does not have is a dead button
  5  a storage key written and never read (or the reverse) is progress that
     silently fails to save
  6  a missing three.min.js is a black rectangle
  7  a BUILD that disagrees with version.txt is a player stuck on an old copy
     while you watch the fix work on your own machine
"""
import re, sys, os, subprocess, tempfile, shutil, json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, "index.html")
s    = open(SRC, encoding="utf-8").read()
fail = []
def ok(msg):   print("  ok    " + msg)
def bad(msg):  print("  FAIL  " + msg); fail.append(msg)
def skip(msg): print("  skip  " + msg)

HAVE_NODE = shutil.which("node") is not None

# The three <script> regions, kept apart on purpose. Chrome loads them as separate
# scripts and the two rule implementations both declare `attacked` and `inCheck` at
# top level - concatenating them to check would be checking something the browser
# never runs.
BLOCKS = [(m.group(1) or "(main)", m.group(2)) for m in
          re.finditer(r'<script(?![^>]*\bsrc=)(?:[^>]*\bid="([^"]+)")?[^>]*>(.*?)</script>', s, re.S)]

print("\n1. Every script block parses on its own")
if not HAVE_NODE:
    skip("node not on PATH - syntax unchecked (install Node.js to enable)")
else:
    for name, body in BLOCKS:
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as f:
            f.write(body); tmp = f.name
        r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
        os.unlink(tmp)
        ok("%s parses" % name) if r.returncode == 0 else bad("%s does not parse:\n%s" % (name, r.stderr))

print("\n2. The rules still hold and every puzzle still works")
if not HAVE_NODE:
    skip("node not on PATH - perft and 140 puzzles unchecked")
else:
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "validate.js")],
                       capture_output=True, text=True)
    try:
        out = json.loads(r.stdout.strip().splitlines()[-1])
    except Exception:
        bad("validate.js did not return JSON:\n" + (r.stdout + r.stderr)[:2000])
    else:
        for n in out.get("notes", []): print("  note  " + n)
        if out.get("ok"):
            ok("perft and all puzzles validate")
        else:
            for p in out.get("problems", [])[:12]:
                bad(p)
            extra = len(out.get("problems", [])) - 12
            if extra > 0:
                print("  ...   and %d more" % extra)

print("\n3. Nothing is fetched from another host")
# The whole point of vendoring three.js. A CDN this district blocks cost students
# the board once already, and the failure looked like a broken game.
urls = re.findall(r'(?:src|href)\s*=\s*["\'](https?://[^"\']+)["\']', s)
urls = [u for u in urls if not u.startswith("http://www.w3.org/")]   # SVG/XML namespaces
if urls:
    bad("absolute URL(s) in src/href - vendor the file instead: %s" % sorted(set(urls)))
else:
    ok("no absolute src/href")
# fetch() to another origin is the same problem wearing a different hat. api.github.com
# is expected until the room-code transport lands; it is named so it cannot be forgotten.
fetches = sorted(set(re.findall(r'fetch\(\s*["\'](https?://[^"\']+)["\']', s)))
known_pending = [u for u in fetches if u.startswith("https://api.github.com")]
other = [u for u in fetches if u not in known_pending]
if other:
    bad("fetch() to an unexpected host: %s" % other)
elif known_pending:
    print("  note  fetch to api.github.com is the old online mode, pending replacement")

print("\n4. Every id the script reaches for exists")
# Ids appear in static markup AND inside innerHTML strings - both are `id="x"` in this
# source, so one scan finds both, which is a property of the single-file build.
declared = set(re.findall(r'\bid\s*=\s*"([A-Za-z0-9_-]+)"', s))
declared |= set(re.findall(r"\bid\s*=\s*'([A-Za-z0-9_-]+)'", s))
wanted  = set(re.findall(r'getElementById\(\s*["\']([A-Za-z0-9_-]+)["\']', s))
wanted |= set(re.findall(r'\$\(\s*["\']([A-Za-z0-9_-]+)["\']\s*\)', s))
missing = sorted(wanted - declared)
if missing:
    bad("script reaches for id(s) that no markup declares: %s" % missing)
else:
    ok("all %d referenced ids exist" % len(wanted))

print("\n5. Every storage key is both written and read")
# A key written and never read loses progress silently; read and never written is a
# feature that never restores. Both have shipped in projects like this one.
for api in ("localStorage", "sessionStorage"):
    wrote = set(re.findall(api + r'\.setItem\(\s*["\']([^"\']+)["\']', s))
    read  = set(re.findall(api + r'\.getItem\(\s*["\']([^"\']+)["\']', s))
    gone  = set(re.findall(api + r'\.removeItem\(\s*["\']([^"\']+)["\']', s))
    # removeItem alone is legitimate: it is how a key gets retired.
    w_only = sorted(wrote - read)
    r_only = sorted(read - wrote - gone)
    if w_only: bad("%s key written but never read: %s" % (api, w_only))
    if r_only: bad("%s key read but never written: %s" % (api, r_only))
    if not w_only and not r_only:
        ok("%s keys balanced (%s)" % (api, ", ".join(sorted(wrote | read)) or "none"))

print("\n6. The vendored library is actually there")
tag = re.search(r'<script src="([^"]+)"></script>', s)
if not tag:
    bad("no local <script src> - three.js is not being loaded at all")
else:
    lib = os.path.join(ROOT, tag.group(1))
    if not os.path.exists(lib):
        bad("index.html loads %s and that file is not in the repo" % tag.group(1))
    else:
        size = os.path.getsize(lib)
        rev = re.search(r'const e="(\d+)"', open(lib, encoding="utf-8", errors="replace").read(4000))
        ok("%s present (%d KB%s)" % (tag.group(1), size // 1024,
                                     ", three.js r" + rev.group(1) if rev else ""))
if 'id="err"' not in s:
    bad("the #err panel is gone - a failed library load goes back to being a black rectangle")

print("\n7. The build stamp agrees with version.txt")
VER = os.path.join(ROOT, "version.txt")
m = re.search(r'const BUILD="([^"]*)";', s)
if not m:
    bad('no `const BUILD="...";` in index.html - tools/stamp.py cannot stamp it')
elif not os.path.exists(VER):
    bad("version.txt is missing - run python tools/stamp.py")
else:
    v = open(VER, encoding="utf-8").read().strip()
    if m.group(1) != v:
        bad("index.html says build %s, version.txt says %s - run python tools/stamp.py"
            % (m.group(1), v))
    else:
        ok("build %s" % v)

print("\n8. The database rules are shaped like database rules")
# This check exists because the rules were once published with "//1": "a comment" as a
# child key. In RTDB any key NOT starting with '.' is a PATH and must map to an object,
# so the console rejected the whole file with "Line 10: Expected '{'" - after the file
# had been committed, pushed, and handed over as ready to paste. Valid JSON is not the
# same as valid rules, and only the second one matters.
RULES = os.path.join(ROOT, "firebase", "database.rules.json")
RULE_KEYS = {".read", ".write", ".validate", ".indexOn"}
if not os.path.exists(RULES):
    skip("no firebase/database.rules.json")
else:
    try:
        doc = json.load(open(RULES, encoding="utf-8"))
    except Exception as e:
        bad("database.rules.json is not valid JSON: %s" % e)
    else:
        errs = []
        def walk(node, path):
            if not isinstance(node, dict):
                errs.append("%s should be an object, is %s" % (path or "(root)", type(node).__name__))
                return
            for k, v in node.items():
                where = (path + "/" + k) if path else k
                if k.startswith("."):
                    if k not in RULE_KEYS:
                        errs.append("%s is not a rule name (expected one of %s)"
                                    % (where, ", ".join(sorted(RULE_KEYS))))
                    elif k == ".indexOn":
                        if not isinstance(v, (list, str)):
                            errs.append("%s must be a string or list" % where)
                    elif not isinstance(v, (str, bool)):
                        errs.append("%s must be a string or boolean, is %s" % (where, type(v).__name__))
                else:
                    # THE ONE THAT MATTERS: a child path must be an object.
                    if not isinstance(v, dict):
                        errs.append("%s is a child path, so it must map to an object - "
                                    "a %s here is what the console rejects with \"Expected '{'\""
                                    % (where, type(v).__name__))
                    else:
                        walk(v, where)
        if list(doc.keys()) != ["rules"]:
            bad("the top level must be exactly {\"rules\": ...}, found: %s" % list(doc.keys()))
        else:
            walk(doc["rules"], "")
        for e in errs[:8]:
            bad("rules: " + e)
        if not errs and list(doc.keys()) == ["rules"]:
            n = [0]
            def count(d):
                for k, v in d.items():
                    if not k.startswith("."):
                        n[0] += 1; count(v)
            count(doc["rules"])
            ok("rules well-formed (%d path nodes)" % n[0])

print("\n9. Nothing is half-staged")
if shutil.which("git") is None:
    skip("git not on PATH")
else:
    r = subprocess.run(["git", "-C", ROOT, "diff", "--cached", "--name-only"],
                       capture_output=True, text=True)
    st = set(r.stdout.split())
    if not st:
        skip("nothing staged")
    elif "index.html" in st and "version.txt" not in st:
        bad("index.html is staged without version.txt - run python tools/stamp.py and stage both")
    else:
        ok("staged set is coherent (%d file(s))" % len(st))

print("\n" + ("PASS" if not fail else "FAILED %d check(s)" % len(fail)))
sys.exit(0 if not fail else 1)
