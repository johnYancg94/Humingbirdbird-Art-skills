# Island PSD Layer Standard

## Target Tree

Keep these five groups at the document root:

```text
地表前层
破损前层
完整前层
建筑
  区域一
  区域二
  区域三
  区域四
  区域五
背景
```

Photoshop displays the last root item at the bottom of the Layers panel. Preserve the project's intended stacking order while keeping all five groups at root level.

## Naming

Use lowercase ASCII asset tokens with no spaces or punctuation.

| Asset | Pattern |
| --- | --- |
| Full island background | `island_<island>_bg` |
| Background foreground | `island_<island>_bg_frontNN` |
| Restored building | `island_<island>_<asset>` |
| Ruined building | `island_<island>_<asset>_ruin` |
| Restored building foreground | `island_<island>_<asset>_frontNN` |
| Ruined building foreground | `island_<island>_<asset>_ruin_frontNN` |

Start `NN` at `01` per asset and foreground category. Use two digits.

Do not infer an English asset token when the user supplied an approved naming table. For example, preserve an approved `vegetablemarket` token even if another translation seems stylistically preferable.

## Foreground Meaning

- `地表前层` contains foreground pieces belonging to the island background.
- `完整前层` contains foreground pieces used with restored buildings.
- `破损前层` contains foreground pieces used with ruined buildings.
- Create all three groups. An absent category is represented by an empty group.

## Building States

For each building:

- Merge the restored artwork group into one final restored pixel layer.
- Merge the ruined artwork group into one final ruined pixel layer.
- Keep restored and ruined layers as siblings in the assigned region.
- Do not retain a per-building subgroup below a region.
- If a source state does not exist, do not fabricate artwork or a placeholder pixel layer.

## Regions And Color Labels

`建筑` contains exactly these five groups:

| Group | Photoshop color label |
| --- | --- |
| `区域一` | `red` |
| `区域二` | `orange` |
| `区域三` | `yellowColor` |
| `区域四` | `green` |
| `区域五` | `blue` |

The region assignment is spatial/project data. Preserve the source assignment or use a user-provided assignment; never assign a building from its name alone.

## Rasterization

Every delivered building, background, and foreground asset must be a pixel layer. Rasterize all Smart Objects after final naming and placement so:

- The layer name remains unchanged.
- The parent group remains unchanged.
- The visual result and stacking order remain unchanged.
- The final snapshot contains zero layers whose kind is `smartObject`.

Adjustment, text, shape, or other non-pixel layers inside source artwork must be resolved by the state merge. Do not rasterize groups before their internal stacking and visibility have been checked.
