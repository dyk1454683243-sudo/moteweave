# Studio Topbar Convention

**Date:** 2026-08-14
**Status:** Active
**Applies to:** Every maintained Studio route topbar in `src/ui/studio/`

## Rule

The Studio topbar does **not** show a breadcrumb / crumb.

Do not add, restore, or invent a `· 本地导入`, `· 严格审阅`, `· 本地打包`, or
any other `· …` trail after the page title. Route, mode, and phase already have
their own controls:

| Truth | Where it lives |
|---|---|
| Which product page | Left rail + page title (`角色工作室`, `动作取帧`, …) |
| Which mode inside the page | Workspace tabs (`本地导入` / `AI 生成`) |
| Current Job / phase | Status badge (`role="status"`, `aria-live="polite"`) |
| What the user can do next | Primary header action or left-column CTA |

A later operation guide may teach first-run flow. It is not a crumb, and it
must not be added as one.

## Spacing

Every Studio topbar uses the same left-to-right rhythm. Do not leave a crumb
hole, and do not park the first mode control against the title.

| Token | Value | Use |
|---|---|---|
| `--topbar-pad-x` | 16px | Header left and right padding |
| `--topbar-title-slot` | 92px | Fixed title column. Same on every route so the first control does not move |
| `--topbar-title-gap` | 24px | Distance from the title column to the first left control |
| `--topbar-control-gap` | 8px | Distance between sibling left controls, then again between right-cluster controls |

Order:

`[pad] [92px title] [24px] [first control] [8px] [next control] … [flex spacer] [status / export / language] [pad]`

The first left control always starts at `16 + 92 + 24 = 132px`. Do not hug the
title width; a shorter name such as `设置` must not pull the mode buttons left.
Title type is Inter Semi Bold 14 / 18 on every route. A longer English title,
including `Frame Extraction`, ellipsizes inside the 92px slot rather than
shifting controls.
Sequence and Tiles follow this flex rhythm; they must not keep the old
absolute `left: 356px` mode slot.

## Implementation

- Keep existing crumb nodes, IDs, i18n keys, and JS writers. They may still
  feed tests or a future non-visual consumer.
- Hide every `.crumb` with `display: none`. Do not leave a reserved gap.
- Do not give a hidden crumb the only `aria-live` for a phase. The visible
  status badge remains the polite live region.
- Figma Current topbars follow the same rule: hide `Header/CrumbSlot` and any
  `· …` title suffix, including text nodes whose name is the crumb copy itself
  (for example `· 本地导入`). Do not draw a new crumb on a Current frame.
  Keep the title column at 92px and 14px Semi Bold. Place the first mode
  cluster 24px after that column, then 8px between sibling mode controls.
  Archive / history frames keep their crumbs as evidence only.

## Out of scope

- Status badges, workspace tabs, export buttons, and language switches stay.
- Map (`#tiles`) is the visible workspace for terrain and map editing. Scene’s
  prompt-helper entry remains hidden inventory on the retired Scene view; Map
  does not show an independent prompt-helper button. Character is the explicit
  exception: the 2026-08-28 human browser review retired the Character topbar
  entry, drawer, and Scene-to-Character helper handoff because prompt authoring
  already lives in the AI source form. Do not restore a hidden query or
  secondary route to that retired Character helper.
- Editor Workspace has its own header contract and is not covered here.
