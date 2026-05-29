import { createSignal, For } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { ArmaCoord } from "../../../utils/coordinates";
import styles from "./BottomBar.module.css";

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
  onSave: (action: {
    label: string;
    color: string;
    inFrame: number;
    outFrame: number;
    polygon: ArmaCoord[];
  }) => void;
  onCancel: () => void;
  onDrawRegion: () => void;
  currentFrame: Accessor<number>;
  endFrame: Accessor<number>;
  isDrawing: Accessor<boolean>;
  polygonSet: Accessor<boolean>;
  drawnPolygon: Accessor<ArmaCoord[] | null>;
  actionCount: Accessor<number>;
}

function formatFrame(frame: number): string {
  return `frame ${frame}`;
}

export function ActionCreationToolbar(props: Props): JSX.Element {
  const initialColor = () => COLOR_PALETTE[props.actionCount() % COLOR_PALETTE.length];
  const initialLabel = () => `Action ${props.actionCount() + 1}`;

  const [label, setLabel] = createSignal(initialLabel());
  const [inFrame, setInFrame] = createSignal(0);
  const [outFrame, setOutFrame] = createSignal(props.endFrame());
  const [color, setColor] = createSignal(initialColor());

  const canSave = () =>
    props.polygonSet() && inFrame() < outFrame();

  function handleSave() {
    const polygon = props.drawnPolygon();
    if (!polygon) return;
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
    if (props.polygonSet()) return "✓ Region Set";
    return "Draw Region";
  }

  return (
    <div class={styles.focusToolbarRow}>
      <div class={styles.focusToolbarLeft}>
        <span class={styles.focusToolbarLabel}>New Action</span>

        {/* Label input */}
        <input
          type="text"
          value={label()}
          onInput={(e) => setLabel(e.currentTarget.value)}
          style={{
            height: "22px",
            padding: "0 6px",
            "border-radius": "4px",
            border: "1px solid rgba(255,255,255,0.12)",
            background: "var(--bg-interactive)",
            color: "var(--text-primary)",
            "font-size": "var(--font-size-sm)",
            "font-family": "var(--font-mono)",
            "min-width": "120px",
          }}
        />
      </div>

      <div class={styles.focusToolbarRight}>
        {/* In frame */}
        <button
          class={`${styles.focusToolbarBtn} ${styles.focusToolbarGold}`}
          onClick={() => setInFrame(props.currentFrame())}
          title="Set in-point to playhead"
        >
          Set Start
        </button>
        <span class={styles.focusToolbarRange}>{formatFrame(inFrame())}</span>

        <div class={styles.focusToolbarSep} />

        {/* Out frame */}
        <button
          class={`${styles.focusToolbarBtn} ${styles.focusToolbarGold}`}
          onClick={() => setOutFrame(props.currentFrame())}
          title="Set out-point to playhead"
        >
          Set End
        </button>
        <span class={styles.focusToolbarRange}>{formatFrame(outFrame())}</span>

        <div class={styles.focusToolbarSep} />

        {/* Draw region */}
        <button
          class={styles.focusToolbarBtn}
          onClick={props.onDrawRegion}
        >
          {drawRegionLabel()}
        </button>

        <div class={styles.focusToolbarSep} />

        {/* Color swatches */}
        <For each={COLOR_PALETTE}>
          {(c) => (
            <button
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: "16px",
                height: "16px",
                padding: "0",
                border: color() === c
                  ? "2px solid white"
                  : "2px solid transparent",
                "border-radius": "3px",
                background: c,
                cursor: "pointer",
                "flex-shrink": "0",
                outline: color() === c ? "1px solid rgba(0,0,0,0.4)" : "none",
              }}
            />
          )}
        </For>

        <div class={styles.focusToolbarSep} />

        {/* Save */}
        <button
          class={`${styles.focusToolbarBtn} ${styles.focusToolbarSave}`}
          onClick={handleSave}
          disabled={!canSave()}
          style={{ opacity: canSave() ? "1" : "0.4", cursor: canSave() ? "pointer" : "not-allowed" }}
        >
          Save
        </button>

        {/* Cancel */}
        <button class={styles.focusToolbarBtn} onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
