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

print("\n1b. The engine block stays self-contained")
# It is serialised into a Blob and run in a Worker, so it gets its own copy of its own
# source and shares NO scope with the main script. Referencing anything from out there
# throws only when a Worker actually runs it - which is to say, in front of a player,
# not in front of `node --check`. A blanket edit reached in here once and replaced a
# board-size literal with the main script's variant object; validate.js caught it, but
# only because it happens to run the engine outside a Worker.
ENGINE_MUST_NOT_SEE = ["VARIANTS", "V.cells", "V.idx", "V.inside", "V.start",
                       "document", "window.", "localStorage", "THREE.", "$("]
eng_body = dict(BLOCKS).get("cubicEngine", "")
reached = [n for n in ENGINE_MUST_NOT_SEE if n in eng_body]
if not eng_body:
    bad("no cubicEngine block found")
elif reached:
    bad("the engine block references things it cannot see from a Worker: %s\n"
        "        it shares no scope with the main script - give it its own copy" % reached)
else:
    ok("the engine block references nothing from the main script")

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

print("\n2b. The two rule implementations agree with each other")
# The gap this closes. The movement rules exist TWICE - the search engine, and the
# display model's legalMoves() that the UI actually plays by - and MAINTENANCE.md says
# they must agree. Everything above tests the ENGINE. Nothing tested the display model
# at all, so perft could not have noticed it drifting: perft never runs it.
if not HAVE_NODE:
    skip("node not on PATH - the two rule implementations are unchecked against each other")
else:
    r = subprocess.run(["node", os.path.join(ROOT, "tools", "agree.mjs"), "25", "50"],
                       capture_output=True, text=True, cwd=ROOT)
    tail = (r.stdout.strip().splitlines() or [""])[-1]
    if r.returncode == 0:
        ok(tail)
    elif r.returncode == 2:
        skip("the headless harness could not load the page: " + (r.stderr.strip().splitlines() or [""])[0])
    else:
        bad("the engine and legalMoves() disagree:\n" + r.stdout[-1500:])

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
# Every host the page may talk to, named on purpose. A new one is a decision - it is
# another thing a school filter can block and another party the game depends on - so it
# fails here until it is written down rather than passing because it looked plausible.
ALLOWED_HOSTS = {
    "identitytoolkit.googleapis.com":
        "anonymous sign-in; under googleapis.com, which a Workspace district cannot "
        "block without breaking its own Chromebooks",
    "securetoken.googleapis.com":
        "refreshing that token so a seat survives a reload",
}
fetches = sorted(set(re.findall(r'fetch\(\s*["\'](https?://([^/"\']+)[^"\']*)["\']', s)))
unknown = [u for u, host in fetches if host not in ALLOWED_HOSTS]
if unknown:
    bad("fetch() to a host that is not in ALLOWED_HOSTS: %s\n"
        "        add it there with a reason, or vendor it" % unknown)
else:
    for _, host in fetches:
        print("  note  %s - %s" % (host, ALLOWED_HOSTS[host]))
    # The database host is built from a variable, so it never appears as a literal here.
    if "firebasedatabase.app" in s or "firebaseio.com" in s:
        print("  note  the Realtime Database host is the ONE domain in this design that "
              "has not been tried from a student Chromebook")

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

# AND THE OTHER DIRECTION, which is the half that was missing. The check above catches a
# script reaching for a control that is not there. It says nothing about a control that
# IS there and that no script ever touches - a button a player can press that does
# nothing at all. Two of those shipped in one commit: the markup for a checkbox and a
# button landed while the edit adding their handlers silently matched nothing.
#
# Only INTERACTIVE elements are required to be wired. Plenty of ids exist for styling or
# for a <label>, and demanding a handler for those would be noise.
# Membership is tested against every quoted string in the SCRIPT blocks, not against the
# getElementById/$() calls alone. Five controls are wired through
#   [['opMove','move'], ...].forEach(([id,cat]) => { $(id)... })
# which no call-site regex can see, and calling those dead would have been a false alarm
# that teaches everyone to ignore this check. Searching the script text keeps the
# question honest: does this id appear anywhere the code could be using it?
script_text = "\n".join(body for _, body in BLOCKS)
script_literals = set(re.findall(r'["\']([A-Za-z0-9_-]+)["\']', script_text))
controls = set()
for m in re.finditer(r'<(button|input|select|textarea)\b([^>]*)>', s, re.I):
    idm = re.search(r'\bid\s*=\s*["\']([A-Za-z0-9_-]+)["\']', m.group(2))
    if idm:
        controls.add(idm.group(1))
