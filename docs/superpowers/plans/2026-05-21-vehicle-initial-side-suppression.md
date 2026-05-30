# Vehicle Initial-Side Suppression Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Suppress false vehicle-capture events for garage-spawned vehicles by ignoring the first-ever side change if it occurs within 60 seconds of the vehicle's `startFrame`.

**Architecture:** One constant and one extra parameter added to `processVehicleOwnership` in `eventManager.ts`. The `currentOwnerGroupKey === null` branch (first-boarding path) gains a time-window guard. The call site in `engine.ts` passes `captureDelayMs`. Subsequent side changes (enemy takes a previously-crewed vehicle) are untouched.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Write failing tests for the suppression window

**Files:**
- Modify: `ui/src/playback/__tests__/eventManager.test.ts`

- [ ] **Step 1: Add the `processVehicleOwnership` describe block with three tests**

Append the following block at the bottom of `eventManager.test.ts`, before the final closing `});` of the outer `describe("EventManager", ...)`:

```typescript
  describe("processVehicleOwnership – initial-side suppression window", () => {
    /** Builds an EntityState array for a vehicle.
     *  Every frame has empty crew except the ones specified in crewFrames. */
    function makeVehiclePositions(
      length: number,
      crewFrames: { relFrame: number; crewIds: number[] }[] = [],
    ): import("../../data/types").EntityState[] {
      const positions: import("../../data/types").EntityState[] = Array.from(
        { length },
        () => ({
          position: [0, 0] as [number, number],
          direction: 0,
          alive: 1 as import("../../data/types").AliveState,
          crewIds: [],
        }),
      );
      for (const { relFrame, crewIds } of crewFrames) {
        positions[relFrame] = { ...positions[relFrame], crewIds };
      }
      return positions;
    }

    /** Builds a dense alive-positions array for a unit. */
    function makeUnitPositions(
      length: number,
    ): import("../../data/types").EntityState[] {
      return Array.from({ length }, () => ({
        position: [0, 0] as [number, number],
        direction: 0,
        alive: 1 as import("../../data/types").AliveState,
      }));
    }

    it("suppresses capture when first crew boards within the 60s window", () => {
      // Scenario: garage vehicle, staticSide="CIV", WEST crew boards at frame 10
      // captureDelayMs=1000 → 10s from spawn → well inside the 60s window.
      const em = new EntityManager();
      const mgr = new EventManager();

      // Vehicle: startFrame=0, staticSide="CIV", WEST crew boards at relative frame 10
      em.addEntity(
        vehicleDef({
          id: 10,
          side: "CIV",
          startFrame: 0,
          endFrame: 199,
          positions: makeVehiclePositions(200, [{ relFrame: 10, crewIds: [1] }]),
        }),
      );

      // WEST unit: alive at frame 10 (absolute)
      em.addEntity(
        unitDef({
          id: 1,
          side: "WEST",
          startFrame: 0,
          endFrame: 199,
          positions: makeUnitPositions(200),
        }),
      );

      mgr.resolveReferences(em);
      mgr.processVehicleOwnership(em, 1000);

      const losses = mgr.getEquipmentLosses(9999);
      // No capture should have been recorded
      expect(losses.get("CIV")?.lost_captured?.get("car") ?? 0).toBe(0);
      expect(losses.get("WEST")?.captured?.get("car") ?? 0).toBe(0);
    });

    it("fires a capture when first crew boards after the 60s window", () => {
      // Scenario: garage vehicle, staticSide="CIV", WEST crew boards at frame 65
      // captureDelayMs=1000 → 65s from spawn → outside the 60s window.
      const em = new EntityManager();
      const mgr = new EventManager();

      em.addEntity(
        vehicleDef({
          id: 10,
          side: "CIV",
          startFrame: 0,
          endFrame: 199,
          positions: makeVehiclePositions(200, [{ relFrame: 65, crewIds: [1] }]),
        }),
      );

      em.addEntity(
        unitDef({
          id: 1,
          side: "WEST",
          startFrame: 0,
          endFrame: 199,
          positions: makeUnitPositions(200),
        }),
      );

      mgr.resolveReferences(em);
      mgr.processVehicleOwnership(em, 1000);

      const losses = mgr.getEquipmentLosses(9999);
      // Capture SHOULD be recorded: CIV lost it, WEST gained it
      expect(losses.get("CIV")?.lost_captured?.get("car") ?? 0).toBe(1);
      expect(losses.get("WEST")?.captured?.get("car") ?? 0).toBe(1);
    });

    it("fires a subsequent capture even when it occurs within the 60s window", () => {
      // Scenario: WEST vehicle, WEST crew boards at frame 5 (within window, no capture).
      // EAST crew boards at frame 15 (still within window but subsequent boarding).
      // The suppression window only applies to the FIRST-EVER boarding.
      const em = new EntityManager();
      const mgr = new EventManager();

      em.addEntity(
        vehicleDef({
          id: 10,
          side: "WEST",
          startFrame: 0,
          endFrame: 199,
          positions: makeVehiclePositions(200, [
            { relFrame: 5, crewIds: [1] },   // WEST boards → initial owner
            { relFrame: 10, crewIds: [] },    // crew exits
            { relFrame: 15, crewIds: [2] },   // EAST boards → capture
          ]),
        }),
      );

      // WEST unit alive through frame 5 only (exits before frame 10)
      em.addEntity(
        unitDef({
          id: 1,
          side: "WEST",
          startFrame: 0,
          endFrame: 199,
          positions: makeUnitPositions(200),
        }),
      );

      // EAST unit alive from frame 0
      em.addEntity(
        unitDef({
          id: 2,
          side: "EAST",
          startFrame: 0,
          endFrame: 199,
          positions: makeUnitPositions(200),
        }),
      );

      mgr.resolveReferences(em);
      mgr.processVehicleOwnership(em, 1000);

      const losses = mgr.getEquipmentLosses(9999);
      // WEST lost 1 vehicle (captured), EAST captured 1
      expect(losses.get("WEST")?.lost_captured?.get("car") ?? 0).toBe(1);
      expect(losses.get("EAST")?.captured?.get("car") ?? 0).toBe(1);
    });
  });
```

