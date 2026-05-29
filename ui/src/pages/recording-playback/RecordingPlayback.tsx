import { onMount, onCleanup, createSignal, createMemo, createEffect, Show } from "solid-js";
import type { JSX } from "solid-js";
import { useParams, useNavigate, useLocation } from "@solidjs/router";
import type { WorldConfig, ActionDefinition } from "../../data/types";
import type { ArmaCoord } from "../../utils/coordinates";
import { ApiClient } from "../../data/apiClient";
import { useAuth } from "../../hooks/useAuth";
import { PlaybackEngine } from "../../playback/engine";
import { MarkerManager } from "../../playback/markerManager";
import { formatElapsedTime } from "../../playback/time";
import type { TimeMode } from "../../playback/time";
import { LeafletRenderer } from "../../renderers/leaflet/leafletRenderer";
import { CanvasLeafletRenderer } from "../../renderers/leaflet/canvasLeafletRenderer";
import type { MapRenderer } from "../../renderers/renderer.interface";
import { EngineProvider } from "../../hooks/useEngine";
import { RendererProvider } from "../../hooks/useRenderer";
import { useI18n } from "../../hooks/useLocale";
import { OcapLogoSvg } from "../recording-selector/OcapLogoSvg";
import { formatDuration } from "../recording-selector/helpers";
import loadingStyles from "../LoadingTransition.module.css";
import { MapContainer } from "./components/MapContainer";
import { TopBar } from "./components/TopBar";
import { SidePanel } from "./components/SidePanel";
import { BottomBar } from "./components/BottomBar";
import { MapControls } from "./components/MapControls";
import { AboutModal } from "./components/AboutModal";
import { CounterDisplay } from "./components/CounterDisplay";
import { FollowIndicator } from "./components/FollowIndicator";
import { Hint, showHint, hintMessage, hintVisible } from "./components/Hint";
import { BlacklistIndicator } from "./components/BlacklistIndicator";
import type { FocusRange } from "./components/FocusToolbar";
import { ActionCreationToolbar } from "./components/ActionCreationToolbar";
import { ActionEditPanel } from "./components/ActionEditPanel";
import { ActionPolygonLayer } from "./components/ActionPolygonLayer";
import {
  registerShortcuts,
  unregisterShortcuts,
  leftPanelVisible,
  activePanelTab,
  setActivePanelTab,
  setLeftPanelVisible,
  setEditingFocusForShortcuts,
  setFocusShortcutCallbacks,
  setShowingCreationToolbar,
  setActionCreationShortcutCallbacks,
} from "./shortcuts";
import { loadRecording } from "./loadRecording";
import { useRenderBridge } from "./useRenderBridge";

interface LocationState {
  missionName?: string;
  worldName?: string;
  missionDuration?: number;
}

