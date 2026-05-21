import type { EntityManager } from "./entityManager";
import type { Side } from "../data/types";
import { Unit } from "./entities/unit";
import { Vehicle } from "./entities/vehicle";
import { GameEvent } from "./events/gameEvent";
import { HitKilledEvent } from "./events/hitKilledEvent";

export interface GroupKillStats {
  groupName: string;
  side: Side;
  kills: number;
  deaths: number;
  vehicleKills: number;
  unitCount: number;
  playerCount: number;
}

export interface SideEquipmentStats {
  /** vehicle type → count of enemy vehicles this side destroyed in combat */
  destroyed: Map<string, number>;
  /** vehicle type → count of this side's vehicles destroyed in combat */
  lost_combat: Map<string, number>;
  /** vehicle type → count of this side's vehicles taken by an enemy side */
  lost_captured: Map<string, number>;
  /** vehicle type → count of enemy vehicles this side captured intact */
  captured: Map<string, number>;
}

/** One entry in a vehicle's ownership timeline (sparse: only recorded on change). */
interface OwnershipSnapshot {
  frame: number;
  side: Side | null;
  ownerGroup: string | null;
}

/** A side-change event on a vehicle — the moment it was captured. */
interface VehicleCaptureEvent {
  frame: number;
  vehicleId: number;
  vehicleType: string;
  fromSide: Side | null;
  toSide: Side;
}

const INITIAL_SIDE_WINDOW_MS = 60_000;

/**
 * Manages all mission events for a playback session.
 * Indexes events by frame number for O(1) lookup.
 * Pure data -- NO DOM, NO Leaflet, NO map dependencies.
 */
export class EventManager {
  private events: GameEvent[] = [];
  private frameIndex: Map<number, GameEvent[]> = new Map();
  private entityManagerRef: EntityManager | null = null;
  /** Sparse ownership timeline per vehicle: sorted array of changes, binary-searched by frame. */
  private ownershipTimeline: Map<number, OwnershipSnapshot[]> = new Map();
  /** Capture events produced by processVehicleOwnership, sorted by frame. */
  private vehicleCaptureEvents: VehicleCaptureEvent[] = [];

  /** Add an event and index it by frame number. */
  addEvent(event: GameEvent): void {
    this.events.push(event);

    const existing = this.frameIndex.get(event.frameNum);
    if (existing) {
      existing.push(event);
    } else {
      this.frameIndex.set(event.frameNum, [event]);
    }
  }

  /** Return events that occur exactly at the given frame. O(1) lookup. */
  getEventsAtFrame(frame: number): GameEvent[] {
    return this.frameIndex.get(frame) ?? [];
  }

  /** Return all events where frameNum <= frame (for the event log), sorted ascending by frame. */
  getActiveEvents(frame: number): GameEvent[] {
    return this.events
      .filter((event) => event.frameNum <= frame)
      .sort((a, b) => a.frameNum - b.frameNum);
  }

  /** Return all registered events. */
  getAll(): GameEvent[] {
    return this.events;
  }

  /**
   * Resolve entity references on HitKilledEvent instances.
   * Populates names, sides, and computes kill counts.
   *
   * Kill score formula (matching old frontend):
   *   killCount - (teamKillCount * 2)
   * Only "killed" events with a Unit victim (not Vehicle) increment counts.
   */
  resolveReferences(entityManager: EntityManager): void {
    this.entityManagerRef = entityManager;
    // First pass: resolve names/sides
    for (const event of this.events) {
      if (event instanceof HitKilledEvent) {
        const victim = entityManager.getEntity(event.victimId);
        if (victim) {
          event.victimName = victim.name;
          event.victimIsVehicle = victim instanceof Vehicle;
          if (victim instanceof Unit) {
            event.victimSide = victim.side;
          }
        }

        const causer = entityManager.getEntity(event.causedById);
        if (causer) {
          event.causerName = causer.name;
          if (causer instanceof Unit) {
            event.causerSide = causer.side;
          }
        }
      }
    }

    // Second pass: compute kill counts (events are already sorted by frame)
    for (const event of this.events) {
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;

      const victim = entityManager.getEntity(event.victimId);
      const causer = entityManager.getEntity(event.causedById);

      // Only count kills on Unit victims (not vehicles), skip self-kills.
      // killCount tracks ALL non-self kills (including team kills).
      // teamKillCount additionally tracks same-side kills.
      // Score = killCount - teamKillCount * 2 (matching old frontend).
      if (victim instanceof Unit && causer instanceof Unit) {
        if (event.victimId !== event.causedById) {
          causer.killCount++;
          if (victim.side === causer.side) {
            causer.teamKillCount++;
          }
        }
        // Attach current score to the event (even for self-kills)
        event.causerKillScore = causer.killCount - causer.teamKillCount * 2;
      }

      // Increment death count for the victim
      if (victim instanceof Unit) {
        victim.deathCount++;
      }
    }
  }

