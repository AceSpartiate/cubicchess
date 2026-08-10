#!/usr/bin/env python3
"""Test the PUBLISHED database rules against the real project.

    python tools/test-rules.py

Not part of tools/check.py: this one touches the network and writes to the live
database, so it is run deliberately, after publishing rules, rather than on every
commit.

WHY IT EXISTS RATHER THAN THE RULES PLAYGROUND. The Playground simulates ONE path at
a time. The client's move is a multi-path PATCH - the move and the lastUid claim have
to land together - and RTDB evaluates such a write at each path SEPARATELY. A rule
set can therefore pass every Playground case and still make the game unplayable. That
is not hypothetical: it happened here. `lastUid` had no `.write` of its own, inherited
the room's, and every move in every game was denied. The Playground said fine.

The second bug it caught was worse and in the opposite direction. The room grant read
"you may write if the room does not exist OR is older than 24 hours", and that second
clause named no uid - so a day after creation any stranger holding a free anonymous
token could delete a room, rewrite its history, or seat themselves in it, because
write grants cascade and skip every rule beneath. The two bugs concealed each other:
the only window in which the game worked was the window in which it was wide open.

So both directions are tested. A rule that denies honest play is as much a bug as one
that permits cheating, and only one of those is visible from the outside.

NOTE: each run leaves one room behind. That is correct, not a leak - the rules
deliberately give nobody the right to delete a room, so a played game cannot be
destroyed by either player. Rooms are a few hundred bytes; clear them from the
console if they ever bother you.
"""
import json, os, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "firebase", "config.json"), encoding="utf-8"))
KEY, DB = CFG["apiKey"], CFG["databaseURL"].rstrip("/")
SV = {".sv": "timestamp"}

# A fresh code per run; the rules correctly refuse to let anyone delete or overwrite an
# existing room, so a re-run cannot reuse the last one. Vowel-free, like the real codes.
A = "BCDFGHJKLMNPQRSTVWXZ"
def fresh_code():
    n = int(time.time())
    return "".join(A[(n >> (5 * i)) % len(A)] for i in range(4))

ROOM = (sys.argv[1] if len(sys.argv) > 1 else fresh_code()).upper()

