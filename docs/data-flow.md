# OCAP2-Web Data Flow

This document describes how mission data flows through the system — from the raw recording files on disk, through the Go backend, to the TypeScript playback engine and UI components. It also highlights data that exists in the system but is not currently visualized or analyzed, which is relevant for anyone building new features.

---

## Table of Contents

1. [Big Picture](#big-picture)
2. [Where Data Lives](#where-data-lives)
3. [The Two Loading Paths](#the-two-loading-paths)
4. [Data Available at Each Layer](#data-available-at-each-layer)
5. [Frontend: What Each Component Uses](#frontend-what-each-component-uses)
6. [Unused Data with Analysis Potential](#unused-data-with-analysis-potential)
7. [Key File Reference](#key-file-reference)

---

## Big Picture

A mission recording passes through four major stages:

```
Arma 3 Extension
      │
      │  JSON.gz upload  (POST /api/v1/operations/add)
      ▼
  Go Backend
  ┌─────────────────────────────────────────────────────────┐
  │  SQLite DB            │  Protobuf files on disk         │
  │  (mission metadata)   │  (manifest.pb + chunks/*.pb)    │
  │                       │                                 │
  │  Aggregated stats:    │  Full recording data:           │
  │  · player count       │  · all entity definitions       │
  │  · kill count         │  · all events (all types)       │
  │  · side composition   │  · per-frame entity state       │
  │    (kills/deaths only)│  · markers, time samples        │
  └─────────────────────────────────────────────────────────┘
      │                         │
      │  GET /api/v1/operations  │  GET /data/{filename}/manifest.pb
      │  (recording list/detail) │  GET /data/{filename}/chunks/NNNN.pb
      ▼                         ▼
  TypeScript Frontend
  ┌─────────────────────────────────────────────────────────┐
  │  Recording Selector           Playback Engine           │
  │  (uses API stats only)        (uses manifest + chunks)  │
  │                                                         │
  │  DetailSidebar shows:         Engine provides:          │
  │  · basic metadata             · per-frame snapshots     │
  │  · side composition           · event aggregations      │
  │  · player/kill counts         · counter/ticket state    │
  └─────────────────────────────────────────────────────────┘
```

---

## Where Data Lives

### SQLite Database (`data.db`)

Stores one row per mission. This is what the recording selector displays.

| Column | Description | Source |
|--------|-------------|--------|
| `id` | Unique mission ID | Auto |
| `world_name`, `mission_name` | Map and mission name | From upload |
| `mission_duration` | Total seconds | Computed at conversion |
| `date`, `tag` | Date and label | From upload |
| `player_count` | Unique human players | Computed at conversion |
| `kill_count` | Total kills | Computed at conversion (killed events only) |
| `player_kill_count` | Kills by human players | Computed at conversion |
| `side_composition` | JSON: per-side units/players/dead/kills | Computed at conversion |
| `chunk_count`, `schema_version` | File format metadata | Computed at conversion |
| `storage_format` | `"json"` or `"protobuf"` | Set at conversion |
| `conversion_status` | `"pending"`, `"converting"`, `"completed"`, `"failed"` | Set at conversion |
| `focus_start`, `focus_end` | Optional frame range for editing | User-set |

**Important limitation:** Only `killed` events are aggregated here. Hit events, capture events, and all other event types are not reflected in any SQLite column.

### Protobuf Files (Manifest + Chunks)

These files contain the full recording. They are only accessed when a recording is opened for playback.

**`manifest.pb`** — loaded once when playback begins (~10–200 KB):
- All entity definitions (name, side, group, role, type, lifespan)
- All mission events (every type — kills, hits, captures, connections, etc.)
- Projectile fire data per entity (`framesFired`)
- All map markers with temporal positions
- Frame-to-real-time mapping (`times[]`)
- Mission metadata (world, capture delay, end frame)

**`chunks/NNNN.pb`** — streamed on demand as playback progresses (~50–500 KB each, ~300 frames per chunk):
- Per-frame state for every active entity:
  - Position (X, Y, Z)
  - Direction (heading, 0–359°)
  - Alive state (alive / unconscious / dead)
  - Crew IDs (vehicles), vehicle ID (units)
  - Per-frame name, side, group overrides

---

## The Two Loading Paths

### Protobuf (streaming) — current default

```
User opens recording
  → fetch manifest.pb → Manifest (no position arrays)
  → fetch chunks/0000.pb → first chunk into LRU cache
  → engine.loadRecording(manifest, chunkManager)
    → populate EntityManager (definitions only)
    → populate EventManager (all events)
    → computeSnapshots(frame=0)
  → as playback advances → ChunkManager loads next chunks on demand
```

The chunk cache holds 3 chunks at a time. When a chunk is evicted and then needed again, it is re-fetched.

### JSON (legacy)

```
User opens recording
  → fetch entire .json.gz buffer
  → decode manifest + ALL positions in one pass
  → engine.loadRecording(manifest) [no chunk manager]
    → entities include .positions[] (full per-frame history)
    → computeSnapshots reads from entity.positions[]
```

The JSON path loads everything upfront. There is no streaming. This path still works but is not used for newly uploaded recordings.

---

## Data Available at Each Layer

| Data | Protobuf file | Go Manifest struct | SQLite | REST API (`/api/v1/operations`) | Frontend (post-load) |
|------|:---:|:---:|:---:|:---:|:---:|
| Mission name / world name | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mission duration | ✓ | ✓ | ✓ | ✓ | ✓ |
| Player count | ✓ | derived | ✓ | ✓ | ✓ |
| Kill count | ✓ | derived | ✓ | ✓ | ✓ |
| Side composition (units/players/kills/dead) | ✓ | derived | ✓ | ✓ | ✓ |
| Entity definitions (name, side, type) | ✓ | ✓ | ✗ | ✗ | ✓ |
| Per-frame position (X, Y) | ✓ | ✗ | ✗ | ✗ | ✓ (via chunks) |
| Per-frame altitude (Z) | ✓ | ✗ | ✗ | ✗ | ✗ (dropped in decoder) |
| Per-frame heading/direction | ✓ | ✗ | ✗ | ✗ | ✓ (via chunks) |
| Per-frame alive state | ✓ | ✗ | ✗ | ✗ | ✓ (via chunks) |
| Per-frame crew / vehicle occupancy | ✓ | ✗ | ✗ | ✗ | ✓ (via chunks) |
| Projectile fire locations (`framesFired`) | ✓ | ✓ | ✗ | ✗ | ✓ (parsed, not rendered) |
| Kill events | ✓ | ✓ | aggregated | aggregated | ✓ (full) |
| Hit events | ✓ | ✓ | ✗ | ✗ | ✓ |
| Capture / contested events | ✓ | ✓ | ✗ | ✗ | ✓ |
| Connect / disconnect events | ✓ | ✓ | ✗ | ✗ | ✓ |
| Terminal hack events | ✓ | ✓ | ✗ | ✗ | ✓ |
| Respawn ticket / counter events | ✓ | ✓ | ✗ | ✗ | ✓ |
| Map markers (player-drawn) | ✓ | ✗ | ✗ | ✗ | ✓ |
| Frame-to-real-time mapping (`times[]`) | ✓ | ✗ | ✗ | ✗ | ✓ |

> **Note on "dropped in decoder":** The TypeScript `ArmaCoord` type is `[x, y]`. The protobuf decoder reads `posZ` but only stores `[posX, posY]`. Altitude data is fully present in the `.pb` files but is discarded before reaching the engine.

---

## Frontend: What Each Component Uses

### Recording Selector (`DetailSidebar`)

Source: REST API only (SQLite-backed). No recording file is loaded.

- Mission name, date, world name, tag
- Player count, kill count
- Per-side: unit count, player count, dead count, kill count
- Map preview image (static PNG, not from recording)

### Playback — `StatsTab` / `UnitsTab`

Source: Live engine, frame-aware. Stats reflect cumulative data **up to the current scrub position**.

- `engine.eventManager.getKillDeathCounts(currentFrame)` — per-unit kills, deaths, team kills
- `engine.eventManager.getGroupKills(currentFrame)` — per-group aggregates
- `engine.eventManager.getEquipmentLosses(currentFrame)` — vehicles destroyed/captured/lost by side
- `engine.entitySnapshots()` — current alive/dead state per unit

### Playback — `AARTab`

Source: Live engine, hardcoded to end-of-mission frame. Same data as StatsTab but always shows final totals.

- `engine.eventManager.getGroupKills(endFrame)`, `getEquipmentLosses(endFrame)`, `getKillDeathCounts(endFrame)`
- `engine.entitySnapshots()` at end frame

### Playback — `EventsTab`

Source: `engine.activeEvents()` — all events up to current frame.

Renders all event types: kills, hits, connects, captures, terminal hacks, mission messages. Supports filtering by event type and friendly-fire flag.

### Playback — Map Renderer (`entityCanvasLayer`)

Source: `EntitySnapshot` per entity per frame.

Consumes: position [x, y], direction, alive state, side (for icon color), name, isPlayer, isInVehicle, iconType.

Does **not** consume: altitude (z), firedTargets (available in snapshot but not rendered by canvas layer).

---

## Unused Data with Analysis Potential

These data fields exist and are accessible but are not currently visualized or aggregated into any stats.

### Projectile Fire Locations

**Where:** `EntityDef.framesFired[]` — available in manifest, parsed by the frontend decoder, stored in `Unit._framesFired`. The engine populates `EntitySnapshot.firedTargets` for any unit that fired on a given frame.

**Contains:** Frame number, target X/Y position for each projectile.

**Not done:** No rendering of projectile trails or impact sites. No spatial analysis of fire concentration or weapon range.

**How to add:** The data is already client-side. `entityCanvasLayer.updateEntity()` receives `EntitySnapshot` which includes `firedTargets` — drawing lines from unit position to each target is the main implementation gap.

---

### Altitude (Z coordinate)

**Where:** Protobuf `EntityState.posZ` field — present in every chunk frame.

**Not done:** The TypeScript decoder discards it; `EntitySnapshot.position` is always `[x, y]`.

**How to add:** Update `ArmaCoord` to `[x, y, z?]`, update the protobuf decoder to preserve `posZ`, propagate through `EntitySnapshot`.

---

### Unit Speed

**Where:** No explicit speed field exists anywhere. However, per-frame positions are available.

**How to derive:** Compute the Euclidean distance between consecutive frame positions and divide by `captureDelayMs`. This would need to happen either in the engine or in the renderer.

---

### Hit Events (Suppression / Damage)

**Where:** `hit` events are in the manifest and parsed by the frontend. They have the same fields as `killed` events (source, target, weapon, distance).

**Not aggregated:** No per-unit hit count, no weapon hit rate, no suppression heatmap.

**Relevant types:** `HitKilledEvent` handles both `hit` and `killed` — the aggregation methods (`getKillDeathCounts`) already filter to kills only by checking the event's discriminant.

---

### Capture / Contested Events

**Where:** `captured` and `contested` events are in the manifest. Each contains: unit name, object type, position (X, Y), side.

**Not visualized:** No objective control timeline, no sector heatmap, no "time-to-capture" analysis.

**Available data:** Event positions could power a sector-control map overlay. The event sequence could produce an objective timeline.

---

### Connect / Disconnect Events

**Where:** `connected` / `disconnected` events are in the manifest and rendered in the EventsTab log.

**Not aggregated:** No player join time, no session duration, no "players present at frame N" count.

---

### Terminal Hack Events

**Where:** `terminalHackStarted` / `terminalHackCanceled` events are parsed and appear in EventsTab.

**Not aggregated:** No hack attempt count, no success rate, no spatial clustering.

---

### Respawn Tickets / Counters (Antistasi)

**Where:** `respawnTickets`, `counterInit`, `counterSet` events are parsed into `CounterState`. The engine exposes `counterState` as a signal.

**Not visualized:** No UI component currently renders ticket counts or custom counters, though the data structure is fully ready.

---

### Friendly Fire Analytics

**Where:** `HitKilledEvent.isFriendlyFire()` is computed during reference resolution. EventsTab supports filtering to show/hide friendly fire events.

**Not aggregated:** No dedicated friendly-fire summary (which unit team-killed the most, which incidents occurred, etc.).

---

### Vehicle Ownership Timeline

**Where:** `EventManager` internally builds `ownershipTimeline: Map<vehicleId, OwnershipSnapshot[]>` and `vehicleCaptureEvents[]` during `processVehicleOwnership()`. This tracks when each vehicle changed hands.

**Not exposed:** No public method returns the ownership timeline. It is used only internally to compute `getEquipmentLosses()`.

**Potential use:** A "vehicle history" panel, or a timeline showing which group controlled which vehicle across the mission.

---

### Per-Frame Side / Group Changes

**Where:** Each `EntityState` in the chunk data includes per-frame `side` and `groupName` that may differ from the entity's static definition (e.g. a unit that switches faction or changes group mid-mission).

**Not tracked:** No UI or API surface exposes when a unit switched side or group. The renderer uses the per-frame value for display, but no history is built.

---

## Key File Reference

| Layer | File | Purpose |
|-------|------|---------|
| Protobuf schema | `pkg/schemas/protobuf/v1/ocap.proto` | Source of truth for all stored data fields |
| Go storage types | `internal/storage/engine.go` | `Manifest`, `EntityDef`, `Event`, `FiredFrame` structs |
| Go JSON parser | `internal/storage/parser_v1.go` | Parses raw JSON recording into protobuf |
| Go converter | `internal/storage/streaming_converter.go` | Streams JSON → protobuf chunks |
| Stats computation | `internal/conversion/worker.go` | `computeStats()` — what gets into SQLite |
| API types | `internal/server/operation.go` | `Operation`, `SideCounts`, `SideComposition` |
| TS data types | `ui/src/data/types.ts` | `Recording`, `EntityDef`, `EntityState`, `EventDef`, `Manifest` |
| Protobuf decoder | `ui/src/data/decoders/protobufDecoder.ts` | Converts `.pb` bytes → typed TS objects |
| Chunk manager | `ui/src/data/chunkManager.ts` | On-demand chunk loading with LRU cache |
| Playback engine | `ui/src/playback/engine.ts` | `computeSnapshots()`, playback loop, public API |
| Event manager | `ui/src/playback/eventManager.ts` | All aggregation methods (kills, equipment, groups) |
| Entity classes | `ui/src/playback/entities/` | `Unit`, `Vehicle`, `Group`, base `Entity` |
| Canvas renderer | `ui/src/renderers/leaflet/entityCanvasLayer.ts` | Frame rendering from `EntitySnapshot` |
| Recording load | `ui/src/pages/recording-playback/loadRecording.ts` | Full load sequence (fetch → decode → engine) |
