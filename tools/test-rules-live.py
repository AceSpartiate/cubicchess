#!/usr/bin/env python3
"""Run the rules against the REAL project, over the wire.

    python tools/test-rules-live.py

Not part of tools/check.py: it needs the network and it writes to the live database,
so it is run deliberately - after publishing rules - rather than on every commit.

WHAT IT IS FOR, since tools/test-rules.mjs already covers the same ground offline:
two different jobs.

  1. It proves the rules in this repo are the rules in the console. Nothing else does.
     A file can be committed and simply never pasted.
  2. It re-calibrates tools/sim.mjs. The evaluator is an approximation of a parser
     nobody outside Google can run; the only honest way to trust it is to keep
     checking its verdicts against the real thing. Every expectation below is one the
     offline suite already asserts, so a disagreement means the SIMULATOR is wrong,
     not the rules - which is the more dangerous of the two and the harder to notice.

Each run leaves a room behind. That is correct: the rules deliberately give nobody the
right to delete a room, so a played game cannot be destroyed by either player.
"""
import json, os, secrets, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "firebase", "config.json"), encoding="utf-8"))
KEY, DB = CFG["apiKey"], CFG["databaseURL"].rstrip("/")
SV = {".sv": "timestamp"}
ALPHA = "BCDFGHJKLMNPQRSTVWXZ"          # the code alphabet: no vowels, no confusables

def code():
    # RANDOM, not derived from the clock. A clock-seeded generator collided with rooms
    # from an earlier run; a taken code cannot be recreated, so creation failed and
    # every later case in the run failed for a reason that had nothing to do with it.
    return "".join(secrets.choice(ALPHA) for _ in range(4))

def oct7(v):
    return format(v, "07o")

def anon(label):
    req = urllib.request.Request(
        "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + KEY,
        data=b'{"returnSecureToken":true}',
        headers={"Content-Type": "application/json"}, method="POST")
    d = json.load(urllib.request.urlopen(req))
    print("  %-9s %s" % (label, d["localId"][:12] + "..."))
    return d["idToken"], d["localId"]

