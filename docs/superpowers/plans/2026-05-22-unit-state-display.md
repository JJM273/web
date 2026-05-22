# Unit State Display: 3-State Styling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary alive/dead unit styling in the Units tab with three distinct states — Alive, Dead (killed by a kill event), and Inactive (despawned/pre-spawn, never killed) — so players can distinguish combat deaths from server cleanup in missions like Antistasi.

**Architecture:** Replace the `isAlive(unitId): boolean` function in `UnitsTab.tsx` with `getUnitStatus(unitId): UnitStatus` that returns `'alive' | 'dead' | 'inactive'`. The "dead" state is determined by `killDeathCounts().deaths`, which is already a frame-aware reactive memo in the component — no new state or data sources needed. CSS gains two new classes and renames two existing ones.

**Tech Stack:** SolidJS (signals, memos, JSX `classList`), CSS Modules, Vitest + @solidjs/testing-library

---

### Task 1: Update existing test and add three new tests for 3-state behaviour

**Files:**
- Modify: `ui/src/pages/recording-playback/__tests__/UnitsTab.test.tsx`

> Background: the existing test "counts deleted units as dead and styles them" expects `unitRowDead` for a despawned-without-kill unit. Under the new design that should be `unitRowInactive`. We also need tests for the two new states.

- [ ] **Step 1: Update the existing "deleted units" test**

Find the test `"counts deleted units as dead and styles them"` (currently around line 230) and replace it with:

```tsx
it("styles a despawned unit (no kill event) as inactive", () => {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(
    makeManifest([
      unitDef({
        id: 1,
        name: "Alive Unit",
        side: "WEST",
        groupName: "Alpha",
        role: "Grenadier",
        positions: [
          { position: [100, 200], direction: 0, alive: 1 },
          { position: [100, 200], direction: 0, alive: 1 },
        ],
      }),
      unitDef({
        id: 2,
        name: "Deleted Unit",
        side: "WEST",
        groupName: "Alpha",
        endFrame: 1,
        role: "Autorifleman",
        positions: [{ position: [100, 200], direction: 0, alive: 1 }],
      }),
    ]),
  );

  engine.seekTo(1);

  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <UnitsTab />
    </TestProviders>
  ));

  // Unit despawned without a kill event → inactive styling, not dead
  const deletedRow = screen.getByText("Deleted Unit").closest("button");
  expect(deletedRow?.className).toMatch(/unitRowInactive/);
  expect(deletedRow?.className).not.toMatch(/unitRowDead/);
});
```

- [ ] **Step 2: Add test — killed unit shows dead styling**

After the test above, add:

```tsx
it("styles a unit killed by a kill event as dead", () => {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(
    makeManifest(
      [
        unitDef({
          id: 1,
          name: "Victim",
          side: "WEST",
          groupName: "Alpha",
          role: "Trooper",
          positions: [
            { position: [100, 200], direction: 0, alive: 1 },
            { position: [100, 200], direction: 0, alive: 0 }, // dead at frame 1
          ],
        }),
        unitDef({
          id: 2,
          name: "Killer",
          side: "EAST",
          groupName: "Bravo",
          role: "Trooper",
          positions: [
            { position: [50, 50], direction: 0, alive: 1 },
            { position: [50, 50], direction: 0, alive: 1 },
          ],
        }),
      ],
      [killedEvent(1, 1, 2)],
    ),
  );

  setActiveSide("WEST");
  engine.seekTo(1);

  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <UnitsTab />
    </TestProviders>
  ));

  const row = screen.getByText("Victim").closest("button");
  expect(row?.className).toMatch(/unitRowDead/);
  expect(row?.className).not.toMatch(/unitRowInactive/);
});
```

- [ ] **Step 3: Add test — killed unit whose body later despawns still shows dead styling**

