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
  /** vehicle type → count of enemy vehicles this side destroyed */
  destroyed: Map<string, number>;
  /** vehicle type → count of this side's vehicles that were lost */
  lost: Map<string, number>;
}

/**
 * Manages all mission events for a playback session.
 * Indexes events by frame number for O(1) lookup.
 * Pure data -- NO DOM, NO Leaflet, NO map dependencies.
 */
export class EventManager {
  private events: GameEvent[] = [];
  private frameIndex: Map<number, GameEvent[]> = new Map();
  private entityManagerRef: EntityManager | null = null;

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
   * Compute vehicle losses and destructions per side up to the given frame.
   * "destroyed" = vehicles of other sides this side killed.
   * "lost" = this side's vehicles that were killed (derived from crew side).
   */
  getEquipmentLosses(frame: number): Map<Side, SideEquipmentStats> {
    const em = this.entityManagerRef;
    if (!em) return new Map();

    const result = new Map<Side, SideEquipmentStats>();
    const ensureSide = (side: Side): SideEquipmentStats => {
      if (!result.has(side)) {
        result.set(side, { destroyed: new Map(), lost: new Map() });
      }
      return result.get(side)!;
    };

    for (const event of this.events) {
      if (event.frameNum > frame) continue;
      if (!(event instanceof HitKilledEvent)) continue;
      if (event.type !== "killed") continue;
      if (!event.victimIsVehicle) continue;

      const victim = em.getEntity(event.victimId);
      const causer = em.getEntity(event.causedById);
      if (!(victim instanceof Vehicle)) continue;

      const vehicleType = victim.vehicleType || "unknown";

      if (causer instanceof Unit) {
        const causerStats = ensureSide(causer.side);
        causerStats.destroyed.set(
          vehicleType,
          (causerStats.destroyed.get(vehicleType) ?? 0) + 1,
        );
      }

      const vehicleSide = victim.getSideFromCrew((id) => em.getEntity(id));
      if (vehicleSide) {
        const victimStats = ensureSide(vehicleSide);
        victimStats.lost.set(
          vehicleType,
          (victimStats.lost.get(vehicleType) ?? 0) + 1,
        );
      }
    }
    return result;
  }

  /** Remove all events and clear the frame index. */
  clear(): void {
    this.events = [];
    this.frameIndex = new Map();
    this.entityManagerRef = null;
  }
}
