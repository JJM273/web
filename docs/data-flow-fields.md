# OCAP2-Web Field Inventory

This document is an exhaustive reference of every field in every significant data structure across the backend (Go/Protobuf) and frontend (TypeScript). For each field it notes where it exists, where it is dropped, and whether it reaches the frontend.

For a higher-level overview of data flow, see [data-flow.md](./data-flow.md).

---

## Table of Contents

1. [Protobuf Schema (Source of Truth)](#1-protobuf-schema-source-of-truth)
2. [Go Storage Layer](#2-go-storage-layer)
3. [Go API Layer (SQLite + HTTP)](#3-go-api-layer-sqlite--http)
4. [TypeScript Types](#4-typescript-types)
5. [Field Availability Matrix](#5-field-availability-matrix)

---

## 1. Protobuf Schema (Source of Truth)

**File:** `pkg/schemas/protobuf/v1/ocap.proto`

This is the canonical format for stored recordings. All fields listed here are physically present in the `.pb` files on disk.

### 1.1 `Manifest`

Top-level recording metadata, stored in `manifest.pb`.

| Field | Type | Description | Reaches Frontend? |
|-------|------|-------------|:-----------------:|
| `version` | uint32 | Schema version | ✓ |
| `world_name` | string | Arma map name (e.g. "Altis") | ✓ |
| `mission_name` | string | Mission name | ✓ |
| `end_frame` | uint32 | Last frame number in recording | ✓ |
| `chunk_size` | uint32 | Frames per chunk file (typically 300) | ✓ |
| `capture_delay_ms` | uint32 | Milliseconds between frames (~50ms) | ✓ |
| `chunk_count` | uint32 | Number of chunk files | ✓ |
| `entities[]` | EntityDef[] | All entity definitions (see 1.2) | ✓ |
| `events[]` | Event[] | All mission events (see 1.5) | ✓ |
| `markers[]` | MarkerDef[] | Player-drawn map markers (see 1.6) | ✓ |
| `times[]` | TimeSample[] | Frame-to-real-time mapping (see 1.8) | ✓ |
| `extension_version` | string | Arma extension version string | ✓ |
| `addon_version` | string | Arma mod version string | ✓ |
| `mission_author` | string | Mission author name | ✓ |

---

### 1.2 `EntityDef`

Static definition of a unit or vehicle. One record per spawned entity in the mission.

| Field | Type | Description | In Go `EntityDef`? | Reaches Frontend? |
|-------|------|-------------|:-----------------:|:-----------------:|
| `id` | uint32 | Unique entity ID | ✓ | ✓ |
| `type` | EntityType enum | UNIT or VEHICLE | ✓ (as string) | ✓ |
| `name` | string | Display name | ✓ | ✓ |
| `side` | Side enum | WEST / EAST / GUER / CIV / GLOBAL | ✓ (as string) | ✓ |
| `group_name` | string | Unit group name | ✓ (as `Group`) | ✓ |
| `role` | string | Unit role description | ✓ | ✓ |
| `start_frame` | uint32 | Frame entity first appears | ✓ | ✓ |
| `end_frame` | uint32 | Frame entity last appears | ✓ | ✓ |
| `is_player` | bool | Controlled by a human | ✓ | ✓ |
| `vehicle_class` | string | car / tank / apc / truck / ship / heli / plane / parachute / staticWeapon / staticMortar | ✓ (as `VehicleClass`) | ✓ |
| `frames_fired[]` | FiredFrame[] | Projectile fire data (see 1.3) | ✓ (stored, never read) | ✓ (parsed, not rendered) |

---

### 1.3 `FiredFrame`

One record per projectile fired by an entity. Embedded in `EntityDef.frames_fired`.

| Field | Type | Description | In Go struct? | Reaches Frontend? | Used? |
|-------|------|-------------|:---:|:---:|:---:|
| `frame_num` | uint32 | Frame when fired | ✓ | ✓ | ✓ (frame lookup) |
| `pos_x` | float32 | Target impact X coordinate | ✓ | ✓ | ✗ (not rendered) |
| `pos_y` | float32 | Target impact Y coordinate | ✓ | ✓ | ✗ (not rendered) |
| `pos_z` | float32 | Target impact Z (altitude) | ✓ | ✗ (dropped) | ✗ |

> **Note:** `firedTargets` is populated in `EntitySnapshot` per frame but no renderer or UI component reads it.

---

### 1.4 `EntityState`

Per-frame state of a single entity. Stored inside `Frame` messages inside chunk files.

| Field | Type | Description | In Go struct? | Reaches Frontend? | Used by renderer? |
|-------|------|-------------|:---:|:---:|:---:|
| `entity_id` | uint32 | Which entity this state belongs to | ✓ | ✓ (as map key) | ✓ |
| `pos_x` | float32 | X coordinate (Arma world meters) | ✓ | ✓ | ✓ |
| `pos_y` | float32 | Y coordinate | ✓ | ✓ | ✓ |
| `pos_z` | float32 | Z coordinate (altitude) | ✓ | ✗ (dropped in decoder) | ✗ |
| `direction` | uint32 | Heading in degrees (0–359) | ✓ | ✓ | ✓ (icon rotation) |
| `alive` | uint32 | 0 = dead, 1 = alive, 2 = unconscious | ✓ | ✓ | ✓ (icon variant) |
| `crew_ids[]` | uint32[] | Entity IDs of crew (vehicles only) | ✓ | ✓ | ✓ (side derivation) |
| `vehicle_id` | uint32 | Vehicle this unit is riding in | ✓ | ✓ | ✓ |
| `is_in_vehicle` | bool | Whether unit is inside a vehicle | ✓ | ✓ | ✓ (hides unit icon) |
| `name` | string | Per-frame name override | ✓ | ✓ | ✓ (label) |
| `is_player` | bool | Per-frame player flag | ✓ | ✓ | ✗ (not used per-frame) |
| `group_name` | string | Per-frame group (may change) | ✓ | ✓ | ✗ |
| `side` | string | Per-frame faction (may change) | ✓ | ✓ | ✓ (icon color) |
| `frame_num` | uint32 | Frame number — cleared to 0 in final files | ✗ (cleared) | ✗ | ✗ |

> **Altitude note:** `pos_z` travels through the Go storage layer intact. It is dropped in `ui/src/data/decoders/protobufDecoder.ts` when constructing the `ArmaCoord` tuple (`[x, y]` only). Updating `ArmaCoord` to `[x, y, z?]` would recover it.

---

### 1.5 `Event`

A discrete mission event. All events are stored in `Manifest.events[]`.

| Field | Type | Description | Populated for event types |
|-------|------|-------------|--------------------------|
| `frame_num` | uint32 | Frame when event occurred | All |
| `type` | string | Event type discriminator (see below) | All |
| `source_id` | uint32 | Attacker / actor entity ID | hit, killed, captured, contested |
| `target_id` | uint32 | Victim entity ID | hit, killed |
| `message` | string | Text content | connected, disconnected, generalEvent, terminalHack*, endMission |
| `distance` | float32 | Range in meters | hit, killed |
| `weapon` | string | Weapon class name | hit, killed |
| `pos_x` | float32 | Event X coordinate | captured, contested, capturedFlag |
| `pos_y` | float32 | Event Y coordinate | captured, contested, capturedFlag |
| `object_type` | string | Sector or object name | captured, contested, capturedFlag |
| `unit_name` | string | Name of actor unit | captured, contested, terminalHack* |
| `side` | string | Faction involved | endMission, captured, contested |

#### Event Types

| Type | Description | Aggregated in SQLite? | Rendered in UI? |
|------|-------------|:---------------------:|:---------------:|
| `killed` | Entity killed | ✓ (only type) | ✓ EventsTab |
| `hit` | Entity shot but not killed | ✗ | ✓ EventsTab |
| `connected` | Player joined | ✗ | ✓ EventsTab |
| `disconnected` | Player left | ✗ | ✓ EventsTab |
| `generalEvent` | Mission message | ✗ | ✓ EventsTab |
| `endMission` | Mission ended | ✗ | ✓ EventsTab |
| `captured` | Sector/object captured | ✗ | ✓ EventsTab |
| `contested` | Sector under contest | ✗ | ✓ EventsTab |
| `capturedFlag` | Flag captured (legacy) | ✗ | ✓ EventsTab |
| `terminalHackStarted` | Hack attempt began | ✗ | ✓ EventsTab |
| `terminalHackCanceled` | Hack attempt cancelled | ✗ | ✓ EventsTab |
| `respawnTickets` | Antistasi ticket update | ✗ | ✗ (counter only) |
| `counterInit` | Counter initialized | ✗ | ✗ (counter only) |
| `counterSet` | Counter updated | ✗ | ✗ (counter only) |

---

### 1.6 `MarkerDef`

Player-drawn map markers.

| Field | Type | Description | Reaches Frontend? |
|-------|------|-------------|:-----------------:|
| `type` | string | Marker type | ✓ |
| `text` | string | Label text | ✓ |
| `start_frame` | uint32 | First visible frame | ✓ |
| `end_frame` | uint32 | Last visible frame (0 = permanent) | ✓ |
| `player_id` | int32 | Creator entity ID | ✓ |
| `color` | string | Marker color | ✓ |
| `side` | Side enum | Faction that drew the marker | ✓ |
| `positions[]` | MarkerPosition[] | Per-frame state (see 1.7) | ✓ |
| `size[]` | float32[] | Marker size per frame | ✓ |
| `shape` | string | ICON / ELLIPSE / RECTANGLE / POLYLINE | ✓ |
| `brush` | string | Fill style | ✓ |

---

### 1.7 `MarkerPosition`

Per-frame state of a map marker.

| Field | Type | Description | Reaches Frontend? |
|-------|------|-------------|:-----------------:|
| `frame_num` | uint32 | Frame number | ✓ |
| `pos_x` | float32 | X coordinate | ✓ |
| `pos_y` | float32 | Y coordinate | ✓ |
| `pos_z` | float32 | Z coordinate | ✓ |
| `direction` | float32 | Heading | ✓ |
| `alpha` | float32 | Opacity | ✓ |
| `line_coords[]` | float32[] | POLYLINE vertex array `[x1,y1,x2,y2,...]` | ✓ |
| `text` | string | Per-frame text override | ✓ |
| `color` | string | Per-frame color override | ✓ |
| `size[]` | float32[] | Per-frame size override | ✓ |
| `type` | string | Per-frame type override | ✓ |
| `brush` | string | Per-frame brush override | ✓ |

---

### 1.8 `TimeSample`

Frame-to-real-time mapping for the timeline scrubber labels.

| Field | Type | Description | Reaches Frontend? |
|-------|------|-------------|:-----------------:|
| `frame_num` | uint32 | Frame index | ✓ |
| `system_time_utc` | string | Wall-clock UTC time | ✓ |
| `date` | string | In-game date string | ✓ |
| `time_multiplier` | float32 | Arma time acceleration factor | ✓ |
| `time` | float32 | In-game time (seconds since midnight) | ✓ |

---

### 1.9 `Chunk` / `Frame`

Container structure for per-frame entity state.

| Message | Field | Type | Description |
|---------|-------|------|-------------|
| `Chunk` | `index` | uint32 | Sequential chunk number |
| `Chunk` | `start_frame` | uint32 | Absolute frame number of first frame in chunk |
| `Chunk` | `frame_count` | uint32 | Number of frames in chunk (≤ chunk_size) |
| `Chunk` | `frames[]` | Frame[] | Array of frames |
| `Frame` | `frame_num` | uint32 | Absolute frame number |
| `Frame` | `entities[]` | EntityState[] | States of all active entities this frame |

---

## 2. Go Storage Layer

**Package:** `internal/storage`

### 2.1 `Manifest` (`engine.go`)

Maps 1:1 from protobuf, with two omissions.

| Field | Type | Notes |
|-------|------|-------|
| `Version` | uint32 | |
| `WorldName` | string | |
| `MissionName` | string | |
| `EndFrame` | uint32 | |
| `ChunkSize` | uint32 | |
| `CaptureDelayMs` | uint32 | |
| `ChunkCount` | uint32 | |
| `Entities` | []EntityDef | |
| `Events` | []Event | All event types |
| `ExtensionVersion` | string | |
| `AddonVersion` | string | |
| ~~`Markers`~~ | — | **Omitted** — dropped from struct after conversion |
| ~~`Times`~~ | — | **Omitted** — dropped from struct after conversion |

> `Markers` and `Times` are parsed by `streaming_converter.go` and written into the protobuf file, but the Go `Manifest` struct does not include them. They are only accessible by the frontend via the raw `.pb` bytes.

---

### 2.2 `EntityDef` (`engine.go`)

| Field | Type | Notes |
|-------|------|-------|
| `ID` | uint32 | |
| `Type` | string | "unit" or "vehicle" |
| `Name` | string | |
| `Side` | string | "WEST", "EAST", "GUER", "CIV" |
| `Group` | string | From protobuf `group_name` |
| `Role` | string | |
| `StartFrame` | uint32 | |
| `EndFrame` | uint32 | |
| `IsPlayer` | bool | |
| `VehicleClass` | string | |
| `FramesFired` | []FiredFrame | **Populated but never read by any Go code** |

---

### 2.3 `FiredFrame` (`engine.go`)

| Field | Type | Notes |
|-------|------|-------|
| `FrameNum` | uint32 | |
| `PosX` | float32 | |
| `PosY` | float32 | |
| `PosZ` | float32 | |

---

### 2.4 `Event` (`engine.go`)

| Field | Type | Notes |
|-------|------|-------|
| `FrameNum` | uint32 | |
| `Type` | string | |
| `SourceID` | uint32 | |
| `TargetID` | uint32 | |
| `Message` | string | |
| `Distance` | float32 | |
| `Weapon` | string | |
| `PosX` | float32 | |
| `PosY` | float32 | |
| `ObjectType` | string | |
| `UnitName` | string | |
| `Side` | string | |

---

## 3. Go API Layer (SQLite + HTTP)

**Package:** `internal/server`

### 3.1 SQLite `operations` Table

| Column | Type | Source |
|--------|------|--------|
| `id` | INTEGER PRIMARY KEY | Auto |
| `world_name` | TEXT | From upload |
| `mission_name` | TEXT | From upload |
| `mission_duration` | REAL | `endFrame * captureDelayMs / 1000` |
| `filename` | TEXT | From upload |
| `date` | TEXT | From upload |
| `tag` | TEXT | From upload |
| `storage_format` | TEXT | `"json"` or `"protobuf"` |
| `conversion_status` | TEXT | `"pending"` / `"converting"` / `"completed"` / `"failed"` |
| `schema_version` | INTEGER | From manifest |
| `chunk_count` | INTEGER | From manifest |
| `player_count` | INTEGER | `computeStats()` |
| `kill_count` | INTEGER | `computeStats()` — killed events only |
| `player_kill_count` | INTEGER | `computeStats()` — killed events by players |
| `side_composition` | TEXT (JSON) | `computeStats()` — killed events only |
| `focus_start` | INTEGER NULLABLE | User-set |
| `focus_end` | INTEGER NULLABLE | User-set |

---

### 3.2 `Operation` struct (HTTP response body)

Served by `GET /api/v1/operations` and `GET /api/v1/operations/{id}`.

| JSON key | Go field | Type | Source |
|----------|----------|------|--------|
| `id` | `ID` | int64 | SQLite |
| `world_name` | `WorldName` | string | SQLite |
| `mission_name` | `MissionName` | string | SQLite |
| `mission_duration` | `MissionDuration` | float64 | SQLite |
| `filename` | `Filename` | string | SQLite |
| `date` | `Date` | string | SQLite |
| `tag` | `Tag` | string | SQLite |
| `storageFormat` | `StorageFormat` | string | SQLite |
| `conversionStatus` | `ConversionStatus` | string | SQLite |
| `schemaVersion` | `SchemaVersion` | uint32 | SQLite |
| `chunkCount` | `ChunkCount` | int | SQLite |
| `player_count` | `PlayerCount` | *int | SQLite |
| `kill_count` | `KillCount` | *int | SQLite |
| `player_kill_count` | `PlayerKillCount` | *int | SQLite |
| `side_composition` | `SideComposition` | SideComposition | SQLite (JSON blob) |
| `focusStart` | `FocusStart` | *int | SQLite |
| `focusEnd` | `FocusEnd` | *int | SQLite |

---

### 3.3 `SideCounts` struct

One entry per side inside `SideComposition`.

| JSON key | Go field | Description |
|----------|----------|-------------|
| `players` | `Players` | Unique human players on this side |
| `units` | `Units` | Total entities (units) on this side |
| `dead` | `Dead` | Entities killed (victims of `killed` events) |
| `kills` | `Kills` | Kills attributed to this side (source of `killed` events) |

---

### 3.4 `computeStats()` — What Is and Isn't Counted

**File:** `internal/conversion/worker.go:231`

| Stat | Computed? | Notes |
|------|:---------:|-------|
| Player count | ✓ | Deduplicated by name (handles respawns) |
| Kill count | ✓ | `killed` events only |
| Player kill count | ✓ | `killed` events where source `isPlayer` |
| Per-side kills | ✓ | Source side of `killed` event |
| Per-side deaths | ✓ | Target side of `killed` event |
| Per-side units | ✓ | All entity defs with matching side |
| Hit count | ✗ | |
| Capture count | ✗ | |
| Equipment losses | ✗ | |
| Friendly fire count | ✗ | |
| Sector control events | ✗ | |

---

## 4. TypeScript Types

**Primary file:** `ui/src/data/types.ts`

### 4.1 `Recording`

The frontend representation of a row from `GET /api/v1/operations`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | |
| `missionName` | string | |
| `worldName` | string | |
| `missionDuration` | number | Seconds |
| `date` | string | |
| `tag?` | string | |
| `playerCount?` | number | |
| `killCount?` | number | |
| `playerKillCount?` | number | |
| `sideComposition?` | `Record<string, { players, units, dead, kills }>` | |
| `storageFormat?` | `"protobuf"` | Absence means JSON |
| `chunkCount?` | number | |
| `schemaVersion?` | number | |

---

### 4.2 `EntityDef`

Populated from manifest. Static for the lifetime of the recording.

| Field | Type | Notes |
|-------|------|-------|
| `id` | number | |
| `type` | EntityType | `"man"` \| `"car"` \| `"tank"` \| `"apc"` \| `"truck"` \| `"ship"` \| `"heli"` \| `"plane"` \| `"parachute"` \| `"staticWeapon"` \| `"staticMortar"` \| `"unknown"` |
| `name` | string | |
| `side` | Side | `"WEST"` \| `"EAST"` \| `"GUER"` \| `"CIV"` |
| `groupName` | string | |
| `role?` | string | |
| `startFrame` | number | |
| `endFrame` | number | |
| `isPlayer` | boolean | |
| `framesFired?` | `Array<[frameNum: number, pos: ArmaCoord]>` | Present; not rendered |
| `positions?` | EntityState[] | JSON format only; null for protobuf |

---

### 4.3 `EntityState`

Per-frame state, sourced either from `EntityDef.positions[]` (JSON) or `ChunkData.entities` (protobuf).

| Field | Type | Notes |
|-------|------|-------|
| `position` | ArmaCoord (`[x, y]`) | **Z is dropped** — see protobuf note |
| `direction` | number | Degrees 0–359 |
| `alive` | AliveState | `0` (dead) \| `1` (alive) \| `2` (unconscious) |
| `name?` | string | Per-frame override |
| `crewIds?` | number[] | Vehicle crew IDs |
| `vehicleId?` | number | Vehicle this unit is in |
| `isInVehicle?` | boolean | |
| `isPlayer?` | boolean | Per-frame |
| `groupName?` | string | Per-frame |
| `side?` | string | Per-frame |

---

### 4.4 `EntitySnapshot`

What the renderer receives for a single entity at the current frame.

| Field | Type | Notes |
|-------|------|-------|
| `id` | number | |
| `position` | ArmaCoord (`[x, y]`) | |
| `direction` | number | |
| `alive` | AliveState | |
| `side` | Side \| null | |
| `name` | string | |
| `iconType` | string | |
| `isPlayer` | boolean | |
| `isInVehicle` | boolean | |
| `firedTargets?` | ArmaCoord[] | Projectile target positions — present but **not rendered** |

---

### 4.5 `Manifest`

Loaded from `manifest.pb` at playback start.

| Field | Type | Notes |
|-------|------|-------|
| `version` | number | |
| `worldName` | string | |
| `missionName` | string | |
| `missionAuthor?` | string | |
| `endFrame` | number | |
| `chunkSize` | number | |
| `chunkCount` | number | |
| `captureDelayMs` | number | |
| `entities` | EntityDef[] | |
| `events` | EventDef[] | All event types |
| `markers` | MarkerDef[] | |
| `times` | TimeSample[] | |
| `extensionVersion?` | string | |
| `addonVersion?` | string | |

---

### 4.6 `EventDef` (discriminated union)

All event types share `frameNum` and `type`. Type-specific fields below.

| `type` value | Extra fields |
|---|---|
| `"killed"` | `victimId, causedById, distance, weapon` |
| `"hit"` | `victimId, causedById, distance, weapon` |
| `"connected"` | `unitName` |
| `"disconnected"` | `unitName` |
| `"generalEvent"` | `message` |
| `"endMission"` | `side, message` |
| `"captured"` | `unitName, objectType, side?, position?` |
| `"contested"` | `unitName, objectType, side?, position?` |
| `"capturedFlag"` | `unitName, objectType, side?, position?` |
| `"terminalHackStarted"` | `unitName` |
| `"terminalHackCanceled"` | `unitName` |
| `"respawnTickets"` | `data: number[]` |
| `"counterInit"` | `data: number[]` |
| `"counterSet"` | `data: number[]` |

---

### 4.7 `ChunkData`

Decoded chunk payload held in the `ChunkManager` LRU cache.

| Field | Type | Notes |
|-------|------|-------|
| `entities` | `Map<entityId, EntityState[]>` | Array index = frameInChunk (0 to chunkSize-1) |

---

### 4.8 `MarkerDef`

| Field | Type |
|-------|------|
| `type` | string |
| `text` | string |
| `startFrame` | number |
| `endFrame` | number |
| `playerId` | number |
| `color` | string |
| `side` | Side |
| `shape` | string |
| `brush` | string |
| `size` | number[] |
| `positions` | MarkerPosition[] |

---

### 4.9 Entity Classes

**`Unit`** (`ui/src/playback/entities/unit.ts`):

| Property | Type | Notes |
|----------|------|-------|
| `id` | number | |
| `name` | string | Mutable |
| `side` | Side | Static from manifest |
| `role` | string | |
| `isPlayer` | boolean | Static |
| `groupName` | string | Static |
| `killCount` | number | Populated by `EventManager.resolveReferences()` |
| `teamKillCount` | number | Populated by `EventManager.resolveReferences()` |
| `deathCount` | number | Populated by `EventManager.resolveReferences()` |
| `_framesFired` | `Array<[frameNum, ArmaCoord]>` | Projectile targets |
| `positions` | EntityState[] \| null | null in streaming mode |

**`Vehicle`** (`ui/src/playback/entities/vehicle.ts`):

| Property | Type | Notes |
|----------|------|-------|
| `vehicleType` | string | |
| `staticSide` | Side \| null | Side from mission start |
| `crew` | number[] | Updated per-frame from chunk data |
| `positions` | EntityState[] \| null | null in streaming mode |

---

### 4.10 `EventManager` Aggregation Outputs

These methods are called by UI components.

| Method | Returns | Frame-aware? |
|--------|---------|:---:|
| `getKillDeathCounts(frame)` | `{ kills: Map<unitId, number>, deaths: Map<unitId, number>, vehicleKills: Map<unitId, number>, teamKills: Map<unitId, number> }` | ✓ |
| `getGroupKills(frame)` | `GroupKillStats[]` — per `side:groupName` aggregate | ✓ |
| `getEquipmentLosses(frame)` | `Map<Side, { destroyed, lost_combat, lost_captured, captured }>` each a `Map<vehicleType, count>` | ✓ |
| `getEventsAtFrame(frame)` | `GameEvent[]` — events exactly at this frame | ✓ |
| `getActiveEvents(frame)` | `GameEvent[]` — all events up to frame (ascending) | ✓ |

---

## 5. Field Availability Matrix

This matrix summarises where each significant data category exists. Columns represent layers; a ✓ means the data is accessible at that layer.

| Data Category | `.pb` file | Go `Manifest` struct | SQLite | REST API | Frontend (post-load) | UI Component |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Mission name / world / duration | ✓ | ✓ | ✓ | ✓ | ✓ | All |
| Player / kill / death counts | derived | derived | ✓ | ✓ | ✓ | Sidebar, Stats, AAR |
| Per-side unit/player/kill/dead | derived | derived | ✓ | ✓ | ✓ | Sidebar, Stats, AAR |
| Entity name / side / group / role | ✓ | ✓ | ✗ | ✗ | ✓ | Units, Stats, AAR |
| Entity start/end frame | ✓ | ✓ | ✗ | ✗ | ✓ | (engine internal) |
| Per-frame position [x, y] | ✓ | ✗ | ✗ | ✗ | ✓ | Map renderer |
| **Per-frame altitude [z]** | **✓** | **✗** | **✗** | **✗** | **✗ dropped** | **none** |
| Per-frame heading | ✓ | ✗ | ✗ | ✗ | ✓ | Map renderer |
| Per-frame alive state | ✓ | ✗ | ✗ | ✗ | ✓ | Map renderer, Units |
| Per-frame crew / vehicle | ✓ | ✗ | ✗ | ✗ | ✓ | Map renderer (side) |
| Per-frame side / group override | ✓ | ✗ | ✗ | ✗ | ✓ | Map renderer |
| **Projectile fire locations** | **✓** | **✓** | **✗** | **✗** | **✓ not rendered** | **none** |
| Kill events | ✓ | ✓ | aggregated | aggregated | ✓ (full) | Events, Stats, AAR |
| **Hit events** | **✓** | **✓** | **✗** | **✗** | **✓** | **Events only** |
| **Capture / contested events** | **✓** | **✓** | **✗** | **✗** | **✓** | **Events only** |
| Connect / disconnect events | ✓ | ✓ | ✗ | ✗ | ✓ | Events |
| Terminal hack events | ✓ | ✓ | ✗ | ✗ | ✓ | Events |
| Respawn ticket / counter events | ✓ | ✓ | ✗ | ✗ | ✓ (CounterState) | none (data ready) |
| Map markers | ✓ | ✗ | ✗ | ✗ | ✓ | Map overlay |
| Frame-to-time mapping | ✓ | ✗ | ✗ | ✗ | ✓ | Timeline scrubber |
| Equipment losses (vehicles) | derived | ✗ | ✗ | ✗ | derived | Stats, AAR |
| **Vehicle ownership timeline** | derived | ✗ | ✗ | ✗ | ✓ (internal only) | **none** |
| **Friendly fire events** | derived | ✗ | ✗ | ✗ | ✓ | Events (filter only) |
| **Unit speed** | ✗ | ✗ | ✗ | ✗ | derivable | **none** |

> Rows in **bold** represent data that exists but is not surfaced meaningfully in any current UI component or API response, representing the clearest opportunities for additional analysis features.
