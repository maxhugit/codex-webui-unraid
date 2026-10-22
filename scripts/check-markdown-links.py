#!/usr/bin/env python3
"""Fail when a relative link in a repository Markdown file targets no file."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[1]
IGNORED_PARTS = {".git", "node_modules"}
INLINE_LINK = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
REFERENCE_LINK = re.compile(r"^\s*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)


def markdown_files() -> list[Path]:
    return sorted(
        path
        for path in ROOT.rglob("*.md")
        if not IGNORED_PARTS.intersection(path.relative_to(ROOT).parts)
    )


def target_path(raw_target: str, source: Path) -> Path | None:
    target = raw_target.strip()
    if target.startswith("<") and ">" in target:
        target = target[1 : target.index(">")]
    else:
        target = target.split(maxsplit=1)[0]

    target = unquote(target.split("#", maxsplit=1)[0])
    if not target or target.startswith(("/", "//")) or ":" in target.split("/", 1)[0]:
        return None

    return (source.parent / target).resolve()


def main() -> int:
    broken: list[str] = []
    files = markdown_files()

    for source in files:
        content = source.read_text(encoding="utf-8")
        targets = INLINE_LINK.findall(content) + REFERENCE_LINK.findall(content)
        for raw_target in targets:
            resolved = target_path(raw_target, source)
            if resolved is not None and not resolved.exists():
                broken.append(
                    f"{source.relative_to(ROOT)}: {raw_target} -> "
                    f"{resolved.relative_to(ROOT) if resolved.is_relative_to(ROOT) else resolved}"
                )

    if broken:
        print("Broken relative Markdown links:", file=sys.stderr)
        print("\n".join(f"- {item}" for item in broken), file=sys.stderr)
        return 1

    print(f"Checked {len(files)} Markdown files: no broken relative links.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
