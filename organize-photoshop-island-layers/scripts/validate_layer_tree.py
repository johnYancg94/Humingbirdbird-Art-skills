#!/usr/bin/env python3
"""Compatibility CLI; delegates to the same validator used before Photoshop saves."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

node = shutil.which("node")
if not node:
    import json
    dependency = json.loads((Path(__file__).parent.parent / "dependencies.json").read_text(encoding="utf-8"))["dependencies"][0]
    bundled = Path(os.environ.get("LOCALAPPDATA", "")) / "Humingbirdbird/PhotoshopCodexBridge" / dependency["version"] / "runtime/node.exe"
    if bundled.is_file():
        node = str(bundled)
if not node:
    sys.exit("Node.js is required; install the skill bridge dependency first")
sys.exit(subprocess.call([node, str(Path(__file__).with_name("layer-validation.mjs")), *sys.argv[1:]]))
