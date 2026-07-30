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
import {
  getMaterialNodeDefinition,
  type MaterialNodeKind,
} from "../core/material-node-registry";
import type { MaterialGraphNode } from "../core/material-types";

const icons: Record<MaterialNodeKind, ComponentType<{ size?: number }>> = {
  color: Palette,
  noise: Dices,
  levels: SlidersHorizontal,
  blend: Blend,
  channels: SlidersHorizontal,
  roughness: CircleGauge,
  metallic: Gem,
  normal: Waves,
  textureMap: Image,
  output: Box,
};

export function MaterialNode(props: NodeProps<MaterialGraphNode>) {
  const { data, selected } = props;
  const Icon = icons[data.kind];
  const definition = getMaterialNodeDefinition(data.kind);
  const portRows = Math.max(definition.inputs.length, definition.outputs.length);
  const color = data.values.color;
  const thumbnail = data.values.thumbnail;
  const validationIssues = Array.isArray(data.validationIssues)
    ? data.validationIssues.filter(
        (issue): issue is string => typeof issue === "string",
      )
    : [];

  return (
    <article
      className={`material-node material-node--${data.category}${thumbnail ? " has-thumbnail" : ""}${validationIssues.length ? " is-invalid" : ""}${selected ? " is-selected" : ""}`}
      data-kind={data.kind}
      style={{ minHeight: Math.max(78, 58 + portRows * 22) }}
    >
      <header className="material-node__header">
        <span className="material-node__icon" aria-hidden="true">
          <Icon size={14} />
        </span>
        <span>{data.label}</span>
        <span className="material-node__type">{data.kind}</span>
        {validationIssues.length ? (
          <span
            className="material-node__validation"
            title={validationIssues.join("\n")}
            aria-label={`${validationIssues.length} graph validation issue${validationIssues.length === 1 ? "" : "s"}`}
          >
            !
          </span>
        ) : null}
      </header>

      <div className="material-node__body">
        {color && !thumbnail ? (
          <span
            className="material-node__swatch"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
        ) : null}
        {thumbnail ? (
          <img
            className="material-node__thumbnail"
            src={thumbnail}
            alt={`${data.values.mapChannel ?? "Generated"} map preview`}
          />
        ) : null}
        <span className="material-node__summary">
          {definition.summarize(data.values)}
        </span>
      </div>

      {definition.inputs.map((input, index) => (
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
            data-port-type={input.type}
            title={`${input.label} · ${input.type}`}
          />
          <span>{input.label}</span>
        </div>
      ))}

      {definition.outputs.map((output, index) => (
        <div
          className="material-node__output"
          key={output.id}
          style={{ top: 48 + index * 22 }}
        >
          <span>{output.label}</span>
          <Handle
            id={output.id}
            type="source"
            position={Position.Right}
            className="material-handle material-handle--output"
            data-port-type={output.type}
            title={`${output.label} · ${output.type}`}
          />
        </div>
      ))}
    </article>
  );
}
