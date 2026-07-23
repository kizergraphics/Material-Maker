"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Blend,
  Box,
  CircleGauge,
  Dices,
  Gem,
  Image,
  Palette,
  SlidersHorizontal,
  Waves,
} from "lucide-react";
import type { ComponentType } from "react";
import type {
  MaterialGraphNode,
  MaterialNodeData,
  MaterialNodeKind,
} from "../core/material-types";

const icons: Record<MaterialNodeKind, ComponentType<{ size?: number }>> = {
  color: Palette,
  noise: Dices,
  levels: SlidersHorizontal,
  blend: Blend,
  roughness: CircleGauge,
  metallic: Gem,
  normal: Waves,
  textureMap: Image,
  output: Box,
};

const inputs: Partial<Record<MaterialNodeKind, Array<{ id: string; label: string }>>> = {
  levels: [{ id: "in", label: "Input" }],
  blend: [
    { id: "a", label: "Base" },
    { id: "b", label: "Blend" },
  ],
  normal: [{ id: "height", label: "Height" }],
  output: [
    { id: "baseColor", label: "Base color" },
    { id: "normal", label: "Normal" },
    { id: "roughness", label: "Roughness" },
    { id: "metallic", label: "Metallic" },
    { id: "height", label: "Height" },
    { id: "ao", label: "AO" },
  ],
};

function valueSummary(data: MaterialNodeData) {
  const values = data.values;
  switch (data.kind) {
    case "color":
      return values.color ?? "#808080";
    case "noise":
      return `${values.scale ?? 8}× tile · seed ${values.seed ?? 1}`;
    case "levels":
      return `${(values.minimum ?? 0).toFixed(2)} — ${(values.maximum ?? 1).toFixed(2)}`;
    case "blend":
      return `${Math.round((values.opacity ?? 0.5) * 100)}% opacity`;
    case "roughness":
    case "metallic":
      return (values.value ?? 0.5).toFixed(2);
    case "normal":
      return `${(values.strength ?? 1).toFixed(2)} strength`;
    case "textureMap":
      return `${values.mapChannel ?? "texture"}${values.enabled === false ? " · disabled" : " · generated"}`;
    default:
      return "Metallic / roughness";
  }
}

export function MaterialNode(props: NodeProps<MaterialGraphNode>) {
  const { data, selected } = props;
  const Icon = icons[data.kind];
  const nodeInputs = inputs[data.kind] ?? [];
  const color = data.values.color;

  return (
    <article
      className={`material-node material-node--${data.category}${selected ? " is-selected" : ""}`}
      data-kind={data.kind}
    >
      <header className="material-node__header">
        <span className="material-node__icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <span>{data.label}</span>
        <span className="material-node__type">{data.kind}</span>
      </header>

      <div className="material-node__body">
        {color ? (
          <span
            className="material-node__swatch"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        ) : null}
        <span className="material-node__summary">{valueSummary(data)}</span>
      </div>

      {nodeInputs.map((input, index) => (
        <div
          className="material-node__input"
          key={input.id}
          style={{ top: 48 + index * 22 }}
        >
          <Handle
            id={input.id}
            type="target"
            position={Position.Left}
            className="material-handle material-handle--input"
          />
          <span>{input.label}</span>
        </div>
      ))}

      {data.kind !== "output" ? (
        <Handle
          id={data.kind === "normal" ? "normal" : "out"}
          type="source"
          position={Position.Right}
          className="material-handle material-handle--output"
        />
      ) : null}
    </article>
  );
}
