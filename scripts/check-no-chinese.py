#!/usr/bin/env python3
"""Refuse les caractères chinois dans les fichiers texte versionnés."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path


HAN = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")


def tracked_files() -> list[Path]:
    output = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"]
    )
    return [Path(item.decode()) for item in output.split(b"\0") if item]


def main() -> int:
    failures: list[str] = []
    for path in tracked_files():
        try:
            content = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for line_number, line in enumerate(content.splitlines(), start=1):
            if HAN.search(line):
                failures.append(f"{path}:{line_number}")

    if failures:
        print("Contenu chinois détecté dans les fichiers suivants :")
        print("\n".join(failures))
        return 1

    print("Aucun contenu chinois détecté.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
