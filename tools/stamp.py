#!/usr/bin/env python3
"""Stamp a build id - a UTC minute - into index.html and version.txt, so a stale
copy can tell.

GitHub Pages serves index.html with a cache lifetime. Without this, a player can be
running a build from before the last fix and reporting bugs that are already mended.

Run this before committing anything you intend to deploy:

    python tools/stamp.py

It writes the same value in two places. index.html gets it as `const BUILD="..."`,
baked into whatever copy the browser has cached; version.txt gets it as the only
thing in the file, fetched with cache:"no-store". If the two disagree, the page is
out of date and reloads itself once.

They MUST be written together, which is the whole reason this is a script and not a
habit. check.py's stamp check refuses a commit where they have drifted apart.
"""
import io
import os
import re
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "index.html")
VER = os.path.join(ROOT, "version.txt")


def build_id():
    """A UTC minute, and nothing else.

    Not the commit hash, however tempting. This runs BEFORE `git commit`, so
    `git rev-parse HEAD` reports the PREVIOUS commit - every build would be stamped
    with its parent, and a bug report naming a build would point at code that build
    does not contain. Stamping afterwards and amending re-hashes the commit and
    invalidates the stamp again: a commit's hash is a hash of its own content, so no
    committed file can contain its own commit hash. It is a fixed point that does
    not exist.

    The timestamp alone does this value's actual job - the page compares it with
    version.txt to notice it is stale - and it is never wrong. To map a build back
    to code, print every commit's date in this same format and read off the match:

        TZ=UTC git log --format='%h %cd %s' --date=format-local:%Y%m%d-%H%M

        $env:TZ='UTC'; git log --format='%h %cd %s' --date=format-local:%Y%m%d-%H%M
                                                           (the same, in PowerShell)

    TZ=UTC is load-bearing. A build id is UTC and git prints LOCAL time unless told
    otherwise, so without it the recipe reports times hours from the string in your
    hand and you go looking in the wrong evening.
    """
    return time.strftime("%Y%m%d-%H%M", time.gmtime())


def main():
    bid = build_id()
    s = io.open(SRC, encoding="utf-8").read()
    new, n = re.subn(r'const BUILD="[^"]*";', 'const BUILD="%s";' % bid, s, count=1)
    if n != 1:
        raise SystemExit('could not find `const BUILD="...";` in index.html - '
                         "the update check may have been renamed or removed")
    io.open(SRC, "w", encoding="utf-8", newline="").write(new)
    io.open(VER, "w", encoding="utf-8", newline="").write(bid + "\n")
    print("stamped build %s" % bid)
    print("  index.html  -> const BUILD")
    print("  version.txt -> %s" % bid)


if __name__ == "__main__":
    main()
