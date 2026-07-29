#!/usr/bin/env python3
"""Validate an exported Photoshop Codex Bridge layer-tree snapshot."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT_NAMES = ["地表前层", "破损前层", "完整前层", "建筑", "背景"]
REGION_COLORS = {
    "区域一": "red",
    "区域二": "orange",
    "区域三": "yellowColor",
    "区域四": "green",
    "区域五": "blue",
}


def children(layer: dict[str, Any]) -> list[dict[str, Any]]:
    value = layer.get("children", layer.get("layers", []))
    return value if isinstance(value, list) else []


def is_group(layer: dict[str, Any]) -> bool:
    return bool(layer.get("isGroup")) or bool(children(layer))


def flatten(layers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for layer in layers:
        result.append(layer)
        result.extend(flatten(children(layer)))
    return result


def snapshot_layers(payload: dict[str, Any]) -> list[dict[str, Any]]:
    snapshot = payload.get("snapshot", payload)
    layers = snapshot.get("layers", []) if isinstance(snapshot, dict) else []
    return layers if isinstance(layers, list) else []


def layer_color(layer: dict[str, Any]) -> str | None:
    value = layer.get("color")
    if isinstance(value, dict):
        return value.get("_value") or value.get("value")
    if isinstance(value, str):
        return value
    descriptor = layer.get("descriptor")
    if isinstance(descriptor, dict):
        raw = descriptor.get("color")
        if isinstance(raw, dict):
            return raw.get("_value") or raw.get("value")
        if isinstance(raw, str):
            return raw
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("layer_tree", type=Path)
    parser.add_argument("--island", required=True, help="Lowercase island slug")
    args = parser.parse_args()

    payload = json.loads(args.layer_tree.read_text(encoding="utf-8-sig"))
    roots = snapshot_layers(payload)
    errors: list[str] = []
    warnings: list[str] = []

    if not re.fullmatch(r"[a-z0-9]+", args.island):
        errors.append("island slug must contain lowercase ASCII letters and digits only")

    root_by_name = {layer.get("name"): layer for layer in roots}
    for name in ROOT_NAMES:
        layer = root_by_name.get(name)
        if layer is None:
            errors.append(f"missing root group: {name}")
        elif not is_group(layer):
            errors.append(f"root item is not a group: {name}")

    unexpected = [
        str(layer.get("name"))
        for layer in roots
        if layer.get("name") not in ROOT_NAMES
    ]
    if unexpected:
        warnings.append("unexpected root items: " + ", ".join(unexpected))

    building = root_by_name.get("建筑")
    if building:
        region_layers = children(building)
        region_by_name = {layer.get("name"): layer for layer in region_layers}
        direct_assets = [layer for layer in region_layers if not is_group(layer)]
        if direct_assets:
            errors.append("建筑 contains direct asset layers")
        for name, expected_color in REGION_COLORS.items():
            region = region_by_name.get(name)
            if region is None:
                errors.append(f"missing region group: {name}")
                continue
            if not is_group(region):
                errors.append(f"region item is not a group: {name}")
                continue
            nested = [layer for layer in children(region) if is_group(layer)]
            if nested:
                errors.append(f"{name} contains nested groups")
            actual_color = layer_color(region)
            if actual_color is None:
                warnings.append(f"{name} color label could not be read")
            elif actual_color != expected_color:
                errors.append(
                    f"{name} color is {actual_color!r}; expected {expected_color!r}"
                )
        extras = [
            str(layer.get("name"))
            for layer in region_layers
            if layer.get("name") not in REGION_COLORS
        ]
        if extras:
            errors.append("建筑 contains unexpected items: " + ", ".join(extras))

    all_layers = flatten(roots)
    smart_objects = [
        str(layer.get("name"))
        for layer in all_layers
        if str(layer.get("kind", "")).lower() == "smartobject"
    ]
    if smart_objects:
        errors.append("Smart Objects remain: " + ", ".join(smart_objects))

    prefix = re.escape(f"island_{args.island}_")
    patterns = {
        "背景": re.compile(rf"^{prefix}bg$"),
        "地表前层": re.compile(rf"^{prefix}bg_front\d{{2}}$"),
        "完整前层": re.compile(rf"^{prefix}[a-z0-9]+_front\d{{2}}$"),
        "破损前层": re.compile(rf"^{prefix}[a-z0-9]+_ruin_front\d{{2}}$"),
    }
    for group_name, pattern in patterns.items():
        group = root_by_name.get(group_name)
        if not group:
            continue
        for layer in children(group):
            if is_group(layer):
                errors.append(f"{group_name} contains nested group: {layer.get('name')}")
            elif not pattern.fullmatch(str(layer.get("name", ""))):
                errors.append(f"invalid name in {group_name}: {layer.get('name')}")

    if building:
        building_pattern = re.compile(
            rf"^{prefix}[a-z0-9]+(?:_ruin)?$"
        )
        for region in children(building):
            if not is_group(region):
                continue
            for layer in children(region):
                if not is_group(layer) and not building_pattern.fullmatch(
                    str(layer.get("name", ""))
                ):
                    errors.append(
                        f"invalid building name in {region.get('name')}: {layer.get('name')}"
                    )

    print(f"layers: {len(all_layers)}")
    print(f"smartObjects: {len(smart_objects)}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        print(f"FAILED: {len(errors)} error(s), {len(warnings)} warning(s)")
        return 1
    print(f"PASSED: 0 errors, {len(warnings)} warning(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
