import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { Side } from "../../../data/types";
import { SIDE_COLORS_UI, SIDE_BG_COLORS } from "../../../config/sideColors";
import { useEngine } from "../../../hooks/useEngine";
import { useCustomize } from "../../../hooks/useCustomize";
import { useI18n } from "../../../hooks/useLocale";
import styles from "./SidePanel.module.css";
import type { SideEquipmentStats } from "../../../playback/eventManager";

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV"];

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  car: "Wheeled",
  tank: "Armor",
  apc: "APC",
  truck: "Truck",
  ship: "Naval",
  heli: "Helicopter",
  plane: "Fixed Wing",
  staticWeapon: "Static Wpn",
  staticMortar: "Mortar",
  unknown: "Other",
};

const SIDE_LABELS: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
};

interface SideStats {
  side: Side;
  total: number;
  alive: number;
  kills: number;
  deaths: number;
}

interface LeaderboardEntry {
  name: string;
  side: Side;
  kills: number;
  deaths: number;
  vehicleKills: number;
}

export function StatsTab(): JSX.Element {
  const engine = useEngine();
  const customize = useCustomize();
  const { t } = useI18n();
  const showPlayerKillCount = (): boolean => !customize().disableKillCount;

  // Frame-aware kill/death counts
  const killDeathCounts = createMemo(() =>
    engine.eventManager.getKillDeathCounts(engine.currentFrame()),
  );

  const groupKills = createMemo(() =>
    engine.eventManager.getGroupKills(engine.currentFrame()),
  );

  const equipmentLosses = createMemo(() =>
    engine.eventManager.getEquipmentLosses(engine.currentFrame()),
  );

  // Reactive array of sides that have any equipment data — drives <For> so it
  // re-renders reactively (static SIDES array inside <For> loses tracking).
  const equipmentBySide = createMemo(() =>
    SIDES.flatMap((side) => {
      const eq = equipmentLosses().get(side);
      if (!eq || (eq.destroyed.size === 0 && eq.lost_combat.size === 0 && eq.lost_captured.size === 0 && eq.captured.size === 0)) return [];
      return [{ side, eq }];
    }),
  );

  const [groupsExpanded, setGroupsExpanded] = createSignal(true);
  const [equipExpanded, setEquipExpanded] = createSignal(true);

  const sideStats = createMemo((): SideStats[] => {
    const snaps = engine.entitySnapshots();
    const units = engine.entityManager.getUnits();
    const { kills, deaths } = killDeathCounts();
    return SIDES.map((side) => {
      const sideUnits = units.filter((u) => u.side === side);
      const total = sideUnits.length;
      let alive = 0;
      for (const u of sideUnits) {
        const snap = snaps.get(u.id);
        if (snap && snap.alive) alive++;
      }
      const sideKills = sideUnits.reduce((s, u) => s + (kills.get(u.id) ?? 0), 0);
      const sideDeaths = sideUnits.reduce((s, u) => s + (deaths.get(u.id) ?? 0), 0);
      return { side, total, alive, kills: sideKills, deaths: sideDeaths };
    }).filter((s) => s.total > 0);
  });

  const leaderboard = createMemo((): LeaderboardEntry[] => {
    const units = engine.entityManager.getUnits();
    const { kills, deaths, vehicleKills } = killDeathCounts();
    return units
      .filter((u) => u.isPlayer && (
        (kills.get(u.id) ?? 0) > 0 ||
        (deaths.get(u.id) ?? 0) > 0 ||
        (vehicleKills.get(u.id) ?? 0) > 0
      ))
      .sort((a, b) => {
        const diff = (kills.get(b.id) ?? 0) - (kills.get(a.id) ?? 0);
        if (diff !== 0) return diff;
        return (vehicleKills.get(b.id) ?? 0) - (vehicleKills.get(a.id) ?? 0);
      })
      .map((u) => ({
        name: u.name || `Unit ${u.id}`,
        side: u.side,
        kills: kills.get(u.id) ?? 0,
        deaths: deaths.get(u.id) ?? 0,
        vehicleKills: vehicleKills.get(u.id) ?? 0,
      }));
  });

  return (
    <div class={styles.tabContent}>
      <div class={styles.statsContainer}>
        {/* Force summary */}
        <div>
          <div class={styles.statsLabel}>{t("force_summary")}</div>
          <div class={styles.forceSummary} style={{ "margin-top": "8px" }}>
            <For each={sideStats()}>
              {(stat) => {
                return (
                  <div
                    class={styles.forceCard}
                    style={{
                      background: SIDE_BG_COLORS[stat.side],
                      border: `1px solid ${SIDE_COLORS_UI[stat.side]}20`,
                    }}
                  >
                    <div class={styles.forceCardHeader}>
                      <span
                        class={styles.forceCardDot}
                        style={{ background: SIDE_COLORS_UI[stat.side] }}
                      />
                      <span
                        class={styles.forceCardLabel}
                        style={{ color: SIDE_COLORS_UI[stat.side] }}
                      >
                        {SIDE_LABELS[stat.side]}
                      </span>
                    </div>
                    <div class={styles.forceStatGrid}>
                      <div class={styles.forceStatPill}>
                        <div class={`${styles.forceStatNum} ${styles.forceStatNumTotal}`}>
                          {stat.total}
                        </div>
                        <div class={styles.forceStatLabel}>{t("total")}</div>
                      </div>
                      <div class={styles.forceStatPill}>
                        <div class={`${styles.forceStatNum} ${styles.forceStatNumAlive}`}>
                          {stat.alive}
                        </div>
                        <div class={styles.forceStatLabel}>{t("alive")}</div>
                      </div>
                      <div class={styles.forceStatPill}>
                        <div
                          class={styles.forceStatNum}
                          classList={{ [styles.forceStatNumKills]: stat.kills > 0 }}
                        >
                          {stat.kills}
                        </div>
                        <div class={styles.forceStatLabel}>{t("kills_label")}</div>
                      </div>
                      <div class={styles.forceStatPill}>
                        <div
                          class={styles.forceStatNum}
                          classList={{ [styles.forceStatNumDeaths]: stat.deaths > 0 }}
                        >
                          {stat.deaths}
                        </div>
                        <div class={styles.forceStatLabel}>{t("deaths_label")}</div>
                      </div>
                    </div>
                  </div>
                );
              }}
            </For>
          </div>
        </div>

        {/* Group kills — all units including AI, grouped by side */}
        <Show when={groupKills().length > 0}>
          <div>
            <button
              style={{ display: "flex", "align-items": "center", gap: "6px", background: "none", border: "none", padding: "0", cursor: "pointer", width: "100%" }}
              onClick={() => setGroupsExpanded(!groupsExpanded())}
            >
              <div class={styles.statsLabel}>{t("by_group")}</div>
              <span style={{ color: "var(--text-dimmer)", "font-size": "10px", "margin-left": "auto" }}>
                {groupsExpanded() ? "▲" : "▼"}
              </span>
            </button>
            <Show when={groupsExpanded()}>
              <div style={{ "margin-top": "8px", display: "flex", "flex-direction": "column", gap: "2px" }}>
                <For each={SIDES}>
                  {(side) => {
                    const sideGroups = groupKills()
                      .filter((g) => g.side === side)
                      .sort((a, b) => b.kills - a.kills);
                    return (
                      <Show when={sideGroups.length > 0}>
                        <div style={{ "margin-bottom": "4px" }}>
                          <div style={{ display: "flex", "align-items": "center", gap: "5px", padding: "3px 0", "border-bottom": `1px solid ${SIDE_COLORS_UI[side]}30`, "margin-bottom": "3px" }}>
                            <span style={{ width: "7px", height: "7px", "border-radius": "2px", background: SIDE_COLORS_UI[side], display: "inline-block", "flex-shrink": "0" }} />
                            <span style={{ color: SIDE_COLORS_UI[side], "font-size": "10px", "font-family": "var(--font-mono)", "font-weight": "700", "letter-spacing": "0.08em" }}>
                              {SIDE_LABELS[side]}
                            </span>
                          </div>
                          <For each={sideGroups}>
                            {(g) => (
                              <div style={{ display: "flex", "align-items": "center", gap: "6px", padding: "3px 6px", "font-family": "var(--font-mono)", "font-size": "11px" }}>
                                <span style={{ flex: "1", color: "var(--text-secondary)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                                  {g.groupName || t("ungrouped")}
                                </span>
                                <span style={{ color: "var(--text-dimmest)", "font-size": "10px" }}>
                                  {g.playerCount}P/{g.unitCount - g.playerCount}AI
                                </span>
                                <span style={{ color: "var(--accent-danger)", "min-width": "28px", "text-align": "right" }}>K:{g.kills}</span>
                                <span style={{ color: "var(--accent-primary)", "min-width": "28px", "text-align": "right" }}>VK:{g.vehicleKills}</span>
                                <span style={{ color: "var(--accent-warning)", "min-width": "28px", "text-align": "right" }}>D:{g.deaths}</span>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Equipment losses/destructions per side */}
        <Show when={equipmentBySide().length > 0}>
          <div>
            <button
              style={{ display: "flex", "align-items": "center", gap: "6px", background: "none", border: "none", padding: "0", cursor: "pointer", width: "100%" }}
              onClick={() => setEquipExpanded(!equipExpanded())}
            >
              <div class={styles.statsLabel}>{t("equipment")}</div>
              <span style={{ color: "var(--text-dimmer)", "font-size": "10px", "margin-left": "auto" }}>
                {equipExpanded() ? "▲" : "▼"}
              </span>
            </button>
            <Show when={equipExpanded()}>
              <div style={{ "margin-top": "8px", display: "flex", "flex-direction": "column", gap: "6px" }}>
                <For each={equipmentBySide()}>
                  {({ side, eq }: { side: Side; eq: SideEquipmentStats }) => {
                    const formatCounts = (m: Map<string, number>) =>
                      Array.from(m.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, count]) => `${count}× ${VEHICLE_TYPE_LABELS[type] ?? type}`)
                        .join(", ");
                    return (
                      <div style={{ background: SIDE_BG_COLORS[side], "border-radius": "6px", padding: "8px 10px", border: `1px solid ${SIDE_COLORS_UI[side]}20` }}>
                        <div style={{ display: "flex", "align-items": "center", gap: "5px", "margin-bottom": "6px" }}>
                          <span style={{ width: "7px", height: "7px", "border-radius": "2px", background: SIDE_COLORS_UI[side], display: "inline-block" }} />
                          <span style={{ color: SIDE_COLORS_UI[side], "font-size": "10px", "font-family": "var(--font-mono)", "font-weight": "700", "letter-spacing": "0.08em" }}>
                            {SIDE_LABELS[side]}
                          </span>
                        </div>
                        <Show when={eq.destroyed.size > 0}>
                          <div style={{ "font-size": "10px", "font-family": "var(--font-mono)", "margin-bottom": "3px" }}>
                            <span style={{ color: "var(--accent-danger)", "font-weight": "600" }}>{t("destroyed")}: </span>
                            <span style={{ color: "var(--text-muted)" }}>{formatCounts(eq.destroyed)}</span>
                          </div>
                        </Show>
                        <Show when={eq.lost_combat.size > 0}>
                          <div style={{ "font-size": "10px", "font-family": "var(--font-mono)", "margin-bottom": "3px" }}>
                            <span style={{ color: "var(--accent-warning)", "font-weight": "600" }}>{t("lost_combat")}: </span>
                            <span style={{ color: "var(--text-muted)" }}>{formatCounts(eq.lost_combat)}</span>
                          </div>
                        </Show>
                        <Show when={eq.lost_captured.size > 0}>
                          <div style={{ "font-size": "10px", "font-family": "var(--font-mono)", "margin-bottom": "3px" }}>
                            <span style={{ color: "var(--accent-warning)", "font-weight": "600" }}>{t("lost_captured")}: </span>
                            <span style={{ color: "var(--text-muted)" }}>{formatCounts(eq.lost_captured)}</span>
                          </div>
                        </Show>
                        <Show when={eq.captured.size > 0}>
                          <div style={{ "font-size": "10px", "font-family": "var(--font-mono)" }}>
                            <span style={{ color: "var(--accent-success)", "font-weight": "600" }}>{t("veh_captured")}: </span>
                            <span style={{ color: "var(--text-muted)" }}>{formatCounts(eq.captured)}</span>
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* Leaderboard */}
        <Show when={showPlayerKillCount() && leaderboard().length > 0}>
          <div>
            <div class={styles.statsLabel}>{t("leaderboard")}</div>
            <div class={styles.leaderboard} style={{ "margin-top": "8px" }}>
              <div
                class={styles.leaderboardRow}
                style={{ "margin-bottom": "4px" }}
              >
                <span class={styles.leaderboardRank}>#</span>
                <span class={styles.leaderboardName} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  {t("name")}
                </span>
                <span class={styles.leaderboardKills} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  K
                </span>
                <span class={styles.leaderboardVehicleKills} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  VK
                </span>
                <span class={styles.leaderboardDeaths} style={{ color: "var(--text-dimmer)", "font-size": "9px" }}>
                  D
                </span>
              </div>
              <For each={leaderboard()}>
                {(entry, i) => (
                  <div
                    class={styles.leaderboardRow}
                    classList={{ [styles.leaderboardRowAlt]: i() % 2 === 1 }}
                  >
                    <span class={styles.leaderboardRank}>{i() + 1}</span>
                    <span
                      class={styles.leaderboardName}
                      style={{ color: SIDE_COLORS_UI[entry.side] }}
                    >
                      {entry.name}
                    </span>
                    <span class={styles.leaderboardKills}>{entry.kills}</span>
                    <span class={styles.leaderboardVehicleKills}>{entry.vehicleKills}</span>
                    <span class={styles.leaderboardDeaths}>{entry.deaths}</span>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