dead = sorted(c for c in controls if c not in wanted and c not in script_literals)
if dead:
    bad("control(s) in the markup that no script ever reaches for - a player can press "
        "them and nothing happens: %s" % dead)
else:
    ok("all %d interactive controls are wired" % len(controls))

print("\n5. Every storage key is both written and read")
# A key written and never read loses progress silently; read and never written is a
# feature that never restores. Both have shipped in projects like this one.
# Three accessors, not two. Per-player data goes through ccGet/ccSet/ccDel, which pick
# sessionStorage or localStorage from the "this device is mine" flag - so a key reached
# that way is invisible to a scan of the raw APIs, and this check would have quietly
# stopped covering cc_rm, cc_room, cc_nick and cc_rec the moment they moved.
ACCESSORS = [
    ("localStorage",   r'localStorage\.setItem',   r'localStorage\.getItem',   r'localStorage\.removeItem'),
    ("sessionStorage", r'sessionStorage\.setItem', r'sessionStorage\.getItem', r'sessionStorage\.removeItem'),
    ("cc* (per-player)", r'ccSet', r'ccGet', r'ccDel'),
]
for label, wpat, rpat, dpat in ACCESSORS:
    wrote = set(re.findall(wpat + r'\(\s*["\']([^"\']+)["\']', s))
    read  = set(re.findall(rpat + r'\(\s*["\']([^"\']+)["\']', s))
    gone  = set(re.findall(dpat + r'\(\s*["\']([^"\']+)["\']', s))
    # removeItem alone is legitimate: it is how a key gets retired.
    w_only = sorted(wrote - read)
    r_only = sorted(read - wrote - gone)
    if w_only: bad("%s key written but never read: %s" % (label, w_only))
    if r_only: bad("%s key read but never written: %s" % (label, r_only))
    if not w_only and not r_only:
        ok("%s keys balanced (%s)" % (label, ", ".join(sorted(wrote | read)) or "none"))

# A per-player key must not ALSO be touched through the raw API, or half its accesses
# ignore the shared-device flag and the bug comes back through the side door.
PLAYER_KEYS = {"cc_rm", "cc_room", "cc_nick", "cc_rec"}
raw = set(re.findall(r'(?:local|session)Storage\.(?:set|get|remove)Item\(\s*["\']([^"\']+)["\']', s))
leaked = sorted(PLAYER_KEYS & raw)
if leaked:
    bad("per-player key(s) reached through the raw storage API, bypassing the "
        "shared-device flag: %s - use ccGet/ccSet/ccDel" % leaked)