export function RecordingPlayback(): JSX.Element {
  const params = useParams<{ id: string; name: string }>();
  const navigate = useNavigate();
  const location = useLocation<LocationState>();
  const { t } = useI18n();
  const { authenticated, isAdmin } = useAuth();
  const api = new ApiClient();
  const rendererParam = new URLSearchParams(window.location.search).get("renderer");
  const renderer: MapRenderer = rendererParam === "dom"
    ? new LeafletRenderer()
    : new CanvasLeafletRenderer();
  const engine = new PlaybackEngine(renderer);
  const markerManager = new MarkerManager(renderer);
  const [worldConfig, setWorldConfig] = createSignal<WorldConfig | undefined>(
    undefined,
  );
  const [missionName, setMissionName] = createSignal("");
  const [recordingId, setRecordingId] = createSignal<string | null>(null);
  const [recordingFilename, setRecordingFilename] = createSignal<string | null>(null);
  const [aboutOpen, setAboutOpen] = createSignal(false);
  const [extensionVersion, setExtensionVersion] = createSignal<string | undefined>(undefined);
  const [addonVersion, setAddonVersion] = createSignal<string | undefined>(undefined);
  const [loading, setLoading] = createSignal(true);
  const [blacklist, setBlacklist] = createSignal<Set<number>>(new Set());
  const [markerCounts, setMarkerCounts] = createSignal<Map<number, number>>(new Map());
  const [timeMode, setTimeMode] = createSignal<TimeMode>("elapsed");
  const [focusRange, setFocusRange] = createSignal<FocusRange | null>(null);
  const [editingFocus, setEditingFocus] = createSignal(false);
  const [focusDraft, setFocusDraft] = createSignal<FocusRange | null>(null);
  const [showFullTimeline, setShowFullTimeline] = createSignal(false);

  // ─── Action definition state ───
  const [actions, setActions] = createSignal<ActionDefinition[]>([]);
  const [isDrawing, setIsDrawing] = createSignal(false);
  const [drawnPolygon, setDrawnPolygon] = createSignal<ArmaCoord[] | null>(null);
  const [showCreationToolbar, setShowCreationToolbar] = createSignal(false);
  const [editingAction, setEditingAction] = createSignal<ActionDefinition | null>(null);

  // ─── Interval leak prevention ───
  const activeIntervals = new Set<ReturnType<typeof setInterval>>();
  onCleanup(() => { activeIntervals.forEach(clearInterval); });

  const locState = () => location.state as LocationState | undefined;

  const mapName = createMemo(() => worldConfig()?.worldName ?? "");
  const duration = createMemo(() =>
    formatElapsedTime(engine.endFrame(), engine.captureDelayMs()),
  );

  const toggleBlacklist = async (playerEntityId: number) => {
    const rid = recordingId();
    if (!rid) return;

    const current = blacklist();
    const isBlacklisted = current.has(playerEntityId);

    try {
      if (isBlacklisted) {
        await api.removeMarkerBlacklist(rid, playerEntityId);
      } else {
        await api.addMarkerBlacklist(rid, playerEntityId);
      }

      const next = new Set(current);
      if (isBlacklisted) {
        next.delete(playerEntityId);
      } else {
        next.add(playerEntityId);
      }
      setBlacklist(next);
      markerManager.setBlacklist(next);
    } catch {
      // API call failed — leave state unchanged
    }
  };

  useRenderBridge(engine, renderer, markerManager);

  // ─── Focus editing callbacks (defined before onMount so shortcuts can reference them) ───

  const setFocusIn = () => {
    setFocusDraft((d) => d ? { ...d, inFrame: Math.min(engine.currentFrame(), d.outFrame - 1) } : d);
  };

  const setFocusOut = () => {
    setFocusDraft((d) => d ? { ...d, outFrame: Math.max(engine.currentFrame(), d.inFrame + 1) } : d);
  };

  const cancelFocus = () => {
    setEditingFocus(false);
    setFocusDraft(null);
  };

  onMount(() => {
    registerShortcuts(engine);
    setFocusShortcutCallbacks({
      onSetIn: setFocusIn,
      onSetOut: setFocusOut,
      onCancel: cancelFocus,
    });

    const id = decodeURIComponent(params.id);
    void (async () => {
      let rec;
      try {
        rec = await api.getRecording(id);
      } catch {
        showHint(t("recording_not_found"));
        setLoading(false);
        return;
      }
      try {
        const result = await loadRecording(
          api, engine, markerManager, rec,
          (world) => setWorldConfig(world),
        );
        setWorldConfig(result.worldConfig);
        setMissionName(result.missionName);
        setRecordingId(result.recordingId);
        setRecordingFilename(result.recordingFilename);
        setExtensionVersion(result.extensionVersion);
        setAddonVersion(result.addonVersion);

        // Initialize focus range from recording metadata
        if (rec.focusStart != null && rec.focusEnd != null) {
          setFocusRange({ inFrame: rec.focusStart, outFrame: rec.focusEnd });
          engine.seekTo(rec.focusStart);
        }

        // Fetch actions (non-fatal)
        api.getActions(result.recordingId).then(setActions).catch(() => {});

        // Fetch marker blacklist (non-fatal)
        try {
          const ids = await api.getMarkerBlacklist(result.recordingId);
          const blSet = new Set(ids);
          setBlacklist(blSet);
          markerManager.setBlacklist(blSet);
          setMarkerCounts(markerManager.getMarkerCountsByPlayer());
        } catch {
          // Blacklist unavailable — not critical
        }
      } catch (err) {
        console.error("Failed to load recording:", err);
        showHint(t("load_failed"));
      } finally {
        setLoading(false);
      }
    })();
  });

  onCleanup(() => {
    unregisterShortcuts();
    markerManager.clear();
    engine.dispose();
    renderer.dispose();
    document.documentElement.style.removeProperty("--pb-bottom-height");
  });

  // Sync editing state to shortcuts module + adjust bottom bar height
  createEffect(() => {
    const editing = editingFocus();
    setEditingFocusForShortcuts(editing);
    document.documentElement.style.setProperty(
      "--pb-bottom-height",
      editing ? "162px" : "126px",
    );
  });

  // Sync creation toolbar visibility to shortcuts module
  createEffect(() => {
    setShowingCreationToolbar(showCreationToolbar());
  });

  // Clamp playback to focus range when constrained (not editing, not full timeline)
  const focusConstrained = () =>
    !editingFocus() && !showFullTimeline() && !!focusRange();

  createEffect(() => {
    if (!focusConstrained()) return;
    const frame = engine.currentFrame();
    const range = focusRange();
    if (!range) return;
    if (frame >= range.outFrame && engine.isPlaying()) {
      engine.pause();
    }
    const clamped = Math.max(range.inFrame, Math.min(range.outFrame, frame));
    if (clamped !== frame) {
      engine.seekTo(clamped);
    }
  });

  // ─── Focus editing actions (start / save / clear) ───

  const startFocusEdit = () => {
    setEditingFocus(true);
    const current = focusRange();
    setFocusDraft(current ? { ...current } : { inFrame: 0, outFrame: engine.endFrame() });
  };

  const saveFocus = async () => {
    const draft = focusDraft();
    const rid = recordingId();
    if (!draft || !rid) return;
    try {
      await api.editRecording(rid, { focusStart: draft.inFrame, focusEnd: draft.outFrame });
      setFocusRange({ ...draft });
    } catch (e) {
      console.error("Failed to save focus range:", e);
      return;
    }
    setEditingFocus(false);
    setFocusDraft(null);
  };

  const clearFocus = async () => {
    const rid = recordingId();
    if (!rid) return;
    try {
      await api.editRecording(rid, { focusStart: null, focusEnd: null });
      setFocusRange(null);
    } catch (e) {
      console.error("Failed to clear focus range:", e);
      return;
    }
    setEditingFocus(false);
    setFocusDraft(null);
  };

  // ─── Action definition handlers ───

  /** Helper: get the LeafletRenderer instance for draw mode operations. */
  const getLeafletRenderer = (): LeafletRenderer | null => {
    if (renderer instanceof LeafletRenderer) return renderer;
    return null;
  };

  const onPolygonComplete = (polygon: ArmaCoord[]): void => {
    setDrawnPolygon(polygon);
    setIsDrawing(false);
  };

  /** Called when drawing is cancelled during action *creation* — closes the toolbar too. */
  const handleCreationDrawCancel = (): void => {
    const lr = getLeafletRenderer();
    if (lr) lr.disableDrawMode();
    setIsDrawing(false);
    setDrawnPolygon(null);
    setShowCreationToolbar(false);
  };

  /** Called when drawing is cancelled during action *editing* — keeps the edit panel open. */
  const handleEditDrawCancel = (): void => {
    const lr = getLeafletRenderer();
    if (lr) lr.disableDrawMode();
    setIsDrawing(false);
    setDrawnPolygon(null);
  };

  const handleNewAction = (): void => {
    setDrawnPolygon(null);
    setIsDrawing(false);
    setShowCreationToolbar(true);
    const lr = getLeafletRenderer();
    if (lr) {
      lr.enableDrawMode(onPolygonComplete, handleCreationDrawCancel);
    }
  };

  const handleDrawRegion = (): void => {
    if (!isDrawing()) {
      const lr = getLeafletRenderer();
      if (lr) {
        lr.enableDrawMode(onPolygonComplete, handleCreationDrawCancel);
        setIsDrawing(true);
      }
    }
  };

  const pollActionStatus = (actionId: string): void => {
    const rid = recordingId();
    if (!rid) return;
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      if (attempts > 15) {
        clearInterval(interval);
        activeIntervals.delete(interval);
        return;
      }
      api.getActions(rid).then((updated) => {
        setActions(updated);
        const action = updated.find((a) => a.id === actionId);
        if (action && action.status !== "pending") {
          clearInterval(interval);
          activeIntervals.delete(interval);
        }
      }).catch(() => null);
    }, 2000);
    activeIntervals.add(interval);
  };

  const handleSaveAction = async (data: { label: string; color: string; inFrame: number; outFrame: number; polygon: ArmaCoord[] }): Promise<void> => {
    const rid = recordingId();
    if (!rid) return;
    try {
      const created = await api.createAction(rid, {
        label: data.label,
        color: data.color,
        inFrame: data.inFrame,
        outFrame: data.outFrame,
        polygon: data.polygon,
      });
      setActions((prev) => [...prev, created]);
      setShowCreationToolbar(false);
      setDrawnPolygon(null);
      pollActionStatus(created.id);
    } catch (e) {
      console.error("Failed to create action:", e);
    }
  };

  const handleEditAction = (action: ActionDefinition): void => {
    setEditingAction(action);
  };

  const handleRedrawRegion = (): void => {
    const lr = getLeafletRenderer();
    if (lr) {
      setDrawnPolygon(null);
      lr.enableDrawMode(
        (polygon) => {
          setDrawnPolygon(polygon);
          setIsDrawing(false);
        },
        handleEditDrawCancel,
      );
      setIsDrawing(true);
    }
  };

  const handleSaveEditedAction = async (updates: { label: string; color: string; inFrame: number; outFrame: number; polygon: ArmaCoord[] }): Promise<void> => {
    const rid = recordingId();
    const action = editingAction();
    if (!rid || !action) return;
    try {
      await api.updateAction(rid, action.id, {
        label: updates.label,
        color: updates.color,
        inFrame: updates.inFrame,
        outFrame: updates.outFrame,
        polygon: updates.polygon,
      });
      const updated = await api.getActions(rid);
      setActions(updated);
      setEditingAction(null);
      setDrawnPolygon(null);
      // Re-poll if newly pending
      const refreshed = updated.find((a) => a.id === action.id);
      if (refreshed && refreshed.status === "pending") {
        pollActionStatus(action.id);
      }
    } catch (e) {
      console.error("Failed to update action:", e);
    }
  };

  const handleDeleteAction = async (): Promise<void> => {
    const rid = recordingId();
    const action = editingAction();
    if (!rid || !action) return;
    try {
      await api.deleteAction(rid, action.id);
      setActions((prev) => prev.filter((a) => a.id !== action.id));
      setEditingAction(null);
      setDrawnPolygon(null);
    } catch (e) {
      console.error("Failed to delete action:", e);
    }
  };

  /** armaToScreen: converts Arma world coords to pixel offset within the map container. */
  const armaToScreen = (coord: ArmaCoord): { x: number; y: number } => {
    const lr = getLeafletRenderer();
    if (lr) return lr.armaToScreen(coord);
    return { x: 0, y: 0 };
  };

  return (
    <EngineProvider engine={engine}>
      <RendererProvider renderer={renderer}>
        {/* Map container (base layer) */}
        <MapContainer renderer={renderer} worldConfig={worldConfig()} />

        {/* Action polygon overlay — positioned absolutely over the map */}
        <Show when={actions().length > 0}>
          <ActionPolygonLayer
            actions={actions}
            armaToScreen={armaToScreen}
          />
        </Show>

        <TopBar
          missionName={missionName}
          mapName={mapName}
          duration={duration}
          recordingId={recordingId}
          recordingFilename={recordingFilename}
          worldConfig={worldConfig}
          timeMode={timeMode}
          onTimeMode={setTimeMode}
          onInfoClick={() => setAboutOpen(true)}
          onBack={() => navigate("/")}
        />
        <Show when={leftPanelVisible()}>
          <SidePanel
            activeTab={activePanelTab}
            onTabChange={setActivePanelTab}
            blacklist={blacklist}
            markerCounts={markerCounts}
            isAdmin={isAdmin}
            onToggleBlacklist={toggleBlacklist}
            actions={actions}
            onEditAction={handleEditAction}
          />
        </Show>

        {/* Action creation toolbar (above the bottom bar when active) */}
        <Show when={showCreationToolbar()}>
          <ActionCreationToolbar
            onSave={(data) => { void handleSaveAction(data); }}
            onCancel={handleCreationDrawCancel}
            onDrawRegion={handleDrawRegion}
            currentFrame={() => engine.currentFrame()}
            endFrame={() => engine.endFrame()}
            isDrawing={isDrawing}
            polygonSet={() => drawnPolygon() !== null}
            drawnPolygon={drawnPolygon}
            actionCount={() => actions().length}
            onRegisterShortcutHandlers={(handlers) => {
              setActionCreationShortcutCallbacks({
                onSetIn: handlers.setIn,
                onSetOut: handlers.setOut,
              });
            }}
            onUnregisterShortcutHandlers={() => {
              setActionCreationShortcutCallbacks({});
            }}
          />
        </Show>

        <BottomBar
          panelOpen={leftPanelVisible}
          onTogglePanel={() => setLeftPanelVisible((v) => !v)}
          timeMode={timeMode}
          focusRange={focusRange}
          editingFocus={editingFocus}
          focusDraft={focusDraft}
          onDraftChange={setFocusDraft}
          showFullTimeline={showFullTimeline}
          onToggleFullTimeline={() => setShowFullTimeline((v) => !v)}
          constrainToFocus={focusConstrained}
          isAdmin={isAdmin}
          onStartFocusEdit={startFocusEdit}
          onSetIn={setFocusIn}
          onSetOut={setFocusOut}
          onClearFocus={clearFocus}
          onCancelFocus={cancelFocus}
          onSaveFocus={saveFocus}
          actions={actions}
          onActionClick={(a) => engine.seekTo(a.inFrame)}
          onNewAction={authenticated() ? handleNewAction : undefined}
        />
        <MapControls />

        {/* Action edit panel (floating card over map) */}
        <Show when={editingAction() !== null}>
          <ActionEditPanel
            action={editingAction()!}
            onSave={(updates) => { void handleSaveEditedAction(updates); }}
            onDelete={() => { void handleDeleteAction(); }}
            onClose={() => { setEditingAction(null); setDrawnPolygon(null); }}
            onDrawRegion={handleRedrawRegion}
            currentFrame={() => engine.currentFrame()}
            isDrawing={isDrawing}
            polygonSet={() => drawnPolygon() !== null}
            drawnPolygon={drawnPolygon}
          />
        </Show>

        <CounterDisplay />
        <AboutModal
          open={aboutOpen}
          onClose={() => setAboutOpen(false)}
          extensionVersion={extensionVersion}
          addonVersion={addonVersion}
        />
        <FollowIndicator />
        <Show when={authenticated() && blacklist().size > 0}>
          <BlacklistIndicator
            blacklist={blacklist}
            markerCounts={markerCounts}
          />
        </Show>
        <Hint message={hintMessage} visible={hintVisible} />
        <div
          class={loadingStyles.loadingScreen}
          data-testid="loading-screen"
          style={{
            opacity: loading() ? 1 : 0,
            "pointer-events": loading() ? "auto" : "none",
          }}
        >
          <div class={loadingStyles.loadingContent}>
            <div class={loadingStyles.loadingLogo}>
              <OcapLogoSvg size={56} />
            </div>
            <div class={loadingStyles.loadingTitle}>
              {t("loading_mission")} {locState()?.missionName ?? ""}
            </div>
            <div class={loadingStyles.loadingSubtitle}>
              {locState()?.worldName ?? ""} &middot; {formatDuration(locState()?.missionDuration ?? 0)}
            </div>
            <div class={loadingStyles.loadingBarTrack}>
              <div class={loadingStyles.loadingBarFill} />
            </div>
            <div class={loadingStyles.loadingHint}>{t("initializing_engine")}</div>
          </div>
        </div>
      </RendererProvider>
    </EngineProvider>
  );
}