```tsx
it("keeps dead styling for a killed unit even after body despawns", () => {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(
    makeManifest(
      [
        unitDef({
          id: 1,
          name: "Victim",
          side: "WEST",
          groupName: "Alpha",
          role: "Trooper",
          endFrame: 3, // body despawns at frame 3
          positions: [
            { position: [100, 200], direction: 0, alive: 1 },
            { position: [100, 200], direction: 0, alive: 0 },
            { position: [100, 200], direction: 0, alive: 0 },
            { position: [100, 200], direction: 0, alive: 0 },
          ],
        }),
        unitDef({
          id: 2,
          name: "Killer",
          side: "EAST",
          groupName: "Bravo",
          role: "Trooper",
          positions: [
            { position: [50, 50], direction: 0, alive: 1 },
            { position: [50, 50], direction: 0, alive: 1 },
          ],
        }),
      ],
      [killedEvent(1, 1, 2)],
    ),
  );

  setActiveSide("WEST");
  engine.seekTo(10); // well beyond endFrame=3, no snapshot for unit 1

  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <UnitsTab />
    </TestProviders>
  ));

  // No snapshot but deaths=1 → still dead, not inactive
  const row = screen.getByText("Victim").closest("button");
  expect(row?.className).toMatch(/unitRowDead/);
  expect(row?.className).not.toMatch(/unitRowInactive/);
});
```

- [ ] **Step 4: Add test — respawned unit with prior death shows as alive**

```tsx
it("styles a respawned unit as alive even when they have prior deaths", () => {
  const { engine, renderer } = createTestEngine();
  engine.loadRecording(
    makeManifest(
      [
        unitDef({
          id: 1,
          name: "Respawner",
          side: "WEST",
          groupName: "Alpha",
          role: "Trooper",
          positions: [
            { position: [100, 200], direction: 0, alive: 1 },
            { position: [100, 200], direction: 0, alive: 0 }, // killed
            { position: [200, 300], direction: 0, alive: 1 }, // respawned
          ],
        }),
        unitDef({
          id: 2,
          name: "Killer",
          side: "EAST",
          groupName: "Bravo",
          role: "Trooper",
          positions: [
            { position: [50, 50], direction: 0, alive: 1 },
            { position: [50, 50], direction: 0, alive: 1 },
            { position: [50, 50], direction: 0, alive: 1 },
          ],
        }),
      ],
      [killedEvent(1, 1, 2)],
    ),
  );

  setActiveSide("WEST");
  engine.seekTo(2); // respawned frame — alive=1 in snapshot, deaths=1 in events

  render(() => (
    <TestProviders engine={engine} renderer={renderer}>
      <UnitsTab />
    </TestProviders>
  ));

  const row = screen.getByText("Respawner").closest("button");
  // Alive in snapshot takes priority — no dead or inactive class
  expect(row?.className).not.toMatch(/unitRowDead/);
  expect(row?.className).not.toMatch(/unitRowInactive/);
});
```

- [ ] **Step 5: Run tests and confirm the four affected tests fail**

```bash
cd ui && npx vitest run src/pages/recording-playback/__tests__/UnitsTab.test.tsx
```

Expected: 4 failures (the updated test + 3 new tests). All others should still pass.

---

### Task 2: Update CSS classes in SidePanel.module.css

**Files:**
- Modify: `ui/src/pages/recording-playback/components/SidePanel.module.css`

