# Fast Island Organizer

Use `scripts/organize_island_fast.mjs` as the default path when the PSD follows the regular five-region source pattern.

## Preconditions

Confirm from a fresh full snapshot that:

- The active document title matches the intended PSD/PSB.
- Root groups are `背景前层` and `区域一` through `区域五`.
- Each region contains only mapped building groups.
- Building children use only `修复后`, `破损`, `修复后前层`, and `破损前层`.
- Every root non-group layer is an approved component of the single final background.
- The source-name mapping is complete and unambiguous.

Do not use fast mode if any condition is uncertain. Use the guarded fallback workflow instead.

## Configuration

Create a temporary UTF-8 JSON file. Use lowercase ASCII tokens and explicitly confirm the background audit:

```json
{
  "slug": "buggieisland",
  "documentTitle": "虫虫岛切图.psd",
  "allowMergeAllRootBackgroundLayers": true,
  "regions": [
    {
      "name": "区域一",
      "color": "red",
      "buildings": [
        { "source": "码头", "token": "dock" }
      ]
    },
    {
      "name": "区域二",
      "color": "orange",
      "buildings": []
    },
    {
      "name": "区域三",
      "color": "yellowColor",
      "buildings": []
    },
    {
      "name": "区域四",
      "color": "green",
      "buildings": []
    },
    {
      "name": "区域五",
      "color": "blue",
      "buildings": []
    }
  ]
}
```

All five regions must be present. In real delivery configs, list every building in its actual region.

## Run

From the installed Skill directory:

```powershell
node scripts/organize_island_fast.mjs --config "<absolute-config-path>"
```

The script performs:

1. Initial full snapshot and document guard.
2. One setup batch: rename surface foregrounds, create required root groups, and collect root background layers.
3. One refreshed full snapshot.
4. One main batch: merge and name every state, move final layers, remove obsolete groups, nest and color five regions, sort roots, and save.
5. One final full snapshot and delivery validation.

This is two Photoshop commands and three full snapshots. A 217-layer, 20-building Photoshop 2026 test completed in 175.4 seconds; treat that as evidence, not a universal guarantee.

## Failure Handling

- Stop on the first failed command. Do not continue from partially mutated IDs.
- If setup succeeded but the main batch failed, request a fresh snapshot before recovery.
- Never rerun setup against a partially organized PSD; reopen the saved source or use a refreshed manual recovery plan.
- If Photoshop was edited manually, discard every cached ID and rebuild from a fresh full snapshot.
- `colorLabels: unavailable-cep` is an observability note when `setLayerColor` results succeeded.