else:
    ok("no per-player key bypasses the accessor")

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
        # Second failure class, and the reason this is a lint and not just a shape check:
        # `newData.root()` was published and rejected with "No such method/property
        # 'root'". A rules expression is a tiny language with a CLOSED set of methods -
        # `root` is a standalone variable, never a method on a snapshot - and anything
        # outside that set is a publish-time error the console reports by line number,
        # which is no help at all when you are reading the file on a different machine.
        SNAP_METHODS = {
            "val", "child", "parent", "hasChild", "hasChildren", "exists", "getPriority",
            "isNumber", "isString", "isBoolean",
            "contains", "beginsWith", "endsWith", "replace", "toLowerCase", "toUpperCase",
            "matches",
        }
        def lint_expr(expr, where):
            # Third failure class. A regex literal that is perfectly valid JavaScript can
            # still be refused by the rules parser: a character class containing a double
            # quote or an escaped backslash was rejected with
            #   Line 24: Illegal regular expression, expected ']'
            # after the file had been handed over as ready to paste. Neither character is
            # usually load-bearing - excluding < > & already stops markup - so the lint
            # says so rather than letting the console say it to whoever is pasting.
            for lit in re.findall(r'/(?:[^/\\\n]|\\.)+/', expr):
                # Fifth failure class, and the quietest. The rules parser reads \n, \r
                # and \t inside a character class as the LETTERS n, r and t. A class
                # written [^:\n\r] to exclude newlines silently excluded every name
                # containing a lowercase n or r - Aaron, Brian, Erin, Ryan - and the
                # child just got a permission error with no explanation. The console
                # accepts it happily; only a live write shows it.
                for esc, ch in (('\\n', 'n'), ('\\r', 'r'), ('\\t', 't')):
                    if esc in lit:
                        errs.append("%s has %s inside the regex %s - the rules parser "
                                    "reads it as the letter '%s', so that letter is "
                                    "silently banned; drop the escape"
                                    % (where, esc, lit, ch))
                if '"' in lit:
                    errs.append('%s has a double quote inside the regex %s - the rules '
                                'parser rejects it; drop it or match on what it guards'
                                % (where, lit))
                if '\\\\' in lit:
                    errs.append('%s has an escaped backslash inside the regex %s - the '
                                'rules parser rejects it' % (where, lit))
            # Fourth failure class, and the most expensive to find. A rule that reads a
            # SIBLING LEG of the same multi-path write - newData.parent().parent()... -
            # is honoured by the live engine when the sibling already exists and NOT
            # when it is being created. The simulator allowed both, so the offline suite
            # was green on a rule set in which nobody could join a game. Read pre-write
            # state through `root` and let each write stand on its own instead.
            if '.parent().parent()' in expr:
                errs.append("%s reads across a multi-path write with .parent().parent() - "
                            "the live engine and the simulator disagree on that; use root "
                            "for pre-write state and keep each write self-contained" % where)
            for meth in set(re.findall(r'\.([A-Za-z_][A-Za-z0-9_]*)\s*\(', expr)):
                if meth in SNAP_METHODS:
                    continue
                hint = ""
                if meth == "root":
                    hint = (" - `root` is a standalone variable holding the PRE-write tree; "
                            "for POST-write state walk up with .parent()")
                elif meth == "length":
                    hint = " - length is a property, not a method: use .length without ()"
                errs.append("%s calls .%s(), which is not a rules method%s" % (where, meth, hint))
        def walk_exprs(node, path):
            for k, v in node.items():
                where = (path + "/" + k) if path else k
                if k.startswith("."):
                    if isinstance(v, str):
                        lint_expr(v, where)
                elif isinstance(v, dict):
                    walk_exprs(v, where)

        if list(doc.keys()) != ["rules"]:
            bad("the top level must be exactly {\"rules\": ...}, found: %s" % list(doc.keys()))
        else:
            walk(doc["rules"], "")
            walk_exprs(doc["rules"], "")
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

print("\n9. The rules do what they are supposed to, and nothing else")
# Shape and syntax (check 8) say the console will ACCEPT the file. They say nothing
# about whether it lets a stranger delete a room, or refuses a legal move. Three rule
# sets have shipped here that passed every check available in the Firebase console: one
# where no move could be played at all, one where any stranger could delete a day-old
# game, and one where a player could write the whole rest of the game in a single
# request. tools/sim.mjs evaluates multi-path writes the way RTDB really does - which
# is the one thing the Rules Playground cannot do - and it was calibrated against 29
# requests whose live verdicts were known before it was trusted.
if not HAVE_NODE:
    skip("node not on PATH - rules behaviour unchecked")
elif not os.path.exists(os.path.join(ROOT, "tools", "test-rules.mjs")):
    skip("no tools/test-rules.mjs")
else:
    # The evaluator gets checked BEFORE the thing it evaluates. It once shipped with
    # hasChild() doing a raw property lookup, so every path form silently returned
    # false, four guards went vacuously true, and the suite was green on rules it was
    # not testing. A green suite on a broken checker is worse than no suite: it
    # reassures. calibrate-sim.mjs pins it to verdicts recorded from the live project.
    for script, what in (("calibrate-sim.mjs", "evaluator"), ("test-rules.mjs", "rules")):
        r = subprocess.run(["node", os.path.join(ROOT, "tools", script)],
                           capture_output=True, text=True, cwd=ROOT)
        tail = (r.stdout.strip().splitlines() or [""])[-1]
        if r.returncode == 0:
            ok("%s: %s" % (what, tail))
        else:
            bad("%s check failed:\n%s" % (what, (r.stdout + r.stderr)[-2000:]))
            break

print("\n10. Nothing is half-staged")
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
