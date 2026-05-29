import { createSignal, For, Show } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { ActionDefinition } from "../../../data/types";

const COLOR_PALETTE = [
  "#e74c3c",
  "#3498db",
  "#2ecc71",
  "#f39c12",
  "#9b59b6",
  "#1abc9c",
  "#e67e22",
  "#e91e63",
];

interface Props {
  action: ActionDefinition;
  onSave: (updates: {
    label: string;
    color: string;
    inFrame: number;
    outFrame: number;
    polygon: number[][];
  }) => void;
  onDelete: () => void;
  onClose: () => void;
  onDrawRegion: () => void;
  currentFrame: Accessor<number>;
  isDrawing: Accessor<boolean>;
  polygonSet: Accessor<boolean>;
  drawnPolygon: Accessor<number[][] | null>;
}

function formatFrame(frame: number): string {
  return `frame ${frame}`;
}

export function ActionEditPanel(props: Props): JSX.Element {
  const [label, setLabel] = createSignal(props.action.label);
  const [inFrame, setInFrame] = createSignal(props.action.inFrame);
  const [outFrame, setOutFrame] = createSignal(props.action.outFrame);
  const [color, setColor] = createSignal(props.action.color);
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  const hasChanges = () =>
    label() !== props.action.label ||
    inFrame() !== props.action.inFrame ||
    outFrame() !== props.action.outFrame ||
    color() !== props.action.color ||
    props.polygonSet();

  function handleSave() {
    // Use redrawn polygon if available, otherwise convert the existing ArmaCoord[] polygon
    const polygon: number[][] = props.polygonSet() && props.drawnPolygon()
      ? props.drawnPolygon()!
      : props.action.polygon.map((coord) => Array.from(coord) as number[]);

    props.onSave({
      label: label(),
      color: color(),
      inFrame: inFrame(),
      outFrame: outFrame(),
      polygon,
    });
  }

  function drawRegionLabel(): string {
    if (props.isDrawing()) return "(drawing...)";
    if (props.polygonSet()) return "✓ Region Redrawn";
    return "Redraw Region";
  }

  const cardStyle: JSX.CSSProperties = {
    position: "absolute",
    top: "16px",
    right: "16px",
    "z-index": "500",
    width: "300px",
    background: "var(--bg-dark, #1a1e2e)",
    "border-radius": "10px",
    "box-shadow": "0 8px 32px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06) inset",
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
    "font-family": "var(--font-mono)",
    "font-size": "12px",
  };

  const sectionStyle: JSX.CSSProperties = {
    padding: "0 14px",
  };

  const rowStyle: JSX.CSSProperties = {
    display: "flex",
    "align-items": "center",
    gap: "8px",
    padding: "6px 0",
    "border-bottom": "1px solid rgba(255,255,255,0.04)",
  };

  const labelStyle: JSX.CSSProperties = {
    color: "var(--text-dimmer)",
    "min-width": "64px",
    "font-size": "11px",
  };

  const valueStyle: JSX.CSSProperties = {
    color: "var(--text-secondary)",
    flex: "1",
  };

  const smallBtnStyle: JSX.CSSProperties = {
    height: "22px",
    padding: "0 8px",
    "border-radius": "4px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "var(--bg-interactive)",
    color: "var(--text-dimmer)",
    cursor: "pointer",
    "font-size": "11px",
    "font-family": "var(--font-mono)",
    "white-space": "nowrap",
  };

  const dangerBtnStyle: JSX.CSSProperties = {
    ...smallBtnStyle,
    background: "rgba(231,76,60,0.12)",
    border: "1px solid rgba(231,76,60,0.25)",
    color: "#e74c3c",
  };

  const saveBtnStyle = (): JSX.CSSProperties => ({
    ...smallBtnStyle,
    background: hasChanges()
      ? "rgba(52,152,219,0.15)"
      : "var(--bg-interactive)",
    border: hasChanges()
      ? "1px solid rgba(52,152,219,0.3)"
      : "1px solid rgba(255,255,255,0.08)",
    color: hasChanges() ? "#3498db" : "var(--text-dimmest)",
    cursor: hasChanges() ? "pointer" : "not-allowed",
    opacity: hasChanges() ? "1" : "0.5",
  });

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "10px 14px",
          "border-bottom": "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {/* Color dot */}
        <span
          style={{
            width: "10px",
            height: "10px",
            "border-radius": "50%",
            background: color(),
            "flex-shrink": "0",
          }}
        />
        <input
          type="text"
          value={label()}
          onInput={(e) => setLabel(e.currentTarget.value)}
          style={{
            flex: "1",
            height: "22px",
            padding: "0 6px",
            "border-radius": "4px",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text-primary)",
            "font-size": "12px",
            "font-family": "var(--font-mono)",
            "font-weight": "600",
          }}
        />
        <button
          onClick={props.onClose}
          title="Close"
          style={{
            ...smallBtnStyle,
            padding: "0 6px",
            "font-size": "14px",
            color: "var(--text-dimmer)",
          }}
        >
          ×
        </button>
      </div>

      {/* Frame rows */}
      <div style={sectionStyle}>
        <div style={rowStyle}>
          <span style={labelStyle}>In Frame</span>
          <span style={valueStyle}>{formatFrame(inFrame())}</span>
          <button style={smallBtnStyle} onClick={() => setInFrame(props.currentFrame())}>
            Set to playhead
          </button>
        </div>
        <div style={rowStyle}>
          <span style={labelStyle}>Out Frame</span>
          <span style={valueStyle}>{formatFrame(outFrame())}</span>
          <button style={smallBtnStyle} onClick={() => setOutFrame(props.currentFrame())}>
            Set to playhead
          </button>
        </div>
      </div>

      {/* Color picker */}
      <div
        style={{
          ...sectionStyle,
          padding: "8px 14px",
          "border-bottom": "1px solid rgba(255,255,255,0.04)",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", gap: "6px", "flex-wrap": "wrap" }}>
          <span style={{ ...labelStyle, "min-width": "unset" }}>Color</span>
          <For each={COLOR_PALETTE}>
            {(c) => (
              <button
                onClick={() => setColor(c)}
                title={c}
                style={{
                  width: "16px",
                  height: "16px",
                  padding: "0",
                  border: color() === c ? "2px solid white" : "2px solid transparent",
                  "border-radius": "3px",
                  background: c,
                  cursor: "pointer",
                  "flex-shrink": "0",
                  outline: color() === c ? "1px solid rgba(0,0,0,0.4)" : "none",
                }}
              />
            )}
          </For>
        </div>
      </div>

      {/* Redraw region */}
      <div
        style={{
          ...sectionStyle,
          padding: "8px 14px",
          "border-bottom": "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <button
          style={smallBtnStyle}
          onClick={props.onDrawRegion}
        >
          {drawRegionLabel()}
        </button>
      </div>

      {/* Delete section */}
      <div
        style={{
          ...sectionStyle,
          padding: "8px 14px",
          "border-bottom": "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <Show
          when={confirmDelete()}
          fallback={
            <button style={dangerBtnStyle} onClick={() => setConfirmDelete(true)}>
              Delete Action
            </button>
          }
        >
          <div style={{ display: "flex", "align-items": "center", gap: "8px", "flex-wrap": "wrap" }}>
            <span style={{ color: "var(--text-secondary)", "font-size": "11px" }}>Are you sure?</span>
            <button
              style={dangerBtnStyle}
              onClick={props.onDelete}
            >
              Confirm Delete
            </button>
            <button
              style={smallBtnStyle}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        </Show>
      </div>

      {/* Footer: Save / Cancel */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "10px 14px",
          "justify-content": "flex-end",
        }}
      >
        <button style={smallBtnStyle} onClick={props.onClose}>
          Cancel
        </button>
        <button
          style={saveBtnStyle()}
          disabled={!hasChanges()}
          onClick={handleSave}
        >
          Save
        </button>
      </div>
    </div>
  );
}
