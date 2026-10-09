#!/usr/bin/env python3
"""
changelog-prepend.py — safely prepend a version section to CHANGELOG.md.

Idempotent: if a section for the target version already exists, it is
merged into (existing body + new body appended at the end of the existing
section) rather than duplicated. Eliminates the "duplicate header" bug
class entirely.

Usage:
    ./scripts/changelog-prepend.py <version> < body.md

    version: e.g. 1.0.0-r10 or 1.0.0
    stdin:   markdown body WITHOUT the "## [...]" header line

Exit codes:
    0 - written (new section or merge)
    1 - invalid input
    2 - file missing

The script is safe: writes .bak-<timestamp> before touching CHANGELOG.md.
"""
import sys, shutil, re, pathlib, datetime

def main():
    if len(sys.argv) != 2:
        print("usage: changelog-prepend.py <version>  <body on stdin>", file=sys.stderr)
        return 1
    version = sys.argv[1].strip()
    if not re.match(r'^\d+\.\d+\.\d+(?:-r\d+(?:\.\d+)?)?$', version):
        print(f"invalid version: {version}", file=sys.stderr)
        return 1

    body = sys.stdin.read().rstrip() + "\n"
    if not body.strip():
        print("empty body", file=sys.stderr)
        return 1

    chg = pathlib.Path(__file__).resolve().parent.parent / "CHANGELOG.md"
    if not chg.exists():
        print(f"missing: {chg}", file=sys.stderr)
        return 2

    text = chg.read_text()
    header_re = re.compile(r'^## \[([^\]]+)\] \u2014 (\d{4}-\d{2}-\d{2})$', re.M)

    # Find all version headers with their positions
    matches = list(header_re.finditer(text))
    target_idx = None
    for i, m in enumerate(matches):
        if m.group(1) == version:
            target_idx = i
            break

    if target_idx is not None:
        # Section exists: append body to end of that section (before next header)
        start = matches[target_idx].start()
        end = matches[target_idx + 1].start() if target_idx + 1 < len(matches) else len(text)
        existing_section = text[start:end].rstrip()
        merged = existing_section + "\n\n" + body + "\n"
        new_text = text[:start] + merged + text[end:]
        action = "merged"
    else:
        # No section: insert a fresh one above the first (highest) version
        today = datetime.date.today().isoformat()
        header = f"## [{version}] \u2014 {today}\n\n"
        insert_at = matches[0].start() if matches else len(text)
        new_text = text[:insert_at] + header + body + "\n" + text[insert_at:]
        action = "inserted"

    # Backup before writing
    bak = pathlib.Path(str(chg) + f".bak-{datetime.datetime.now().strftime('%Y%m%d%H%M%S')}")
    shutil.copy2(chg, bak)
    chg.write_text(new_text)

    print(f"[{action}] version {version} in {chg}")
    print(f"[backup] {bak}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