- [ ] **Step 2: Run the new tests to confirm they fail**

```bash
cd /Users/jaymorehart/GitRepos/OCAP/web/ui
npx vitest run src/playback/__tests__/eventManager.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 2 failures — the within-window test incorrectly reports a capture, and the outside-window test may pass or fail depending on current logic. The key signal is that the first test fails ("suppresses capture when first crew boards within the 60s window"). TypeScript will also error because `processVehicleOwnership` doesn't yet accept a second argument.

---

### Task 2: Implement the suppression window

**Files:**
- Modify: `ui/src/playback/eventManager.ts:232`
- Modify: `ui/src/playback/engine.ts:362`

- [ ] **Step 1: Add the constant and update the method signature in `eventManager.ts`**

At the top of `eventManager.ts`, directly above the `EventManager` class declaration (after the `VehicleCaptureEvent` interface), add:

```typescript
const INITIAL_SIDE_WINDOW_MS = 60_000;
```

Change the `processVehicleOwnership` signature from:

```typescript
processVehicleOwnership(entityManager: EntityManager): void {
```

to:

```typescript
processVehicleOwnership(entityManager: EntityManager, captureDelayMs: number): void {
```

- [ ] **Step 2: Update the first-boarding capture guard**

In `processVehicleOwnership`, find the `if (currentOwnerGroupKey === null)` block. It currently reads:

```typescript
        if (currentOwnerGroupKey === null) {
          // First live crew aboard — establish initial ownership.
          // If the boarding side differs from the vehicle's static side, count as a capture.
          if (currentSide !== null && newSide !== currentSide) {
            this.vehicleCaptureEvents.push({
              frame: absoluteFrame,
              vehicleId: vehicle.id,
              vehicleType: vehicle.vehicleType || "unknown",
              fromSide: currentSide,
              toSide: newSide,
            });
          }
          currentSide = newSide;
          currentOwnerGroupKey = newGroupKey;
          changes.push({ frame: absoluteFrame, side: currentSide, ownerGroup: representativeUnit.groupName });
```

Replace it with:

```typescript
        if (currentOwnerGroupKey === null) {
          // First live crew aboard — establish initial ownership.
          // Suppress the capture if it happens within INITIAL_SIDE_WINDOW_MS of the
          // vehicle's startFrame: garage/game-logic spawns begin side-less and should
          // not count as a capture when the first crew boards.
          const msFromSpawn = (absoluteFrame - vehicle.startFrame) * captureDelayMs;
          if (currentSide !== null && newSide !== currentSide && msFromSpawn >= INITIAL_SIDE_WINDOW_MS) {
            this.vehicleCaptureEvents.push({
              frame: absoluteFrame,
              vehicleId: vehicle.id,
              vehicleType: vehicle.vehicleType || "unknown",
              fromSide: currentSide,
              toSide: newSide,
            });
          }
          currentSide = newSide;
          currentOwnerGroupKey = newGroupKey;
          changes.push({ frame: absoluteFrame, side: currentSide, ownerGroup: representativeUnit.groupName });
```

- [ ] **Step 3: Update the call site in `engine.ts`**

In `engine.ts`, find:

```typescript
    this.eventManager.processVehicleOwnership(this.entityManager);
```

Replace with:

```typescript
    this.eventManager.processVehicleOwnership(this.entityManager, this._captureDelayMs());
```

---

### Task 3: Verify and commit

**Files:** (none new)

- [ ] **Step 1: Run the full test suite**

```bash
cd /Users/jaymorehart/GitRepos/OCAP/web/ui
npx vitest run --reporter=verbose 2>&1 | tail -40
```

Expected: all tests pass, including the three new `processVehicleOwnership` tests.

- [ ] **Step 2: Run TypeScript type-check**

```bash
cd /Users/jaymorehart/GitRepos/OCAP/web/ui
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C /Users/jaymorehart/GitRepos/OCAP/web add \
  ui/src/playback/eventManager.ts \
  ui/src/playback/engine.ts \
  ui/src/playback/__tests__/eventManager.test.ts
git -C /Users/jaymorehart/GitRepos/OCAP/web commit -m "$(cat <<'EOF'
fix: suppress vehicle capture for garage spawns within 60s initial window

Vehicles spawned from the garage begin with sideEmpty (mapped to CIV),
causing a false CIV→WEST/EAST capture when the first crew boards.
The first-boarding path in processVehicleOwnership now ignores side
changes that happen within 60 seconds of the vehicle's startFrame.
Subsequent side changes (enemy captures an already-crewed vehicle)
are unaffected.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** constant ✓, signature change ✓, guard update ✓, call site ✓, all 5 spec test scenarios covered by the 3 tests (within-window suppress, outside-window fire, subsequent-fire-inside-window) ✓
- **No placeholders:** all code blocks are complete and runnable
- **Type consistency:** `captureDelayMs: number` used in both signature and call site; `INITIAL_SIDE_WINDOW_MS` referenced only in the one guard; `msFromSpawn` is a local `number`
- **Boundary check:** the tests use `captureDelayMs=1000` with frames 10 (10s, inside), 65 (65s, outside), and 15 (15s, inside but subsequent) — all boundary cases from the spec are exercised
