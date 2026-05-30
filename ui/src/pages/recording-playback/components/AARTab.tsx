import { createMemo, createSignal, For, Show } from "solid-js";
import type { JSX, Accessor } from "solid-js";
import { SIDE_COLORS_UI, SIDE_BG_COLORS } from "../../../config/sideColors";
import type { Side, ActionDefinition } from "../../../data/types";
import { useEngine } from "../../../hooks/useEngine";
import { useI18n } from "../../../hooks/useLocale";
import { DownloadIcon } from "../../../components/Icons";
import styles from "./SidePanel.module.css";

const SIDES: Side[] = ["WEST", "EAST", "GUER", "CIV"];

const SIDE_LABELS: Record<Side, string> = {
  WEST: "BLUFOR",
  EAST: "OPFOR",
  GUER: "IND",
  CIV: "CIV",
};

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

function formatDuration(frames: number, captureDelayMs: number): string {
  const totalSeconds = Math.round((frames * captureDelayMs) / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function mapToSortedEntries(m: Map<string, number>): [string, number][] {
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

export interface AARTabProps {
  actions?: Accessor<ActionDefinition[]>;
  isAdmin?: Accessor<boolean>;
  onEditAction?: (action: ActionDefinition) => void;
}

export function AARTab(props: AARTabProps): JSX.Element {
  const engine = useEngine();
  const { t } = useI18n();

  // Collapsible state for each action section (keyed by action id)
  const [expandedActions, setExpandedActions] = createSignal<Set<string>>(new Set());
  // Equipment subsection expanded per action (default: expanded)
  const [collapsedEquipment, setCollapsedEquipment] = createSignal<Set<string>>(new Set());
  // Group detail subsection expanded per action (default: collapsed)
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());

  // Collapsible state for the per-group breakdown section (collapsed by default)
  const [showGroupBreakdown, setShowGroupBreakdown] = createSignal(false);

  function toggleAction(id: string): void {
    setExpandedActions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSet(signal: () => Set<string>, setter: (fn: (prev: Set<string>) => Set<string>) => void, id: string): void {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const endFrame = createMemo(() => engine.endFrame());
  const info = createMemo(() => engine.missionInfo);

  const groupStats = createMemo(() =>
    engine.eventManager.getGroupKills(endFrame()),
  );

  const equipLosses = createMemo(() =>
    engine.eventManager.getEquipmentLosses(endFrame()),
  );

  const killDeathCounts = createMemo(() =>
    engine.eventManager.getKillDeathCounts(endFrame()),
  );

  const sideRows = createMemo(() => {
    const snaps = engine.entitySnapshots();
    const units = engine.entityManager.getUnits();
    const { kills, deaths } = killDeathCounts();
    return SIDES.map((side) => {
      const sideUnits = units.filter((u) => u.side === side);
      if (sideUnits.length === 0) return null;
      const total = sideUnits.length;
      let alive = 0;
      for (const u of sideUnits) {
        const snap = snaps.get(u.id);
        if (snap && snap.alive) alive++;
      }
      const sideKills = sideUnits.reduce((s, u) => s + (kills.get(u.id) ?? 0), 0);
      const sideDeaths = sideUnits.reduce((s, u) => s + (deaths.get(u.id) ?? 0), 0);
      const eq = equipLosses().get(side);
      const vehiclesDestroyed = eq
        ? Array.from(eq.destroyed.values()).reduce((a, b) => a + b, 0)
        : 0;
      const vehiclesLost = eq
        ? [...eq.lost_combat.values(), ...eq.lost_captured.values()].reduce((a, b) => a + b, 0)
        : 0;
      return { side, total, alive, deaths: sideDeaths, kills: sideKills, vehiclesDestroyed, vehiclesLost };
    }).filter(Boolean) as { side: Side; total: number; alive: number; deaths: number; kills: number; vehiclesDestroyed: number; vehiclesLost: number }[];
  });

  function buildHtml(): string {
    const mi = info();
    const missionName = mi?.missionName ?? "Unknown Mission";
    const worldName = mi?.worldName ?? "";
    const duration = mi ? formatDuration(mi.endFrame, mi.captureDelayMs) : "";
    const author = mi?.missionAuthor ?? "";

    const rows = sideRows();
    const groups = groupStats();
    const eq = equipLosses();

    const sideTableRows = rows.map((r) => `
      <tr>
        <td><b>${SIDE_LABELS[r.side]}</b></td>
        <td>${r.total}</td>
        <td>${r.deaths} (${r.total > 0 ? Math.round((r.deaths / r.total) * 100) : 0}%)</td>
        <td>${r.kills}</td>
        <td>${r.vehiclesDestroyed}</td>
        <td>${r.vehiclesLost}</td>
      </tr>`).join("");

    const groupSections = SIDES.flatMap((side) => {
      const sideGroups = groups
        .filter((g: { side: string; }) => g.side === side)
        .sort((a: { kills: number; }, b: { kills: number; }) => b.kills - a.kills);
      if (sideGroups.length === 0) return [];
      const groupRows = sideGroups.map((g: { groupName: any; playerCount: number; unitCount: number; kills: any; vehicleKills: any; deaths: any; }) => `
        <tr>
          <td>${g.groupName || "Ungrouped"}</td>
          <td>${g.playerCount}P / ${g.unitCount - g.playerCount}AI</td>
          <td>${g.kills}</td>
          <td>${g.vehicleKills}</td>
          <td>${g.deaths}</td>
        </tr>`).join("");
      return [`
        <h3 style="color:#aaa;margin:16px 0 4px">${SIDE_LABELS[side]}</h3>
        <table>
          <thead><tr><th>Group</th><th>Strength</th><th>K</th><th>VK</th><th>D</th></tr></thead>
          <tbody>${groupRows}</tbody>
        </table>`];
    }).join("");

    const eqSections = SIDES.map((side) => {
      const sideEq = eq.get(side);
      if (!sideEq || (sideEq.destroyed.size === 0 && sideEq.lost_combat.size === 0 && sideEq.lost_captured.size === 0 && sideEq.captured.size === 0)) return "";
      const destrHtml = mapToSortedEntries(sideEq.destroyed)
        .map(([t, c]) => `<li>${c}× ${VEHICLE_TYPE_LABELS[t] ?? t}</li>`).join("");
      const lostCombatHtml = mapToSortedEntries(sideEq.lost_combat)
        .map(([t, c]) => `<li>${c}× ${VEHICLE_TYPE_LABELS[t] ?? t}</li>`).join("");
      const lostCapturedHtml = mapToSortedEntries(sideEq.lost_captured)
        .map(([t, c]) => `<li>${c}× ${VEHICLE_TYPE_LABELS[t] ?? t}</li>`).join("");
      const capturedHtml = mapToSortedEntries(sideEq.captured)
        .map(([t, c]) => `<li>${c}× ${VEHICLE_TYPE_LABELS[t] ?? t}</li>`).join("");
      return `
        <h3 style="color:#aaa;margin:16px 0 4px">${SIDE_LABELS[side]}</h3>
        ${destrHtml ? `<p><b>Destroyed:</b></p><ul>${destrHtml}</ul>` : ""}
        ${lostCombatHtml ? `<p><b>Lost (Combat):</b></p><ul>${lostCombatHtml}</ul>` : ""}
        ${lostCapturedHtml ? `<p><b>Lost (Captured):</b></p><ul>${lostCapturedHtml}</ul>` : ""}
        ${capturedHtml ? `<p><b>Captured:</b></p><ul>${capturedHtml}</ul>` : ""}`;
    }).join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>AAR – ${missionName}</title>
<style>
  body{font-family:monospace;background:#1a1a1a;color:#ccc;padding:32px;max-width:900px;margin:auto}
  h1{color:#fff;margin-bottom:4px}
  h2{color:#ddd;border-bottom:1px solid #333;padding-bottom:4px;margin-top:32px}
  h3{color:#aaa}
  table{border-collapse:collapse;width:100%;margin-bottom:16px}
  th,td{border:1px solid #333;padding:6px 10px;text-align:left}
  th{background:#222;color:#aaa;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
  tr:nth-child(even){background:#1e1e1e}
  .meta{color:#777;font-size:13px;margin-bottom:24px}
  ul{margin:4px 0 12px;padding-left:20px}
  li{margin:2px 0}
</style>
</head>
<body>
<h1>${missionName}</h1>
<div class="meta">
  ${worldName ? `Map: ${worldName} &nbsp;|&nbsp; ` : ""}
  ${author ? `Author: ${author} &nbsp;|&nbsp; ` : ""}
  Duration: ${duration}
</div>

<h2>Force Summary</h2>
<table>
  <thead>
    <tr>
      <th>Side</th><th>Total</th><th>Casualties</th>
      <th>Kills</th><th>Vehicles Destroyed</th><th>Vehicles Lost</th>
    </tr>
  </thead>
  <tbody>${sideTableRows}</tbody>
</table>

<h2>Combat by Group</h2>
${groupSections || "<p>No group data.</p>"}

<h2>Equipment</h2>
${eqSections || "<p>No vehicle losses recorded.</p>"}

<p style="color:#555;font-size:11px;margin-top:48px">
  Generated by OCAP2 &nbsp;|&nbsp; ${new Date().toUTCString()}
</p>
</body>
</html>`;
  }

  function exportAAR(): void {
    const html = buildHtml();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const mi = info();
    a.download = `AAR_${(mi?.missionName ?? "mission").replace(/\s+/g, "_")}.html`;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div class={styles.tabContent}>
      <div class={styles.statsContainer}>

        {/* Mission header */}
        <Show when={info()}>
          {(mi) => (
            <div style={{ "background": "rgba(255,255,255,0.03)", "border-radius": "8px", padding: "10px 12px", "border": "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ "font-family": "var(--font-mono)", "font-size": "13px", "font-weight": "700", color: "var(--text-primary)", "margin-bottom": "4px" }}>
                {mi().missionName}
              </div>
              <div style={{ "font-family": "var(--font-mono)", "font-size": "10px", color: "var(--text-dimmer)", display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                <Show when={mi().worldName}>
                  <span>{mi().worldName}</span>
                </Show>
                <Show when={mi().missionAuthor}>
                  <span>by {mi().missionAuthor}</span>
                </Show>
                <span>{formatDuration(mi().endFrame, mi().captureDelayMs)}</span>
              </div>
            </div>
          )}
        </Show>

        {/* Force summary */}
        <Show when={sideRows().length > 0}>
          <div>
            <div class={styles.statsLabel}>{t("force_summary")}</div>
            <div style={{ "margin-top": "8px", display: "flex", "flex-direction": "column", gap: "4px" }}>
              <div style={{ display: "grid", "grid-template-columns": "1fr 40px 40px 40px 40px 40px", gap: "4px", padding: "0 4px", "font-size": "9px", "font-family": "var(--font-mono)", color: "var(--text-dimmest)", "letter-spacing": "0.06em", "text-transform": "uppercase", "margin-bottom": "2px" }}>
                <span>Side</span>
                <span style={{ "text-align": "right" }}>Total</span>
                <span style={{ "text-align": "right" }}>Dead</span>
                <span style={{ "text-align": "right" }}>K</span>
                <span style={{ "text-align": "right" }}>VD</span>
                <span style={{ "text-align": "right" }}>VL</span>
              </div>
              <For each={sideRows()}>
                {(r) => (
                  <div style={{ display: "grid", "grid-template-columns": "1fr 40px 40px 40px 40px 40px", gap: "4px", padding: "6px 4px", background: SIDE_BG_COLORS[r.side], "border-radius": "5px", "border": `1px solid ${SIDE_COLORS_UI[r.side]}20`, "font-family": "var(--font-mono)", "font-size": "11px" }}>
                    <span style={{ color: SIDE_COLORS_UI[r.side], "font-weight": "700" }}>{SIDE_LABELS[r.side]}</span>
                    <span style={{ "text-align": "right", color: "var(--text-secondary)" }}>{r.total}</span>
                    <span style={{ "text-align": "right", color: r.deaths > 0 ? "var(--accent-warning)" : "var(--text-dimmest)" }}>
                      {r.deaths}
                    </span>
                    <span style={{ "text-align": "right", color: r.kills > 0 ? "var(--accent-danger)" : "var(--text-dimmest)" }}>
                      {r.kills}
                    </span>
                    <span style={{ "text-align": "right", color: r.vehiclesDestroyed > 0 ? "var(--accent-danger)" : "var(--text-dimmest)" }}>
                      {r.vehiclesDestroyed}
                    </span>
                    <span style={{ "text-align": "right", color: r.vehiclesLost > 0 ? "var(--accent-warning)" : "var(--text-dimmest)" }}>
                      {r.vehiclesLost}
                    </span>
                  </div>
                )}
              </For>
              <div style={{ "font-size": "9px", color: "var(--text-dimmest)", "font-family": "var(--font-mono)", padding: "2px 4px" }}>
                K=unit kills &nbsp; VD=vehicles destroyed &nbsp; VL=vehicles lost
              </div>
            </div>
          </div>
        </Show>

        {/* Per-group breakdown */}
        <Show when={groupStats().length > 0}>
          <div>
            {/* Collapsible header */}
            <div
              style={{ display: "flex", "align-items": "center", gap: "6px", cursor: "pointer", "user-select": "none" }}
              onClick={() => setShowGroupBreakdown((v) => !v)}
            >
              <span class={styles.statsLabel} style={{ flex: "1", cursor: "pointer" }}>{t("by_group")}</span>
              <span
                style={{
                  "font-size": "9px",
                  color: "var(--text-dimmest)",
                  transition: "transform 0.15s",
                  transform: showGroupBreakdown() ? "rotate(90deg)" : "rotate(0deg)",
                }}
              >
                ▶
              </span>
            </div>
            <Show when={showGroupBreakdown()}>
              <div style={{ "margin-top": "8px", display: "flex", "flex-direction": "column", gap: "2px" }}>
                <For each={SIDES}>
                  {(side) => {
                    const sideGroups = groupStats()
                      .filter((g) => g.side === side)
                      .sort((a, b) => b.kills - a.kills);
                    return (
                      <Show when={sideGroups.length > 0}>
                        <div style={{ "margin-bottom": "6px" }}>
                          <div style={{ display: "flex", "align-items": "center", gap: "5px", padding: "3px 0", "border-bottom": `1px solid ${SIDE_COLORS_UI[side]}30`, "margin-bottom": "3px" }}>
                            <span style={{ width: "7px", height: "7px", "border-radius": "2px", background: SIDE_COLORS_UI[side], display: "inline-block", "flex-shrink": "0" }} />
                            <span style={{ color: SIDE_COLORS_UI[side], "font-size": "10px", "font-family": "var(--font-mono)", "font-weight": "700" }}>
                              {SIDE_LABELS[side]}
                            </span>
                          </div>
                          <For each={sideGroups}>
                            {(g: { groupName: any; playerCount: number; unitCount: number; kills: any; vehicleKills: any; deaths: any; }) => (
                              <div style={{ display: "flex", "align-items": "center", gap: "4px", padding: "3px 6px", "font-family": "var(--font-mono)", "font-size": "11px" }}>
                                <span style={{ flex: "1", color: "var(--text-secondary)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                                  {g.groupName || t("ungrouped")}
                                </span>
                                <span style={{ color: "var(--text-dimmest)", "font-size": "10px", "min-width": "50px", "text-align": "right" }}>
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

        {/* Equipment */}
        <Show when={equipLosses().size > 0}>
          <div>
            <div class={styles.statsLabel}>{t("equipment")}</div>
            <div style={{ "margin-top": "8px", display: "flex", "flex-direction": "column", gap: "6px" }}>
              <For each={SIDES}>
                {(side) => {
                  const eq = equipLosses().get(side);
                  if (!eq || (eq.destroyed.size === 0 && eq.lost_combat.size === 0 && eq.lost_captured.size === 0 && eq.captured.size === 0)) return null;
                  return (
                    <div style={{ background: SIDE_BG_COLORS[side], "border-radius": "6px", padding: "8px 10px", border: `1px solid ${SIDE_COLORS_UI[side]}20` }}>
                      <div style={{ color: SIDE_COLORS_UI[side], "font-size": "10px", "font-family": "var(--font-mono)", "font-weight": "700", "margin-bottom": "5px" }}>
                        {SIDE_LABELS[side]}
                      </div>
                      <Show when={eq.destroyed.size > 0}>
                        <div style={{ "font-size": "10px", "font-family": "var(--font-mono)", "margin-bottom": "3px" }}>
                          <span style={{ color: "var(--accent-danger)", "font-weight": "600" }}>{t("destroyed")}: </span>
                          <span style={{ color: "var(--text-muted)" }}>
                            {mapToSortedEntries(eq.destroyed).map(([tp, c]) => `${c}× ${VEHICLE_TYPE_LABELS[tp] ?? tp}`).join(", ")}
                          </span>
                        </div>
                      </Show>
                      <Show when={eq.lost_combat.size > 0}>
                        <div style={{ "font-size": "10px", "font-family": "var(--font-mono)", "margin-bottom": "3px" }}>
                          <span style={{ color: "var(--accent-warning)", "font-weight": "600" }}>{t("lost_combat")}: </span>
                          <span style={{ color: "var(--text-muted)" }}>
                            {mapToSortedEntries(eq.lost_combat).map(([tp, c]) => `${c}× ${VEHICLE_TYPE_LABELS[tp] ?? tp}`).join(", ")}
                          </span>
                        </div>
                      </Show>
                      <Show when={eq.lost_captured.size > 0}>
                        <div style={{ "font-size": "10px", "font-family": "var(--font-mono)", "margin-bottom": "3px" }}>
                          <span style={{ color: "var(--accent-warning)", "font-weight": "600" }}>{t("lost_captured")}: </span>
                          <span style={{ color: "var(--text-muted)" }}>
                            {mapToSortedEntries(eq.lost_captured).map(([tp, c]) => `${c}× ${VEHICLE_TYPE_LABELS[tp] ?? tp}`).join(", ")}
                          </span>
                        </div>
                      </Show>
                      <Show when={eq.captured.size > 0}>
                        <div style={{ "font-size": "10px", "font-family": "var(--font-mono)" }}>
                          <span style={{ color: "var(--accent-success)", "font-weight": "600" }}>{t("veh_captured")}: </span>
                          <span style={{ color: "var(--text-muted)" }}>
                            {mapToSortedEntries(eq.captured).map(([tp, c]) => `${c}× ${VEHICLE_TYPE_LABELS[tp] ?? tp}`).join(", ")}
                          </span>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* Export button */}
        <div style={{ "padding-top": "4px" }}>
          <button
            onClick={exportAAR}
            style={{ width: "100%", padding: "8px", "border-radius": "6px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "var(--text-secondary)", "font-family": "var(--font-mono)", "font-size": "12px", "font-weight": "600", cursor: "pointer", display: "flex", "align-items": "center", "justify-content": "center", gap: "6px" }}
          >
            <DownloadIcon size={13} />
            {t("export_aar")}
          </button>
        </div>

        {/* Action sections */}
        <Show when={(props.actions?.() ?? []).length > 0}>
          <div>
            <div class={styles.statsLabel}>Actions</div>
            <div style={{ "margin-top": "8px", display: "flex", "flex-direction": "column", gap: "4px" }}>
              <For each={props.actions?.() ?? []}>
                {(action) => {
                  const isExpanded = () => expandedActions().has(action.id);
                  return (
                    <div
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        "border-radius": "6px",
                        border: `1px solid ${action.color}30`,
                        overflow: "hidden",
                      }}
                    >
                      {/* Header row */}
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          gap: "6px",
                          padding: "6px 8px",
                          cursor: "pointer",
                          "user-select": "none",
                        }}
                        onClick={() => toggleAction(action.id)}
                      >
                        {/* Color dot */}
                        <span
                          style={{
                            width: "8px",
                            height: "8px",
                            "border-radius": "50%",
                            background: action.color,
                            "flex-shrink": "0",
                          }}
                        />
                        {/* Label */}
                        <span
                          style={{
                            flex: "1",
                            "font-family": "var(--font-mono)",
                            "font-size": "11px",
                            "font-weight": "600",
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            "text-overflow": "ellipsis",
                            "white-space": "nowrap",
                          }}
                        >
                          {action.label}
                        </span>
                        {/* Frame range */}
                        <span
                          style={{
                            "font-family": "var(--font-mono)",
                            "font-size": "9px",
                            color: "var(--text-dimmest)",
                            "white-space": "nowrap",
                          }}
                        >
                          {action.inFrame}–{action.outFrame}
                        </span>
                        {/* Status indicator */}
                        <Show when={action.status === "pending"}>
                          <span
                            style={{
                              "font-family": "var(--font-mono)",
                              "font-size": "9px",
                              color: "var(--text-dimmest)",
                              "font-style": "italic",
                            }}
                          >
                            Computing...
                          </span>
                        </Show>
                        <Show when={action.status === "failed"}>
                          <span
                            style={{
                              "font-family": "var(--font-mono)",
                              "font-size": "9px",
                              color: "var(--accent-danger)",
                            }}
                          >
                            Failed
                          </span>
                        </Show>
                        {/* Edit button (admin only) */}
                        <Show when={props.isAdmin?.() && props.onEditAction}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onEditAction!(action);
                            }}
                            title="Edit action"
                            style={{
                              "flex-shrink": "0",
                              height: "18px",
                              padding: "0 6px",
                              "border-radius": "3px",
                              border: "1px solid rgba(255,255,255,0.08)",
                              background: "var(--bg-interactive)",
                              color: "var(--text-dimmer)",
                              cursor: "pointer",
                              "font-size": "9px",
                              "font-family": "var(--font-mono)",
                            }}
                          >
                            Edit
                          </button>
                        </Show>
                        <Show when={action.status === "failed" && props.isAdmin?.() && props.onEditAction}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              props.onEditAction!(action);
                            }}
                            title="Retry action computation"
                            style={{
                              "flex-shrink": "0",
                              height: "18px",
                              padding: "0 6px",
                              "border-radius": "3px",
                              border: "1px solid rgba(231,76,60,0.25)",
                              background: "rgba(231,76,60,0.1)",
                              color: "#e74c3c",
                              cursor: "pointer",
                              "font-size": "9px",
                              "font-family": "var(--font-mono)",
                            }}
                          >
                            Retry
                          </button>
                        </Show>
                        {/* Expand chevron */}
                        <span
                          style={{
                            "font-size": "9px",
                            color: "var(--text-dimmest)",
                            transition: "transform 0.15s",
                            transform: isExpanded() ? "rotate(90deg)" : "rotate(0deg)",
                          }}
                        >
                          ▶
                        </span>
                      </div>

                      {/* Expanded stats */}
                      <Show when={isExpanded()}>
                        <div style={{ "border-top": "1px solid rgba(255,255,255,0.05)", padding: "6px 8px", display: "flex", "flex-direction": "column", gap: "6px" }}>
                          <Show
                            when={(action.stats ?? []).length > 0}
                            fallback={
                              <span style={{ "font-family": "var(--font-mono)", "font-size": "10px", color: "var(--text-dimmest)", "font-style": "italic" }}>
                                {action.status === "pending" ? "Computing stats..." : action.status === "failed" ? "Computation failed." : "No data."}
                              </span>
                            }
                          >
                            {/* ── Side summary ── */}
                            {(() => {
                              // Aggregate stats per side
                              const bySide = new Map<string, { kills: number; deaths: number; units: number; players: number; rounds: number }>();
                              for (const stat of action.stats ?? []) {
                                const s = bySide.get(stat.side) ?? { kills: 0, deaths: 0, units: 0, players: 0, rounds: 0 };
                                s.kills += stat.kills;
                                s.deaths += stat.deaths;
                                s.units += stat.unitCount;
                                s.players += stat.playerCount;
                                s.rounds += stat.roundsFired;
                                bySide.set(stat.side, s);
                              }
                              const sideEntries = SIDES
                                .filter((s) => bySide.has(s))
                                .map((s) => ({ side: s, ...bySide.get(s)! }));
                              return (
                                <div style={{ display: "flex", "flex-direction": "column", gap: "3px" }}>
                                  <div style={{ display: "grid", "grid-template-columns": "1fr 36px 36px 36px 42px", gap: "4px", padding: "0 4px", "font-size": "8px", "font-family": "var(--font-mono)", color: "var(--text-dimmest)", "letter-spacing": "0.05em", "text-transform": "uppercase" }}>
                                    <span>Side</span>
                                    <span style={{ "text-align": "right" }}>K</span>
                                    <span style={{ "text-align": "right" }}>D</span>
                                    <span style={{ "text-align": "right" }}>Units</span>
                                    <span style={{ "text-align": "right" }}>Rounds</span>
                                  </div>
                                  <For each={sideEntries}>
                                    {(r) => (
                                      <div style={{ display: "grid", "grid-template-columns": "1fr 36px 36px 36px 42px", gap: "4px", padding: "4px", background: SIDE_BG_COLORS[r.side] ?? "transparent", "border-radius": "4px", border: `1px solid ${SIDE_COLORS_UI[r.side] ?? "transparent"}20`, "font-family": "var(--font-mono)", "font-size": "10px" }}>
                                        <span style={{ color: SIDE_COLORS_UI[r.side] ?? "var(--text-primary)", "font-weight": "700" }}>{SIDE_LABELS[r.side as Side] ?? r.side}</span>
                                        <span style={{ "text-align": "right", color: r.kills > 0 ? "var(--accent-danger)" : "var(--text-dimmest)" }}>{r.kills}</span>
                                        <span style={{ "text-align": "right", color: r.deaths > 0 ? "var(--accent-warning)" : "var(--text-dimmest)" }}>{r.deaths}</span>
                                        <span style={{ "text-align": "right", color: "var(--text-secondary)" }}>{r.units}</span>
                                        <span style={{ "text-align": "right", color: "var(--text-secondary)" }}>{r.rounds}</span>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              );
                            })()}

                            {/* ── Equipment ── */}
                            {(() => {
                              // Aggregate vehicle losses per side
                              const destroyed = new Map<string, Map<string, number>>();
                              const lost = new Map<string, Map<string, number>>();
                              for (const stat of action.stats ?? []) {
                                if (!destroyed.has(stat.side)) destroyed.set(stat.side, new Map());
                                if (!lost.has(stat.side)) lost.set(stat.side, new Map());
                                for (const [vt, c] of Object.entries(stat.vehiclesDestroyed ?? {})) {
                                  destroyed.get(stat.side)!.set(vt, (destroyed.get(stat.side)!.get(vt) ?? 0) + c);
                                }
                                for (const [vt, c] of Object.entries(stat.vehiclesLost ?? {})) {
                                  lost.get(stat.side)!.set(vt, (lost.get(stat.side)!.get(vt) ?? 0) + c);
                                }
                              }
                              const hasAny = [...destroyed.values()].some((m) => m.size > 0) || [...lost.values()].some((m) => m.size > 0);
                              if (!hasAny) return null;
                              const eqExpanded = () => !collapsedEquipment().has(action.id);
                              return (
                                <div>
                                  <div
                                    style={{ display: "flex", "align-items": "center", gap: "4px", cursor: "pointer", "user-select": "none", padding: "2px 0" }}
                                    onClick={() => toggleSet(collapsedEquipment, setCollapsedEquipment, action.id)}
                                  >
                                    <span style={{ "font-family": "var(--font-mono)", "font-size": "9px", "font-weight": "700", color: "var(--text-muted)", "text-transform": "uppercase", "letter-spacing": "0.06em", flex: "1" }}>Equipment</span>
                                    <span style={{ "font-size": "8px", color: "var(--text-dimmest)", transition: "transform 0.15s", transform: eqExpanded() ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                  </div>
                                  <Show when={eqExpanded()}>
                                    <div style={{ display: "flex", "flex-direction": "column", gap: "3px", "margin-top": "3px" }}>
                                      <For each={SIDES.filter((s) => (destroyed.get(s)?.size ?? 0) > 0 || (lost.get(s)?.size ?? 0) > 0)}>
                                        {(side) => (
                                          <div style={{ background: SIDE_BG_COLORS[side] ?? "transparent", "border-radius": "4px", padding: "5px 7px", border: `1px solid ${SIDE_COLORS_UI[side] ?? "transparent"}20` }}>
                                            <div style={{ color: SIDE_COLORS_UI[side], "font-size": "9px", "font-family": "var(--font-mono)", "font-weight": "700", "margin-bottom": "3px" }}>{SIDE_LABELS[side]}</div>
                                            <Show when={(destroyed.get(side)?.size ?? 0) > 0}>
                                              <div style={{ "font-size": "10px", "font-family": "var(--font-mono)" }}>
                                                <span style={{ color: "var(--accent-danger)", "font-weight": "600" }}>Destroyed: </span>
                                                <span style={{ color: "var(--text-muted)" }}>
                                                  {Array.from(destroyed.get(side)!.entries()).sort((a, b) => b[1] - a[1]).map(([vt, c]) => `${c}× ${VEHICLE_TYPE_LABELS[vt] ?? vt}`).join(", ")}
                                                </span>
                                              </div>
                                            </Show>
                                            <Show when={(lost.get(side)?.size ?? 0) > 0}>
                                              <div style={{ "font-size": "10px", "font-family": "var(--font-mono)" }}>
                                                <span style={{ color: "var(--accent-warning)", "font-weight": "600" }}>Lost: </span>
                                                <span style={{ color: "var(--text-muted)" }}>
                                                  {Array.from(lost.get(side)!.entries()).sort((a, b) => b[1] - a[1]).map(([vt, c]) => `${c}× ${VEHICLE_TYPE_LABELS[vt] ?? vt}`).join(", ")}
                                                </span>
                                              </div>
                                            </Show>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </div>
                              );
                            })()}

                            {/* ── Group detail (collapsible, collapsed by default) ── */}
                            {(() => {
                              const grpExpanded = () => expandedGroups().has(action.id);
                              const statsBySide = SIDES.map((side) => ({
                                side,
                                stats: (action.stats ?? []).filter((s) => s.side === side),
                              })).filter((x) => x.stats.length > 0);
                              return (
                                <div>
                                  <div
                                    style={{ display: "flex", "align-items": "center", gap: "4px", cursor: "pointer", "user-select": "none", padding: "2px 0" }}
                                    onClick={() => toggleSet(expandedGroups, setExpandedGroups, action.id)}
                                  >
                                    <span style={{ "font-family": "var(--font-mono)", "font-size": "9px", "font-weight": "700", color: "var(--text-muted)", "text-transform": "uppercase", "letter-spacing": "0.06em", flex: "1" }}>Units by Group</span>
                                    <span style={{ "font-size": "8px", color: "var(--text-dimmest)", transition: "transform 0.15s", transform: grpExpanded() ? "rotate(90deg)" : "rotate(0deg)" }}>▶</span>
                                  </div>
                                  <Show when={grpExpanded()}>
                                    <div style={{ display: "flex", "flex-direction": "column", gap: "4px", "margin-top": "3px" }}>
                                      <For each={statsBySide}>
                                        {({ side, stats: sideStats }) => (
                                          <div>
                                            <div style={{ display: "flex", "align-items": "center", gap: "5px", padding: "2px 0", "border-bottom": `1px solid ${SIDE_COLORS_UI[side]}30`, "margin-bottom": "3px" }}>
                                              <span style={{ width: "6px", height: "6px", "border-radius": "2px", background: SIDE_COLORS_UI[side], display: "inline-block", "flex-shrink": "0" }} />
                                              <span style={{ color: SIDE_COLORS_UI[side], "font-size": "9px", "font-family": "var(--font-mono)", "font-weight": "700" }}>{SIDE_LABELS[side]}</span>
                                            </div>
                                            <For each={sideStats}>
                                              {(stat) => (
                                                <div style={{ display: "grid", "grid-template-columns": "1fr 44px 36px 36px 36px", gap: "4px", padding: "3px 4px", "font-family": "var(--font-mono)", "font-size": "10px" }}>
                                                  <span style={{ color: "var(--text-secondary)", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                                                    {stat.groupName || t("ungrouped")}
                                                  </span>
                                                  <span style={{ "text-align": "right", color: "var(--text-dimmest)", "font-size": "9px" }}>
                                                    {stat.playerCount}P/{stat.unitCount - stat.playerCount}AI
                                                  </span>
                                                  <span style={{ "text-align": "right", color: stat.kills > 0 ? "var(--accent-danger)" : "var(--text-dimmest)" }}>K:{stat.kills}</span>
                                                  <span style={{ "text-align": "right", color: stat.deaths > 0 ? "var(--accent-warning)" : "var(--text-dimmest)" }}>D:{stat.deaths}</span>
                                                  <span style={{ "text-align": "right", color: "var(--text-dimmest)" }}>{stat.roundsFired}r</span>
                                                </div>
                                              )}
                                            </For>
                                          </div>
                                        )}
                                      </For>
                                    </div>
                                  </Show>
                                </div>
                              );
                            })()}
                          </Show>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

      </div>
    </div>
  );
}