  /**
   * Compute per-unit kill and death counts up to (and including) the given frame.
   * Only counts "killed" events on Unit victims (not vehicles), matching resolveReferences logic.
   */
  getKillDeathCounts(frame: number): {
    kills: Map<number, number>;
    deaths: Map<number, number>;
    vehicleKills: Map<number, number>;
  } {
    const kills = new Map<number, number>();
    const deaths = new Map<number, number>();
    const vehicleKills = new Map<number, number>();

    for (const event of this.events) {
      if (event.frameNum > frame) continue;
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;

      if (event.victimIsVehicle) {
        // Vehicle kill for causer (non-self kills only)
        if (event.causedById !== event.victimId) {
          vehicleKills.set(event.causedById, (vehicleKills.get(event.causedById) ?? 0) + 1);
        }
        continue;
      }

      // Death for victim
      deaths.set(event.victimId, (deaths.get(event.victimId) ?? 0) + 1);

      // Kill for causer (non-self kills only)
      if (event.causedById !== event.victimId) {
        kills.set(event.causedById, (kills.get(event.causedById) ?? 0) + 1);
      }
    }

    return { kills, deaths, vehicleKills };
  }

  /**
   * Aggregate kills/deaths by group up to (and including) the given frame.
   * Keyed by `${side}:${groupName}` to avoid collisions across sides.
   * Includes all units (AI and players).
   */
  getGroupKills(frame: number): GroupKillStats[] {
    if (!this.entityManagerRef) return [];
    const { kills, deaths, vehicleKills } = this.getKillDeathCounts(frame);

    const groupMap = new Map<string, GroupKillStats>();
    for (const unit of this.entityManagerRef.getUnits()) {
      const key = `${unit.side}:${unit.groupName}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          groupName: unit.groupName,
          side: unit.side,
          kills: 0,
          deaths: 0,
          vehicleKills: 0,
          unitCount: 0,
          playerCount: 0,
        });
      }
      const stats = groupMap.get(key)!;
      stats.unitCount++;
      if (unit.isPlayer) stats.playerCount++;
      stats.kills += kills.get(unit.id) ?? 0;
      stats.deaths += deaths.get(unit.id) ?? 0;
      stats.vehicleKills += vehicleKills.get(unit.id) ?? 0;
    }
    return Array.from(groupMap.values());
  }

  /**
   * Build ownership timelines for all vehicles and populate vehicleCaptureEvents.
   * Must be called after resolveReferences (needs entityManagerRef set).
   *
   * Ownership rules (positions-format only; streaming format deferred):
   * - Initial owner: first frame where a crew member is a known Unit.
   * - Side change: fires a VehicleCaptureEvent and updates current owner.
   * - Same-side group change: transfers ownership if
   *     (a) player boards an AI-only vehicle (player exception), or
   *     (b) previous owner group has fully exited (exclusive rule).
   */
  processVehicleOwnership(entityManager: EntityManager, captureDelayMs: number): void {
    this.ownershipTimeline = new Map();
    this.vehicleCaptureEvents = [];

    for (const vehicle of entityManager.getVehicles()) {
      if (!vehicle.positions) continue;

      const changes: OwnershipSnapshot[] = [];
      let currentSide: Side | null = vehicle.staticSide ?? null;
      let currentOwnerGroupKey: string | null = null;

      changes.push({ frame: vehicle.startFrame, side: currentSide, ownerGroup: null });

      for (let i = 0; i < vehicle.positions.length; i++) {
        const state = vehicle.positions[i];
        const absoluteFrame = vehicle.startFrame + i;
        const crewIds = state.crewIds ?? [];
        if (crewIds.length === 0) continue;

        const crewUnits: Unit[] = [];
        for (const id of crewIds) {
          const entity = entityManager.getEntity(id);
          if (!(entity instanceof Unit)) continue;
          // Skip dead crew — Arma keeps corpses in crewIds, which would
          // falsely revert ownership to a prior side's dead occupants.
          if (entity.positions) {
            const unitRelFrame = absoluteFrame - entity.startFrame;
            if (unitRelFrame < 0 || unitRelFrame >= entity.positions.length) continue;
            if (!entity.positions[unitRelFrame]?.alive) continue;
          }
          crewUnits.push(entity);
        }
        if (crewUnits.length === 0) continue;

        const newSide = crewUnits[0].side;
        const playerInCrew = crewUnits.find((u) => u.isPlayer);
        const representativeUnit = playerInCrew ?? crewUnits[0];
        const newGroupKey = `${newSide}:${representativeUnit.groupName}`;

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
        } else if (newSide !== currentSide) {
          // Side changed — capture event
          this.vehicleCaptureEvents.push({
            frame: absoluteFrame,
            vehicleId: vehicle.id,
            vehicleType: vehicle.vehicleType || "unknown",
            fromSide: currentSide,
            toSide: newSide,
          });
          currentSide = newSide;
          currentOwnerGroupKey = newGroupKey;
          changes.push({ frame: absoluteFrame, side: currentSide, ownerGroup: representativeUnit.groupName });
        } else if (newGroupKey !== currentOwnerGroupKey) {
          // Same side, different group — check transfer conditions
          const currentOwnerCrew = crewUnits.filter(
            (u) => `${u.side}:${u.groupName}` === currentOwnerGroupKey,
          );
          const currentOwnerHasPlayer = currentOwnerCrew.some((u) => u.isPlayer);
          const currentOwnerStillPresent = currentOwnerCrew.length > 0;

          const playerException = !!playerInCrew && !currentOwnerHasPlayer;
          const exclusiveRule = !currentOwnerStillPresent;

          if (playerException || exclusiveRule) {
            currentOwnerGroupKey = newGroupKey;
            changes.push({ frame: absoluteFrame, side: currentSide, ownerGroup: representativeUnit.groupName });
          }
        }
      }

      this.ownershipTimeline.set(vehicle.id, changes);
    }

    // Sort capture events by frame (vehicles are processed in arbitrary order)
    this.vehicleCaptureEvents.sort((a, b) => a.frame - b.frame);
  }

  /** Return the ownership snapshot for a vehicle at the given absolute frame (linear scan of sparse changes). */
  private getVehicleOwnershipAtFrame(vehicleId: number, frame: number): OwnershipSnapshot {
    const changes = this.ownershipTimeline.get(vehicleId);
    if (!changes || changes.length === 0) return { frame: 0, side: null, ownerGroup: null };
    let result = changes[0];
    for (const change of changes) {
      if (change.frame <= frame) result = change;
      else break;
    }
    return result;
  }

  /**
   * Compute vehicle losses, destructions, and captures per side up to the given frame.
   * Uses the pre-computed ownership timeline from processVehicleOwnership.
   *
   * destroyed    = enemy vehicles this side killed in combat
   * lost_combat  = this side's vehicles destroyed in combat
   * lost_captured = this side's vehicles taken intact by an enemy side
   * captured     = enemy vehicles this side took intact
   */
  getEquipmentLosses(frame: number): Map<Side, SideEquipmentStats> {
    const em = this.entityManagerRef;
    if (!em) return new Map();

    const result = new Map<Side, SideEquipmentStats>();
    const ensureSide = (side: Side): SideEquipmentStats => {
      if (!result.has(side)) {
        result.set(side, {
          destroyed: new Map(),
          lost_combat: new Map(),
          lost_captured: new Map(),
          captured: new Map(),
        });
      }
      return result.get(side)!;
    };
    const inc = (m: Map<string, number>, key: string) =>
      m.set(key, (m.get(key) ?? 0) + 1);

    // Capture events (side changes on vehicles)
    for (const ev of this.vehicleCaptureEvents) {
      if (ev.frame > frame) break;
      if (ev.fromSide) inc(ensureSide(ev.fromSide).lost_captured, ev.vehicleType);
      inc(ensureSide(ev.toSide).captured, ev.vehicleType);
    }

    // Combat kills on vehicles
    for (const event of this.events) {
      if (event.frameNum > frame) continue;
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;
      if (!event.victimIsVehicle) continue;

      const victim = em.getEntity(event.victimId);
      const causer = em.getEntity(event.causedById);
      if (!(victim instanceof Vehicle)) continue;

      const vehicleType = victim.vehicleType || "unknown";

      let causerSide: Side | null = null;
      if (causer instanceof Unit) {
        causerSide = causer.side;
      } else if (causer instanceof Vehicle) {
        causerSide = this.getVehicleOwnershipAtFrame(causer.id, event.frameNum).side;
      }

      if (causerSide) inc(ensureSide(causerSide).destroyed, vehicleType);

      const victimSide = this.getVehicleOwnershipAtFrame(victim.id, event.frameNum).side;
      if (victimSide) inc(ensureSide(victimSide).lost_combat, vehicleType);
    }

    return result;
  }

  /** Remove all events and clear the frame index. */
  clear(): void {
    this.events = [];
    this.frameIndex = new Map();
    this.entityManagerRef = null;
    this.ownershipTimeline = new Map();
    this.vehicleCaptureEvents = [];
  }
}
