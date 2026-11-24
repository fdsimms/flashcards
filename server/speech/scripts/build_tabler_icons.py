"""Builds franki_speech/tabler_icons.json from the @tabler/icons npm package (MIT).

    npm pack @tabler/icons && tar xzf tabler-icons-*.tgz
    python scripts/build_tabler_icons.py package

Each outline icon becomes `name -> "d|d|..."`, the same shape an Icon field holds (a 24 by 24 box
of SVG path data, src/core/noteIcon.ts). An icon the app would refuse is left out: more than 8
paths or 1,200 characters, or a path that isn't plain path data. So are the `-off` variants (the
same picture crossed out), which are never the thing itself. Output is sorted and compact so a
regeneration diffs cleanly.
"""

import json
import re
import sys
from pathlib import Path

MAX_PATHS = 8
MAX_LENGTH = 1200
PATH = re.compile(r"^[Mm][MmLlHhVvCcSsQqTtAaZz0-9\s,.+\-eE]*$")


def main(package: Path) -> None:
    nodes = json.loads((package / "tabler-nodes-outline.json").read_text())
    icons: dict[str, str] = {}
    for name, parts in sorted(nodes.items()):
        if name.endswith("-off"):
            continue
        if not parts or any(tag != "path" for tag, _ in parts):
            continue
        paths = [attrs["d"].strip() for _, attrs in parts]
        value = "|".join(paths)
        if (
            len(paths) > MAX_PATHS
            or len(value) > MAX_LENGTH
            or not all(PATH.match(p) for p in paths)
        ):
            continue
        icons[name] = value
    out = Path(__file__).resolve().parent.parent / "franki_speech" / "tabler_icons.json"
    out.write_text(json.dumps(icons, separators=(",", ":"), ensure_ascii=True) + "\n")
    print(f"{len(icons)} of {len(nodes)} icons kept -> {out}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