> The current `unitRowDead` / `unitNameDead` classes become `unitRowInactive` / `unitNameInactive`. New `unitRowDead` / `unitNameDead` classes use `--accent-warning` (#FFB84A) to signal a combat death.

- [ ] **Step 1: Rename `unitRowDead` to `unitRowInactive` and add new `unitRowDead`**

Find:
```css
.unitRowDead {
  opacity: 0.45;
}
```

Replace with:
```css
.unitRowInactive {
  opacity: 0.45;
}

.unitRowDead {
  background: color-mix(in srgb, var(--accent-warning) 6%, transparent);
}
```

- [ ] **Step 2: Rename `unitNameDead` to `unitNameInactive` and add new `unitNameDead`**

Find:
```css
.unitNameDead {
  color: var(--text-dimmer);
}
```

Replace with:
```css
.unitNameInactive {
  color: var(--text-dimmer);
}

.unitNameDead {
  color: color-mix(in srgb, var(--accent-warning) 70%, transparent);
}
```

- [ ] **Step 3: Verify no other files reference the old class names**

```bash
grep -rn "unitRowDead\|unitNameDead" /Users/jaymorehart/GitRepos/OCAP/web/ui/src --include="*.tsx" --include="*.ts"
```

Expected output: only `UnitsTab.tsx` (which we're about to fix in Task 3). If any other files reference these names, update them too before continuing.

---

### Task 3: Implement `getUnitStatus` in UnitsTab.tsx

**Files:**
- Modify: `ui/src/pages/recording-playback/components/UnitsTab.tsx`

- [ ] **Step 1: Add `UnitStatus` type and replace `isAlive` + `killDeathCounts` ordering**

Find this block (around lines 72–80):
```typescript
  const isAlive = (unitId: number): boolean => {
    const snap = engine.entitySnapshots().get(unitId);
    return snap ? !!snap.alive : false;
  };

  // Frame-aware kill counts
  const killDeathCounts = createMemo(() =>
    engine.eventManager.getKillDeathCounts(engine.currentFrame()),
  );
```

Replace with:
```typescript
  // Frame-aware kill counts
  const killDeathCounts = createMemo(() =>
    engine.eventManager.getKillDeathCounts(engine.currentFrame()),
  );

  const getUnitStatus = (unitId: number): "alive" | "dead" | "inactive" => {
    const snap = engine.entitySnapshots().get(unitId);
    if (snap && snap.alive) return "alive";
    if ((killDeathCounts().deaths.get(unitId) ?? 0) > 0) return "dead";
    return "inactive";
  };
```

- [ ] **Step 2: Update `aliveCount` to use `getUnitStatus`**

Find:
```typescript
  const aliveCount = (units: Unit[]): number => {
    // Access snapshots for reactivity
    engine.entitySnapshots();
    let count = 0;
    for (const u of units) {
      if (isAlive(u.id)) count++;
    }
    return count;
  };
```

Replace with:
```typescript
  const aliveCount = (units: Unit[]): number => {
    // Access both reactive sources so this recomputes on snapshot or kill-event changes
    engine.entitySnapshots();
    killDeathCounts();
    let count = 0;
    for (const u of units) {
      if (getUnitStatus(u.id) === "alive") count++;
    }
    return count;
  };
```

- [ ] **Step 3: Update JSX — replace `alive` local signal with `status`**

Find this block inside the `<For each={group.units}>` render function (around lines 187–216):
```tsx
                    {(unit) => {
                      const alive = () => isAlive(unit.id);
                      const selected = () => selectedUnit() === unit.id;
                      return (
                        <>
                          <button
                            class={styles.unitRow}
                            classList={{
                              [styles.unitRowSelected]: selected(),
                              [styles.unitRowDead]: !alive(),
                            }}
```

Replace with:
```tsx
                    {(unit) => {
                      const status = () => getUnitStatus(unit.id);
                      const selected = () => selectedUnit() === unit.id;
                      return (
                        <>
                          <button
                            class={styles.unitRow}
                            classList={{
                              [styles.unitRowSelected]: selected(),
                              [styles.unitRowDead]: status() === "dead",
                              [styles.unitRowInactive]: status() === "inactive",
                            }}
```

- [ ] **Step 4: Update unit name `classList` bindings**

Find:
```tsx
                            <span
                              class={styles.unitName}
                              classList={{
                                [styles.unitNameAlive]: alive(),
                                [styles.unitNameDead]: !alive(),
                              }}
```

Replace with:
```tsx
                            <span
                              class={styles.unitName}
                              classList={{
                                [styles.unitNameAlive]: status() === "alive",
                                [styles.unitNameDead]: status() === "dead",
                                [styles.unitNameInactive]: status() === "inactive",
                              }}
```

---

### Task 4: Verify all tests pass and commit

**Files:** none — verification only

- [ ] **Step 1: Run the full UnitsTab test suite**

```bash
cd /Users/jaymorehart/GitRepos/OCAP/web/ui && npx vitest run src/pages/recording-playback/__tests__/UnitsTab.test.tsx
```

Expected: all tests pass (19 original + 3 new = 22 total, with one renamed).

- [ ] **Step 2: Run the full test suite to check for regressions**

```bash
cd /Users/jaymorehart/GitRepos/OCAP/web/ui && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add ui/src/pages/recording-playback/__tests__/UnitsTab.test.tsx \
        ui/src/pages/recording-playback/components/UnitsTab.tsx \
        ui/src/pages/recording-playback/components/SidePanel.module.css
git commit -m "$(cat <<'EOF'
feat(ui): 3-state unit styling — alive, dead (killed), inactive (despawned)

Units tab now distinguishes combat deaths (orange, kill event required) from
despawned or pre-spawn units (greyed out), fixing false dead-styling in missions
with frequent server-side cleanup (e.g. Antistasi). Respawned players correctly
return to alive styling.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
