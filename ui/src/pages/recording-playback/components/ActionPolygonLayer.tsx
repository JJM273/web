import { For } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { ActionDefinition } from "../../../data/types";
import type { ArmaCoord } from "../../../utils/coordinates";
import { useEngine } from "../../../hooks/useEngine";

interface Props {
  actions: Accessor<ActionDefinition[]>;
  armaToScreen: (coord: ArmaCoord) => { x: number; y: number };
  mapVersion?: Accessor<number>;
}

function hexToRgba(hex: string, alpha: number): string {
  // strip leading #
  let c = hex.startsWith("#") ? hex.slice(1) : hex;
  // expand 3-char shorthand to 6
  if (c.length === 3) c = c.split("").map((x) => x + x).join("");
  // strip alpha channel if 8-char
  if (c.length === 8) c = c.slice(0, 6);
  // 4-char: expand to 6 (skip alpha)
  if (c.length === 4) c = c.slice(0, 3).split("").map((x) => x + x).join("");
  if (c.length !== 6) return hex; // fallback: can't parse, use original
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  if (!Number.isFinite(r + g + b)) return hex; // fallback
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * SVG overlay that renders polygon outlines for actions active at the current playback frame.
 * Positioned absolutely over the map, pointer-events none, z-index 400.
 * Re-computes screen coordinates whenever the map moves (via mapVersion).
 */
export function ActionPolygonLayer(props: Props): JSX.Element {
  const engine = useEngine();

  const visibleActions = () => {
    const frame = engine.currentFrame();
    return props.actions().filter(
      (a) =>
        (a.status === "ready" || a.status === "pending") &&
        frame >= a.inFrame &&
        frame <= a.outFrame,
    );
  };

  return (
    <svg
      style={{
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        "pointer-events": "none",
        "z-index": "400",
        overflow: "visible",
      }}
    >
      <For each={visibleActions()}>
        {(action) => {
          const pointsAttr = () => {
            // Reading mapVersion creates a reactive dependency so polygons
            // recompute screen coords whenever the map pans or zooms.
            props.mapVersion?.();
            return action.polygon
              .map((coord) => {
                const { x, y } = props.armaToScreen(coord);
                return `${x},${y}`;
              })
              .join(" ");
          };

          const fillColor = () => {
            const c = action.color;
            if (c.startsWith("#")) return hexToRgba(c, 0.15);
            return c;
          };

          return (
            <polygon
              points={pointsAttr()}
              fill={fillColor()}
              stroke={action.color}
              stroke-width="2"
              style={{ "pointer-events": "none" }}
            />
          );
        }}
      </For>
    </svg>
  );
}