def anon(label):
    req = urllib.request.Request(
        "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + KEY,
        data=json.dumps({"returnSecureToken": True}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    d = json.load(urllib.request.urlopen(req))
    print("  %-8s uid=%s" % (label, d["localId"]))
    return d["idToken"], d["localId"]

def write(path, tok, body, method="PUT"):
    req = urllib.request.Request(
        "%s/%s.json?auth=%s" % (DB, path, tok),
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method=method)
    try:
        urllib.request.urlopen(req); return True, ""
    except urllib.error.HTTPError as e:
        return False, "%d %s" % (e.code, e.read().decode()[:80].replace("\n", " "))

def read(path, tok):
    try:
        json.load(urllib.request.urlopen("%s/%s.json?auth=%s" % (DB, path, tok)))
        return True, ""
    except urllib.error.HTTPError as e:
        return False, str(e.code)

results = []
def check(desc, got, want, detail=""):
    good = (got == want)
    results.append((good, desc))
    print("  %-8s %-52s got=%-6s want=%-6s %s"
          % ("PASS" if good else "**FAIL**", desc,
             "allow" if got else "deny", "allow" if want else "deny",
             detail if not good else ""))

print("project %s, room %s" % (CFG["projectId"], ROOM))
print("tokens:")
tA, uA = anon("white")
tB, uB = anon("black")
tX, uX = anon("stranger")

print("\nHONEST PLAY - these MUST be allowed:")
ok, d = write("rooms/" + ROOM, tA, {"createdAt": SV, "status": "open",
    "seats": {"w": {"uid": uA, "name": "TestA", "lastSeen": SV}}})
check("white creates the room", ok, True, d)
ok, d = write("rooms/%s/seats/b" % ROOM, tB, {"uid": uB, "name": "TestB", "lastSeen": SV})
check("black claims the empty seat", ok, True, d)
ok, d = write("rooms/%s/seats/w/lastSeen" % ROOM, tA, SV)
check("white heartbeat (lastSeen only)", ok, True, d)
ok, d = write("rooms/" + ROOM, tA, {"moves/0": {"v": 12345, "uid": uA}, "lastUid": uA}, "PATCH")
check("white plays ply 0 (move + lastUid, atomic)", ok, True, d)
ok, d = write("rooms/" + ROOM, tB, {"moves/1": {"v": 6789, "uid": uB}, "lastUid": uB}, "PATCH")
check("black replies ply 1", ok, True, d)
ok, d = read("rooms/" + ROOM, tB)
check("black can read the room", ok, True, d)
ok, d = write("rooms/%s/status" % ROOM, tA, "live")
check("seated player sets status", ok, True, d)
ok, d = write("rooms/%s/result" % ROOM, tB, "w:mate")
check("seated player sets result", ok, True, d)

print("\nCHEATING AND GRIEFING - these MUST be denied:")
for desc, args in [
    ("black moves twice in a row",
        ("rooms/" + ROOM, tB, {"moves/2": {"v": 111, "uid": uB}, "lastUid": uB}, "PATCH")),
    ("white overwrites a played move (ply 1)",
        ("rooms/" + ROOM, tA, {"moves/1": {"v": 999, "uid": uA}, "lastUid": uA}, "PATCH")),
    ("stranger writes a move into the room",
        ("rooms/" + ROOM, tX, {"moves/2": {"v": 222, "uid": uX}, "lastUid": uX}, "PATCH")),
    ("stranger steals a live seat",
        ("rooms/%s/seats/w" % ROOM, tX, {"uid": uX, "name": "Thief", "lastSeen": SV}, "PUT")),
    ("white moves without claiming lastUid",
        ("rooms/" + ROOM, tA, {"moves/2": {"v": 333, "uid": uA}}, "PATCH")),
    ("stranger forges lastUid",
        ("rooms/%s/lastUid" % ROOM, tX, uX, "PUT")),
    ("white writes a move stamped with black's uid",
        ("rooms/%s/moves/2" % ROOM, tA, {"v": 5000, "uid": uB}, "PUT")),
    ("white grabs the second seat too",
        ("rooms/%s/seats/b" % ROOM, tA, {"uid": uA, "name": "TestA", "lastSeen": SV}, "PUT")),
    ("black edits the value of a played move",
        ("rooms/%s/moves/0/v" % ROOM, tB, 4242, "PUT")),
    ("unknown field added to the room",
        ("rooms/%s/hack" % ROOM, tA, "x", "PUT")),
    ("move integer out of 21-bit range",
        ("rooms/%s/moves/3" % ROOM, tB, {"v": 9999999, "uid": uB}, "PUT")),
    ("stranger deletes the whole room",
        ("rooms/" + ROOM, tX, None, "DELETE")),
    ("stranger overwrites the whole room",
        ("rooms/" + ROOM, tX, {"createdAt": SV, "status": "done", "result": "X wins",
            "lastUid": uX,
            "seats": {"w": {"uid": uX, "name": "Thief", "lastSeen": SV},
                      "b": {"uid": uX, "name": "Thief2", "lastSeen": SV}},
            "moves": {"0": {"v": 1, "uid": uX}}}, "PUT")),
    ("stranger sets status", ("rooms/%s/status" % ROOM, tX, "done", "PUT")),
    ("stranger sets result", ("rooms/%s/result" % ROOM, tX, "X wins", "PUT")),
    ("seated player resets their own room wholesale",
        ("rooms/" + ROOM, tA, {"createdAt": SV,
            "seats": {"w": {"uid": uA, "name": "TestA", "lastSeen": SV}}}, "PUT")),
    ("seated player deletes a played move",
        ("rooms/%s/moves/0" % ROOM, tA, None, "DELETE")),
    ("stranger writes another player's stats",
        ("users/%s/stats" % uA, tX, {"w": 99, "l": 0, "d": 0}, "PUT")),
]:
    ok, _ = write(*args)
    check(desc, ok, False)

ok, _ = read("rooms", tA)
check("enumerate all rooms", ok, False)

# A room CREATED with moves already in it - the create grant cascades, so this is the
# one place a fabricated history could have been smuggled past the per-move rules.
ok, _ = write("rooms/" + fresh_code()[::-1], tX, {
    "createdAt": SV, "seats": {"w": {"uid": uX, "name": "X", "lastSeen": SV}},
    "moves": {"0": {"v": 1, "uid": uX}, "1": {"v": 2, "uid": uX}}})
check("room CREATED with a fabricated move list", ok, False)

bad = [d for good, d in results if not good]
print("\n%d/%d passed" % (len(results) - len(bad), len(results)))
if bad:
    print("\nFAILURES:")
    for d in bad:
        print("  " + d)
sys.exit(1 if bad else 0)
