import { For } from "solid-js";
import type { Accessor, JSX } from "solid-js";
import type { ActionDefinition } from "../../../data/types";
import type { ArmaCoord } from "../../../utils/coordinates";

interface Props {
  actions: Accessor<ActionDefinition[]>;
  armaToScreen: (coord: ArmaCoord) => { x: number; y: number };
}

/**
 * SVG overlay that renders polygon outlines for all defined actions.
 * Positioned absolutely over the map, pointer-events none, z-index 400
 * (below the entity canvas but above tiles).
 */
export function ActionPolygonLayer(props: Props): JSX.Element {
  const visibleActions = () =>
    props.actions().filter(
      (a) => a.status === "ready" || a.status === "pending",
    );

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
          const pointsAttr = () =>
            action.polygon
              .map((coord) => {
                const { x, y } = props.armaToScreen(coord);
                return `${x},${y}`;
              })
              .join(" ");

          // Parse the color and build an rgba fill at 15% opacity
          const fillColor = () => {
            const c = action.color;
            // Hex shorthand (#abc → #aabbcc) or full hex
            if (c.startsWith("#")) {
              let hex = c.slice(1);
              if (hex.length === 3) {
                hex = hex
                  .split("")
                  .map((ch) => ch + ch)
                  .join("");
              }
              const r = parseInt(hex.slice(0, 2), 16);
              const g = parseInt(hex.slice(2, 4), 16);
              const b = parseInt(hex.slice(4, 6), 16);
              return `rgba(${r},${g},${b},0.15)`;
            }
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
