# Vehicle Initial-Side Suppression Window

**Date:** 2026-05-21
**Branch:** PlaybackDataEnhancements

## Problem

Vehicles spawned from the garage (and possibly other game logic) start with Arma 3's `sideEmpty` side for at least one frame before crew boards. Both decoders map unrecognized side strings to `"CIV"` as a default, so these vehicles get `staticSide = "CIV"`. When the first crew member boards — even seconds after spawn — `processVehicleOwnership` fires a `CIV → WEST/EAST/GUER` capture event, inflating capture counts in the AAR equipment summary.

Civilian vehicle captures are legitimate (e.g., a civ truck stolen by OPFOR), so we cannot suppress all CIV→side transitions globally. The root-cause fix (proximity-based side inference) is deferred; this is a targeted workaround.

## Solution

Add a 60-second suppression window to the first-crew-boarding path in `processVehicleOwnership`. If the first live crew boards within 60 seconds of the vehicle's `startFrame`, treat the side change as the vehicle's initial side assignment rather than a capture. Subsequent side changes (crew already established, then a new side takes over) are unaffected.

60 seconds is chosen because legitimate captures rarely occur within seconds of a vehicle spawning, and the trade-off of missing an early capture is acceptable.

## Design

### Constant

```typescript
const INITIAL_SIDE_WINDOW_MS = 60_000;
```

Defined at module level in `eventManager.ts`.

### Signature change

```typescript
// before
processVehicleOwnership(entityManager: EntityManager): void

// after
processVehicleOwnership(entityManager: EntityManager, captureDelayMs: number): void
```

### Logic change (eventManager.ts, `currentOwnerGroupKey === null` branch)

```typescript
const msFromSpawn = (absoluteFrame - vehicle.startFrame) * captureDelayMs;
const outsideInitialWindow = msFromSpawn >= INITIAL_SIDE_WINDOW_MS;

if (currentSide !== null && newSide !== currentSide && outsideInitialWindow) {
  this.vehicleCaptureEvents.push({ ... });
}
// side and owner group are always set regardless of whether capture fires
currentSide = newSide;
currentOwnerGroupKey = newGroupKey;
changes.push({ ... });
```

The `else if (newSide !== currentSide)` branch (subsequent side changes) is **not modified** — captures after initial boarding are always recorded.

### Call site (engine.ts)

```typescript
// before
this.eventManager.processVehicleOwnership(this.entityManager);

// after
this.eventManager.processVehicleOwnership(this.entityManager, this._captureDelayMs());
```

## Files

| File | Change |
|------|--------|
| `ui/src/playback/eventManager.ts` | Add constant, add parameter, update `currentOwnerGroupKey === null` guard |
| `ui/src/playback/engine.ts` | Pass `captureDelayMs` at call site |
| `ui/src/playback/__tests__/eventManager.test.ts` | Test within-window suppression and outside-window capture |

## Test Cases

- Vehicle spawns, BLUFOR boards at frame 10 (captureDelayMs=1000 → 10s): no capture fired, side set to WEST.
- Vehicle spawns, OPFOR boards at frame 10 (10s): no capture fired, side set to EAST.
- Vehicle spawns, BLUFOR boards at frame 61 (61s): capture fired (CIV → WEST).
- Vehicle spawns at frame 200, OPFOR boards at frame 210 (10s from startFrame): no capture fired.
- Vehicle has BLUFOR crew from frame 5, OPFOR takes it at frame 300: capture still fires (subsequent change, not initial).

## Out of Scope

- Fixing the decoder default (`"EMPTY"` → `null` instead of `"CIV"`) — deferred alongside proximity-based inference.
- Streaming/chunk-format support for ownership scanning — already deferred in TODO_AAR.md.
