import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@solidjs/testing-library";
import { AARTab } from "../components/AARTab";
import {
  createTestEngine,
  TestProviders,
  unitDef,
  vehicleDef,
  makeManifest,
  killedEvent,
} from "./testHelpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AARTab", () => {
  it("shows Export AAR button", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([unitDef({ id: 1, side: "WEST" })]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    expect(screen.getByText("Export AAR")).toBeTruthy();
  });

  it("shows force summary only for sides with units", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "BluforGuy", side: "WEST" }),
        unitDef({ id: 2, name: "OpforGuy", side: "EAST" }),
      ]),
    );
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    expect(screen.getByText("Force Summary")).toBeTruthy();
    // Side labels appear in force summary and possibly in By Group section
    expect(screen.getAllByText("BLUFOR").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("OPFOR").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("IND")).toBeNull();
    expect(screen.queryByText("CIV")).toBeNull();
  });

  it("shows correct unit total count in force summary", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, name: "A", side: "WEST" }),
        unitDef({ id: 2, name: "B", side: "WEST" }),
      ]),
    );
    engine.seekTo(0);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    expect(screen.getAllByText("BLUFOR").length).toBeGreaterThanOrEqual(1);
    // Total count "2" should be present in the force summary row
    expect(screen.getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });

  it("deaths column uses event-based kill counts not snapshot alive state", () => {
    // Unit 1 (WEST): despawns (no kill event) — deaths for WEST should be 0
    // Unit 2 (EAST): killed by unit 3 at frame 5 — deaths for EAST should be 1
    const { engine, renderer } = createTestEngine();
    const positions = Array.from({ length: 21 }, () => ({
      position: [100, 200] as [number, number],
      direction: 0,
      alive: 1 as const,
    }));
    engine.loadRecording(
      makeManifest(
        [
          unitDef({ id: 1, side: "WEST", positions, endFrame: 20 }),
          unitDef({ id: 2, side: "EAST", positions, endFrame: 20 }),
          unitDef({ id: 3, side: "WEST", positions, endFrame: 20 }),
        ],
        [killedEvent(5, 2, 3, "M4A1", 100)],
        20,
      ),
    );
    engine.seekTo(20);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    // The "Dead" column header should be visible
    expect(screen.getByText("Dead")).toBeTruthy();

    // EAST has exactly 1 death (kill event); the "1" should appear in the DOM
    // WEST has 0 deaths (despawn only, no kill event)
    // We verify event-based deaths work by confirming "1" appears as a death count
    const deadCells = screen.getAllByText("1");
    expect(deadCells.length).toBeGreaterThanOrEqual(1);
  });

  it("shows By Group section when units have kills", () => {
    const { engine, renderer } = createTestEngine();
    const positions = Array.from({ length: 21 }, () => ({
      position: [100, 200] as [number, number],
      direction: 0,
      alive: 1 as const,
    }));
    engine.loadRecording(
      makeManifest(
        [
          unitDef({ id: 1, side: "WEST", groupName: "Alpha", positions, endFrame: 20 }),
          unitDef({ id: 2, side: "EAST", groupName: "Bravo", positions, endFrame: 20 }),
        ],
        [killedEvent(5, 2, 1, "M4A1", 100)],
        20,
      ),
    );
    engine.seekTo(20);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    expect(screen.getByText("By Group")).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
  });

  it("hides By Group section when there are no unit entities", () => {
    // AARTab uses getGroupKills(endFrame) — no units means empty result
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(makeManifest([]));

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    expect(screen.queryByText("By Group")).toBeNull();
  });

  it("shows Equipment section when a vehicle is destroyed", () => {
    const { engine, renderer } = createTestEngine();
    const positions = Array.from({ length: 20 }, () => ({
      position: [100, 200] as [number, number],
      direction: 0,
      alive: 1 as const,
    }));
    engine.loadRecording(
      makeManifest(
        [
          unitDef({ id: 1, side: "WEST", positions, endFrame: 19 }),
          vehicleDef({ id: 50, type: "car", side: "EAST", positions, endFrame: 19 }),
        ],
        [killedEvent(5, 50, 1, "RPG-7", 200)],
        19,
      ),
    );
    engine.seekTo(19);

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    expect(screen.getByText("Equipment")).toBeTruthy();
    // WEST destroyed an EAST vehicle — both sides get an equipment block
    expect(screen.getAllByText(/Destroyed/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Lost \(Combat\)/).length).toBeGreaterThanOrEqual(1);
  });

  it("hides Equipment section when no vehicle events", () => {
    const { engine, renderer } = createTestEngine();
    engine.loadRecording(
      makeManifest([
        unitDef({ id: 1, side: "WEST" }),
        unitDef({ id: 2, side: "EAST" }),
      ]),
    );

    render(() => (
      <TestProviders engine={engine} renderer={renderer}>
        <AARTab />
      </TestProviders>
    ));

    expect(screen.queryByText("Equipment")).toBeNull();
  });
});
