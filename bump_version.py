#!/usr/bin/env python3
"""Move this app's version, in the one place it is written.

`VERSION` at the repo root is the single source of truth. Everything else derives
from it:

  * the backend  -- app.py reads VERSION at import (APP_VERSION, GET /api/version)
  * the frontend -- vite.config.js reads VERSION -> import.meta.env.VITE_APP_VERSION
  * packaging    -- the share-project skill reads VERSION for the zip filename
  * package.json -- a DERIVED copy, rewritten here; vite.config fails the build
                    if it ever drifts, so a stale copy cannot be shipped

Only `frontend/package.json` needs writing, because it is the one consumer that
cannot read a file at the moment it is needed. Everything else reads VERSION
live, which is the whole point: adding a new place that stores the version is a
mistake, adding one that reads it is free.

Usage
-----
    python3 bump_version.py patch          # x.y.Z+1  bug fixes only
    python3 bump_version.py minor          # x.Y+1.0  new features, nothing breaks
    python3 bump_version.py major          # X+1.0.0  existing behavior changes
    python3 bump_version.py 0.4.2          # set an exact version
    python3 bump_version.py --sync         # rewrite derived copies, don't bump
    python3 bump_version.py --show         # print the current version and exit

The number is a promise about compatibility, not a measure of effort. Pick the
level from what a user of the app would notice, not from how much code moved.
"""

import argparse
import datetime
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
VERSION_FILE = os.path.join(ROOT, "VERSION")
PACKAGE_JSON = os.path.join(ROOT, "frontend", "package.json")
CHANGELOG = os.path.join(ROOT, "CHANGELOG.md")

SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def read_version():
    with open(VERSION_FILE, encoding="utf-8") as f:
        raw = f.read().strip()
    if not SEMVER_RE.match(raw):
        sys.exit(f"VERSION holds {raw!r}, which is not MAJOR.MINOR.PATCH")
    return raw


def bumped(current, level):
    major, minor, patch = (int(n) for n in current.split("."))
    if level == "major":
        return f"{major + 1}.0.0"
    if level == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def write_version(new):
    # Trailing newline: this file is read by `cat` in shell (the share skill) as
    # well as by Python and Node, and a newline-terminated line is what every
    # one of them expects. All three readers .strip() anyway.
    with open(VERSION_FILE, "w", encoding="utf-8") as f:
        f.write(new + "\n")


def sync_package_json(new):
    """Rewrite package.json's version by regex, not by json.dump.

    Round-tripping through json would reformat a file nobody asked to reformat --
    and this script runs on a repo whose diffs are reviewed by hand. A single
    anchored substitution keeps the diff to one line. The count assertion is the
    safety net: if the field ever moves or is renamed, this fails loudly instead
    of silently leaving the copy stale for vite.config to trip over later.
    """
    with open(PACKAGE_JSON, encoding="utf-8") as f:
        text = f.read()
    new_text, n = re.subn(
        r'("version"\s*:\s*")[^"]*(")',
        lambda m: m.group(1) + new + m.group(2),
        text,
        count=1,
    )
    if n != 1:
        sys.exit(f"could not find a \"version\" field to update in {PACKAGE_JSON}")
    if new_text == text:
        return False
    with open(PACKAGE_JSON, "w", encoding="utf-8") as f:
        f.write(new_text)
    return True


def package_json_version():
    with open(PACKAGE_JSON, encoding="utf-8") as f:
        return json.load(f).get("version")


def add_changelog_stub(new):
    """Insert an empty section for `new` above the newest existing one.

    A stub rather than nothing, because an unwritten changelog entry is the way
    this convention dies: an empty '### Added' under today's date is a visible
    hole, while a missing section is invisible. Returns False if the section is
    already there, so re-running is harmless.
    """
    if not os.path.exists(CHANGELOG):
        return False
    with open(CHANGELOG, encoding="utf-8") as f:
        text = f.read()
    heading = f"## {new} — "
    if heading in text:
        return False
    today = datetime.date.today().isoformat()
    section = (
        f"## {new} — {today}\n\n"
        "_Describe the change in plain language — what someone would notice, not "
        "which files moved._\n\n"
    )
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        if line.startswith("## "):
            lines.insert(i, section)
            break
    else:
        lines.append("\n" + section)
    with open(CHANGELOG, "w", encoding="utf-8") as f:
        f.write("".join(lines))
    return True


def main():
    p = argparse.ArgumentParser(
        description="Bump the app version in VERSION and everything derived from it.",
        epilog="Commit the bump WITH the change it ships, then tag: git tag -a v<version> -m '<version>'",
    )
    p.add_argument(
        "level",
        nargs="?",
        help="patch | minor | major | an exact MAJOR.MINOR.PATCH version",
    )
    p.add_argument("--sync", action="store_true",
                   help="rewrite derived copies from VERSION without bumping")
    p.add_argument("--show", action="store_true",
                   help="print the current version and exit")
    args = p.parse_args()

    current = read_version()

    if args.show:
        print(current)
        return

    if args.sync:
        if args.level:
            p.error("--sync takes no level argument")
        changed = sync_package_json(current)
        print(f"VERSION {current} (canonical)")
        print(f"  frontend/package.json  {'updated' if changed else 'already in step'} -> {current}")
        return

    if not args.level:
        p.error("give a level (patch/minor/major), an exact version, --sync, or --show")

    if args.level in ("patch", "minor", "major"):
        new = bumped(current, args.level)
    elif SEMVER_RE.match(args.level):
        new = args.level
    else:
        p.error(f"{args.level!r} is neither patch/minor/major nor a MAJOR.MINOR.PATCH version")

    if new == current:
        sys.exit(f"already at {current}")
    # Refuse to go backwards by accident. A downgrade is occasionally right (an
    # aborted release), so it is allowed -- but only by naming the exact version,
    # never as the silent result of a patch/minor/major word.
    if tuple(int(n) for n in new.split(".")) < tuple(int(n) for n in current.split(".")) \
            and args.level in ("patch", "minor", "major"):
        sys.exit(f"refusing to move {current} -> {new}")

    write_version(new)
    synced = sync_package_json(new)
    stubbed = add_changelog_stub(new)

    print(f"VERSION  {current} -> {new}")
    print(f"  frontend/package.json  {'updated' if synced else 'already in step'} -> {package_json_version()}")
    print(f"  CHANGELOG.md           {'stub section added' if stubbed else 'section already present'}")
    print("  app.py / vite.config.js  read VERSION live — nothing to edit")
    print()
    print("Next:")
    print(f"  1. Write the CHANGELOG entry for {new} (plain language, newest at top).")
    print("  2. Rebuild the frontend so the bundle carries the new number:")
    print("       cd frontend && npx vite build")
    print("  3. Commit the bump IN THE SAME COMMIT as the change it ships.")
    print(f"  4. git tag -a v{new} -m '{new}'   (or: git tag -a \"v$(cat VERSION)\" -m \"$(cat VERSION)\")")


if __name__ == "__main__":
    main()
