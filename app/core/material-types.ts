import type { Edge, Node } from "@xyflow/react";

export const PROJECT_SCHEMA_VERSION = 3 as const;

export type MaterialNodeKind =
  | "color"
  | "noise"
  | "levels"
  | "blend"
  | "roughness"
  | "metallic"
  | "normal"
  | "textureMap"
  | "output";

export type PreviewShape = "sphere" | "cube" | "plane";
export type PreviewChannel =
  | "material"
  | "baseColor"
  | "height"
  | "normal"
  | "roughness"
  | "metallic"
  | "ao";

export type TextureMapChannel = Exclude<PreviewChannel, "material">;

export interface SourceTextureAsset {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface MapGenerationSettings {
  baseColor: {
    enabled: boolean;
    brightness: number;
    contrast: number;
    saturation: number;
    hue: number;
  };
  height: {
    enabled: boolean;
    contrast: number;
    bias: number;
    blur: number;
    invert: boolean;
  };
  normal: {
    enabled: boolean;
    strength: number;
    detail: number;
    invertY: boolean;
  };
  roughness: {
    enabled: boolean;
    base: number;
    variation: number;
    invert: boolean;
  };
  metallic: {
    enabled: boolean;
    base: number;
    variation: number;
    invert: boolean;
  };
  ao: {
    enabled: boolean;
    strength: number;
    radius: number;
    bias: number;
  };
}

export type ExportResolution = 512 | 1024 | 2048;

export const DEFAULT_MAP_SETTINGS: MapGenerationSettings = {
  baseColor: { enabled: true, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
  height: { enabled: true, contrast: 1.18, bias: 0, blur: 1, invert: false },
  normal: { enabled: true, strength: 2.2, detail: 1, invertY: false },
  roughness: { enabled: true, base: 0.62, variation: 0.34, invert: false },
  metallic: { enabled: true, base: 0, variation: 0, invert: false },
  ao: { enabled: true, strength: 1.2, radius: 4, bias: 0 },
};

export type NodeValueMap = {
  color?: string;
  scale?: number;
  contrast?: number;
  seed?: number;
  minimum?: number;
  maximum?: number;
  gamma?: number;
  opacity?: number;
  value?: number;
  strength?: number;
  mapChannel?: TextureMapChannel;
  enabled?: boolean;
  thumbnail?: string;
};

export type MaterialNodeData = Record<string, unknown> & {
  label: string;
  kind: MaterialNodeKind;
  category: "input" | "generator" | "filter" | "blend" | "output";
  values: NodeValueMap;
};

export type MaterialGraphNode = Node<MaterialNodeData, "materialNode">;
export type MaterialGraphEdge = Edge;

export interface PreviewSettings {
  shape: PreviewShape;
  channel: PreviewChannel;
  showGrid: boolean;
  autoRotate: boolean;
  tiled: boolean;
}

export interface MaterialProject {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
  preview: PreviewSettings;
  sourceTexture: SourceTextureAsset | null;
  mapSettings: MapGenerationSettings;
  exportResolution: ExportResolution;
}

export interface MaterialPackManifest {
  format: "forge-material-pack";
  formatVersion: 1;
  createdAt: string;
  generator: "Forge Material Studio";
  projectName: string;
  projectFile: "material.json";
  privacy: "local-only";
}

export const NODE_LIBRARY: Array<{
  kind: MaterialNodeKind;
  label: string;
  category: MaterialNodeData["category"];
  description: string;
  defaultValues: NodeValueMap;
}> = [
  {
    kind: "color",
    label: "Base color",
    category: "input",
    description: "A color value in sRGB space.",
    defaultValues: { color: "#76706a" },
  },
  {
    kind: "noise",
    label: "Value noise",
    category: "generator",
    description: "Deterministic tileable value noise.",
    defaultValues: { scale: 8, contrast: 0.62, seed: 14 },
  },
  {
    kind: "levels",
    label: "Levels",
    category: "filter",
    description: "Remap the tonal range of an input.",
    defaultValues: { minimum: 0.18, maximum: 0.88, gamma: 1.08 },
  },
  {
    kind: "blend",
    label: "Blend",
    category: "blend",
    description: "Mix two color or scalar streams.",
    defaultValues: { opacity: 0.54 },
  },
  {
    kind: "roughness",
    label: "Roughness",
    category: "input",
    description: "Linear surface roughness.",
    defaultValues: { value: 0.58 },
  },
  {
    kind: "metallic",
    label: "Metallic",
    category: "input",
    description: "Metal-versus-dielectric response.",
    defaultValues: { value: 0.82 },
  },
  {
    kind: "normal",
    label: "Normal from height",
    category: "filter",
    description: "Derive a tangent-space normal map.",
    defaultValues: { strength: 1.35 },
  },
];

const now = "2026-07-22T00:00:00.000Z";

export function createStarterProject(): MaterialProject {
  const nodes: MaterialGraphNode[] = [
    {
      id: "base-color",
      type: "materialNode",
      position: { x: -610, y: -55 },
      data: {
        label: "Warm alloy",
        kind: "color",
        category: "input",
        values: { color: "#756f68" },
      },
    },
    {
      id: "surface-noise",
      type: "materialNode",
      position: { x: -610, y: 128 },
      data: {
        label: "Micro pitting",
        kind: "noise",
        category: "generator",
        values: { scale: 9, contrast: 0.66, seed: 14 },
      },
    },
    {
      id: "levels",
      type: "materialNode",
      position: { x: -345, y: 130 },
      data: {
        label: "Pitting levels",
        kind: "levels",
        category: "filter",
        values: { minimum: 0.16, maximum: 0.86, gamma: 1.12 },
      },
    },
    {
      id: "blend",
      type: "materialNode",
      position: { x: -80, y: -12 },
      data: {
        label: "Surface variation",
        kind: "blend",
        category: "blend",
        values: { opacity: 0.46 },
      },
    },
    {
      id: "normal",
      type: "materialNode",
      position: { x: -75, y: 205 },
      data: {
        label: "Micro normal",
        kind: "normal",
        category: "filter",
        values: { strength: 1.42 },
      },
    },
    {
      id: "roughness",
      type: "materialNode",
      position: { x: 178, y: 238 },
      data: {
        label: "Roughness",
        kind: "roughness",
        category: "input",
        values: { value: 0.56 },
      },
    },
    {
      id: "metallic",
      type: "materialNode",
      position: { x: 178, y: 355 },
      data: {
        label: "Metallic",
        kind: "metallic",
        category: "input",
        values: { value: 0.82 },
      },
    },
    {
      id: "material-output",
      type: "materialNode",
      position: { x: 455, y: 70 },
      data: {
        label: "PBR material",
        kind: "output",
        category: "output",
        values: {},
      },
    },
  ];

  const edges: MaterialGraphEdge[] = [
    {
      id: "e-color-blend",
      source: "base-color",
      target: "blend",
      sourceHandle: "out",
      targetHandle: "a",
    },
    {
      id: "e-noise-levels",
      source: "surface-noise",
      target: "levels",
      sourceHandle: "out",
      targetHandle: "in",
    },
    {
      id: "e-levels-blend",
      source: "levels",
      target: "blend",
      sourceHandle: "out",
      targetHandle: "b",
    },
    {
      id: "e-levels-normal",
      source: "levels",
      target: "normal",
      sourceHandle: "out",
      targetHandle: "height",
    },
    {
      id: "e-blend-output",
      source: "blend",
      target: "material-output",
      sourceHandle: "out",
      targetHandle: "baseColor",
    },
    {
      id: "e-normal-output",
      source: "normal",
      target: "material-output",
      sourceHandle: "normal",
      targetHandle: "normal",
    },
    {
      id: "e-roughness-output",
      source: "roughness",
      target: "material-output",
      sourceHandle: "out",
      targetHandle: "roughness",
    },
    {
      id: "e-metallic-output",
      source: "metallic",
      target: "material-output",
      sourceHandle: "out",
      targetHandle: "metallic",
    },
  ];

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "oxidized-alloy",
    name: "Oxidized Alloy",
    createdAt: now,
    updatedAt: now,
    nodes,
    edges,
    preview: {
      shape: "sphere",
      channel: "material",
      showGrid: true,
      autoRotate: true,
      tiled: true,
    },
    sourceTexture: null,
    mapSettings: structuredClone(DEFAULT_MAP_SETTINGS),
    exportResolution: 1024,
  };
}