def w(path, tok, body, method="PUT"):
    req = urllib.request.Request(
        "%s/%s.json?auth=%s" % (DB, path, tok),
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"}, method=method)
    try:
        urllib.request.urlopen(req); return True
    except urllib.error.HTTPError:
        return False

def rd(path, tok):
    try:
        urllib.request.urlopen("%s/%s.json?auth=%s" % (DB, path, tok)); return True
    except urllib.error.HTTPError:
        return False

results = []
def check(desc, got, want):
    good = (got == want)
    results.append((good, desc))
    print("  %-9s %-52s got=%-6s want=%s" % ("PASS" if good else "**FAIL**", desc,
          "allow" if got else "deny", "allow" if want else "deny"))

tA, uA = anon("white")
tB, uB = anon("black")
tX, uX = anon("stranger")
R = code()
print("room %s\n" % R)

print("HONEST PLAY - these MUST be allowed:")
check("white creates the room", w("rooms/" + R, tA,
    {"createdAt": SV, "moves": "", "seats": {"w": uA + ":Zed"}, "seen": {"w": SV}}), True)
check("black claims the empty seat", w("rooms/%s/seats/b" % R, tB, uB + ":Mira"), True)
check("black starts their heartbeat", w("rooms/%s/seen/b" % R, tB, SV), True)
check("white heartbeat", w("rooms/%s/seen/w" % R, tA, SV), True)
check("white plays ply 0", w("rooms/%s/moves" % R, tA, oct7(12345)), True)
check("black plays ply 1", w("rooms/%s/moves" % R, tB, oct7(12345) + oct7(6789)), True)
check("white plays the maximum move value", w("rooms/%s/moves" % R, tA,
    oct7(12345) + oct7(6789) + oct7(2097151)), True)
check("seated player reads the room", rd("rooms/" + R, tB), True)
check("white renames their own seat", w("rooms/%s/seats/w" % R, tA, uA + ":Zed T"), True)
check("an accented nickname", w("rooms/" + code(), tA,
    {"createdAt": SV, "moves": "", "seats": {"w": uA + ":José"}, "seen": {"w": SV}}), True)

M = oct7(12345) + oct7(6789) + oct7(2097151)
print("\nCHEATING AND GRIEFING - these MUST be denied:")
check("two plies in one write", w("rooms/%s/moves" % R, tB, M + oct7(1) + oct7(2)), False)
check("the rest of the game in one write", w("rooms/%s/moves" % R, tB, M + oct7(1) * 40), False)
check("white moves out of turn", w("rooms/%s/moves" % R, tA, M + oct7(1)), False)
check("stranger plays a move", w("rooms/%s/moves" % R, tX, M + oct7(1)), False)
check("history rewritten (prefix broken)", w("rooms/%s/moves" % R, tB,
    oct7(9) + M[7:] + oct7(1)), False)
check("move list truncated", w("rooms/%s/moves" % R, tB, M[:7]), False)
check("move list deleted", w("rooms/%s/moves" % R, tB, None, "DELETE"), False)
check("a non-octal digit in a move", w("rooms/%s/moves" % R, tB, M + "0000008"), False)
check("stranger reads the room", rd("rooms/" + R, tX), False)
check("anyone enumerates rooms", rd("rooms", tA), False)
check("stranger takes a live seat", w("rooms/%s/seats/b" % R, tX, uX + ":Eve"), False)
check("stranger heartbeats a seat they do not hold", w("rooms/%s/seen/b" % R, tX, SV), False)
check("one uid takes both seats at creation", w("rooms/" + code(), tX,
    {"createdAt": SV, "moves": "",
     "seats": {"w": uX + ":E1", "b": uX + ":E2"}, "seen": {"w": SV, "b": SV}}), False)
check("stranger writes the outcome", w("rooms/%s/over/w" % R, tX, "b"), False)
check("white writes black's outcome claim", w("rooms/%s/over/b" % R, tA, "w"), False)
check("unknown key added to the room", w("rooms/%s/hack" % R, tA, "x"), False)
check("blob smuggled two levels deep", w("rooms/%s/junk/deep" % R, tA, "x" * 200), False)
check("stranger deletes the room", w("rooms/" + R, tX, None, "DELETE"), False)
check("room created at a bad code shape", w("rooms/AEIO", tX,
    {"createdAt": SV, "moves": "", "seats": {"w": uX + ":E"}, "seen": {"w": SV}}), False)
check("a 13-character nickname", w("rooms/" + code(), tX,
    {"createdAt": SV, "moves": "", "seats": {"w": uX + ":1234567890123"},
     "seen": {"w": SV}}), False)
check("a nickname containing markup", w("rooms/" + code(), tX,
    {"createdAt": SV, "moves": "", "seats": {"w": uX + ":<b>hi</b>"}, "seen": {"w": SV}}), False)

print("\nTHE OUTCOME RULES:")
check("white claims a win (unresolved)", w("rooms/%s/over/w" % R, tA, "w"), True)
check("black plays on through an unresolved claim",
      w("rooms/%s/moves" % R, tB, M + oct7(1)), True)
M2 = M + oct7(1)
check("black resigns (names white the winner)", w("rooms/%s/over/b" % R, tB, "w"), True)
check("nobody plays on after a resignation",
      w("rooms/%s/moves" % R, tA, M2 + oct7(2)), False)
check("an outcome rewritten once set", w("rooms/%s/over/b" % R, tB, "d"), False)

bad = [d for good, d in results if not good]
print("\n%d/%d matched the offline suite" % (len(results) - len(bad), len(results)))
if bad:
    print("\nLIVE FIREBASE DISAGREES WITH tools/sim.mjs ON:")
    for d in bad:
        print("  " + d)
    print("\nThe simulator is the thing to fix, not the rules.")
sys.exit(1 if bad else 0)
