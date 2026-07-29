import type { Edge, Node } from "@xyflow/react";
import { createMaterialNodeData } from "./material-node-registry";
import type {
  MaterialNodeCategory,
  MaterialNodeKind,
  NodeValueMap,
  TextureMapChannel,
} from "./material-node-registry";

export type {
  MaterialNodeCategory,
  MaterialNodeKind,
  NodeValueMap,
  TextureMapChannel,
} from "./material-node-registry";

export const PROJECT_SCHEMA_VERSION = 3 as const;

export type PreviewShape = "sphere" | "cube" | "plane";
export type PreviewChannel = "material" | TextureMapChannel;

export interface SourceTextureAsset {
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  fingerprint?: string;
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

export type MaterialNodeData = Record<string, unknown> & {
  label: string;
  kind: MaterialNodeKind;
  category: MaterialNodeCategory;
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

export function createStarterProject(): MaterialProject {
  const now = new Date().toISOString();

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: "untitled-material",
    name: "Untitled Material",
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: "material-output",
        type: "materialNode",
        position: { x: 80, y: 40 },
        data: createMaterialNodeData("output"),
      },
    ],
    edges: [],
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
