# Unit State Display: 3-State Styling

**Date:** 2026-05-22  
**Branch:** AAR-feature  
**File:** `ui/src/pages/recording-playback/components/UnitsTab.tsx`

## Problem

The Units tab previously used a binary alive/not-alive model. A prior commit changed the "no snapshot" case from alive-styled to dead-styled so that despawned units would no longer appear active. This introduced the opposite problem: in missions with frequent despawns (e.g. Antistasi), it is impossible to distinguish units that died in combat from units that simply despawned or haven't spawned yet.

## Three Conceptual States

| State | Meaning | Condition |
|---|---|---|
| **Alive** | Present in the game engine and living | Snapshot exists AND `alive ∈ {1, 2}` |
| **Dead** | Was killed by a kill event at or before the current frame | `killDeathCounts().deaths > 0` (regardless of snapshot) |
| **Inactive** | Once existed (or hasn't spawned yet) but never killed | No snapshot AND `deaths === 0` at current frame |

The `alive` check is evaluated first, so a respawned player (deaths > 0 but currently alive) correctly shows as **Alive**.

## Status Derivation Logic

Replace `isAlive(unitId): boolean` with `getUnitStatus(unitId): UnitStatus`:

```typescript
type UnitStatus = 'alive' | 'dead' | 'inactive';

const getUnitStatus = (unitId: number): UnitStatus => {
  const snap = engine.entitySnapshots().get(unitId);
  if (snap && snap.alive) return 'alive';
  if ((killDeathCounts().deaths.get(unitId) ?? 0) > 0) return 'dead';
  return 'inactive';
};
```

`killDeathCounts` is already a frame-aware `createMemo` in the component — no new reactive dependencies are introduced. Scrubbing to a frame before a kill event correctly shows the unit as alive or inactive.

## Visual Design

| State | Row class | Name color |
|---|---|---|
| `alive` | _(none)_ | `--text-secondary` (#cfd9e4) — unchanged |
| `dead` | `unitRowDead` (new) — low-opacity warning tint | `unitNameDead` (new) — `--accent-warning` (#FFB84A) |
| `inactive` | `unitRowInactive` (renamed from `unitRowDead`) — `opacity: 0.45` | `unitNameInactive` (renamed from `unitNameDead`) — `--text-dimmer` (#5b6f82) |

The orange/yellow `--accent-warning` color is already used for hit events in the Events tab, providing visual consistency across the UI.

## Scope

- **Changed:** `UnitsTab.tsx` — replace `isAlive` with `getUnitStatus`, update `classList` bindings
- **Changed:** `SidePanel.module.css` — rename `unitRowDead`/`unitNameDead` to `unitRowInactive`/`unitNameInactive`, add new `unitRowDead`/`unitNameDead` for killed state
- **Unchanged:** Group header `alive/total` count format
- **Unchanged:** `killDeathCounts` memo, `aliveCount` function, all other components
