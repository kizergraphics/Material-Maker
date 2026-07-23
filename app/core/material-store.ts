"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";
import { create } from "zustand";
import {
  DEFAULT_MAP_SETTINGS,
  NODE_LIBRARY,
  PROJECT_SCHEMA_VERSION,
  createStarterProject,
  type MaterialGraphEdge,
  type MaterialGraphNode,
  type MaterialNodeKind,
  type MaterialProject,
  type MapGenerationSettings,
  type NodeValueMap,
  type ExportResolution,
  type PreviewChannel,
  type PreviewSettings,
  type PreviewShape,
  type SourceTextureAsset,
  type TextureMapChannel,
} from "./material-types";

type Snapshot = {
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
  preview: PreviewSettings;
  sourceTexture: SourceTextureAsset | null;
  mapSettings: MapGenerationSettings;
  exportResolution: ExportResolution;
};

type MaterialStore = {
  projectId: string;
  projectName: string;
  createdAt: string;
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
  preview: PreviewSettings;
  sourceTexture: SourceTextureAsset | null;
  mapSettings: MapGenerationSettings;
  exportResolution: ExportResolution;
  selectedNodeId: string | null;
  hydrated: boolean;
  past: Snapshot[];
  future: Snapshot[];
  setHydrated: (value: boolean) => void;
  setProjectName: (name: string) => void;
  setSelectedNode: (nodeId: string | null) => void;
  onNodesChange: (changes: NodeChange<MaterialGraphNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<MaterialGraphEdge>[]) => void;
  onConnect: (connection: Connection) => void;
  addNode: (kind: MaterialNodeKind, position?: XYPosition) => void;
  syncGeneratedMapsToGraph: (
    thumbnails?: Partial<Record<TextureMapChannel, string>>,
  ) => void;
  updateNodeValue: (nodeId: string, values: Partial<NodeValueMap>) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  setShape: (shape: PreviewShape) => void;
  setChannel: (channel: PreviewChannel) => void;
  togglePreview: (key: "showGrid" | "autoRotate" | "tiled") => void;
  setSourceTexture: (source: SourceTextureAsset) => void;
  removeSourceTexture: () => void;
  updateMapSettings: (
    map: keyof MapGenerationSettings,
    values: Record<string, number | boolean>,
  ) => void;
  resetMapSettings: () => void;
  setExportResolution: (resolution: ExportResolution) => void;
  replaceProject: (project: MaterialProject) => void;
  newProject: () => void;
  toProject: () => MaterialProject;
};

const starter = createStarterProject();

function snapshot(
  state: Pick<
    MaterialStore,
    "nodes" | "edges" | "preview" | "sourceTexture" | "mapSettings" | "exportResolution"
  >,
) {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    preview: structuredClone(state.preview),
    // Source image data is immutable; retain the reference so slider history does
    // not duplicate a potentially large data URL dozens of times.
    sourceTexture: state.sourceTexture,
    mapSettings: structuredClone(state.mapSettings),
    exportResolution: state.exportResolution,
  };
}

function withCheckpoint(state: MaterialStore) {
  return {
    past: [...state.past.slice(-39), snapshot(state)],
    future: [],
  };
}

export const useMaterialStore = create<MaterialStore>((set, get) => ({
  projectId: starter.id,
  projectName: starter.name,
  createdAt: starter.createdAt,
  nodes: starter.nodes,
  edges: starter.edges,
  preview: starter.preview,
  sourceTexture: starter.sourceTexture,
  mapSettings: starter.mapSettings,
  exportResolution: starter.exportResolution,
  selectedNodeId: "blend",
  hydrated: false,
  past: [],
  future: [],

  setHydrated: (value) => set({ hydrated: value }),
  setProjectName: (name) => set({ projectName: name.slice(0, 160) }),
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId }),

  onNodesChange: (changes) => {
    const shouldCheckpoint = changes.some(
      (change) => change.type === "remove" || change.type === "add",
    );
    set((state) => ({
      ...(shouldCheckpoint ? withCheckpoint(state) : {}),
      nodes: applyNodeChanges(changes, state.nodes),
      selectedNodeId: changes.some(
        (change) => change.type === "remove" && change.id === state.selectedNodeId,
      )
        ? null
        : state.selectedNodeId,
    }));
  },

  onEdgesChange: (changes) => {
    const shouldCheckpoint = changes.some((change) => change.type === "remove");
    set((state) => ({
      ...(shouldCheckpoint ? withCheckpoint(state) : {}),
      edges: applyEdgeChanges(changes, state.edges),
    }));
  },

  onConnect: (connection) =>
    set((state) => ({
      ...withCheckpoint(state),
      edges: addEdge(
        {
          ...connection,
          id: `edge-${crypto.randomUUID()}`,
          animated: false,
        },
        state.edges.filter(
          (edge) =>
            !(
              edge.target === connection.target &&
              edge.targetHandle === connection.targetHandle
            ),
        ),
      ),
    })),

  addNode: (kind, position = { x: 20, y: 20 }) => {
    const definition = NODE_LIBRARY.find((item) => item.kind === kind);
    if (!definition) return;
    const node: MaterialGraphNode = {
      id: `${kind}-${crypto.randomUUID()}`,
      type: "materialNode",
      position,
      data: {
        label: definition.label,
        kind,
        category: definition.category,
        values: { ...definition.defaultValues },
      },
    };
    set((state) => ({
      ...withCheckpoint(state),
      nodes: [...state.nodes, node],
      selectedNodeId: node.id,
    }));
  },

  syncGeneratedMapsToGraph: (thumbnails = {}) => {
    const channels: Array<{ id: TextureMapChannel; label: string }> = [
      { id: "baseColor", label: "Generated albedo" },
      { id: "height", label: "Generated height" },
      { id: "normal", label: "Generated normal" },
      { id: "roughness", label: "Generated roughness" },
      { id: "metallic", label: "Generated metallic" },
      { id: "ao", label: "Generated AO" },
    ];
    set((state) => {
      const output = state.nodes.find((node) => node.data.kind === "output");
      if (!output || !state.sourceTexture) return state;
      const generatedIds = new Set(channels.map((channel) => `generated-map-${channel.id}`));
      const generatedNodes: MaterialGraphNode[] = channels.map((channel, index) => ({
        id: `generated-map-${channel.id}`,
        type: "materialNode",
        position: { x: output.position.x - 310, y: output.position.y - 72 + index * 96 },
        data: {
          label: channel.label,
          kind: "textureMap",
          category: "input",
          values: {
            mapChannel: channel.id,
            enabled: state.mapSettings[channel.id].enabled,
            thumbnail: thumbnails[channel.id],
          },
        },
      }));
      const outputHandles = new Set<TextureMapChannel>(channels.map((channel) => channel.id));
      const retainedEdges = state.edges.filter(
        (edge) =>
          !generatedIds.has(edge.source) &&
          !(edge.target === output.id && outputHandles.has(edge.targetHandle as TextureMapChannel)),
      );
      const generatedEdges: MaterialGraphEdge[] = channels
        .filter((channel) => state.mapSettings[channel.id].enabled)
        .map((channel) => ({
          id: `generated-map-edge-${channel.id}`,
          source: `generated-map-${channel.id}`,
          sourceHandle: "out",
          target: output.id,
          targetHandle: channel.id,
        }));
      return {
        ...withCheckpoint(state),
        nodes: [
          ...state.nodes.filter((node) => !generatedIds.has(node.id)),
          ...generatedNodes,
        ],
        edges: [...retainedEdges, ...generatedEdges],
        selectedNodeId: "generated-map-baseColor",
      };
    });
  },

  updateNodeValue: (nodeId, values) =>
    set((state) => ({
      ...withCheckpoint(state),
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                values: { ...node.data.values, ...values },
              },
            }
          : node,
      ),
    })),

  checkpoint: () => set((state) => withCheckpoint(state)),

  undo: () => {
    const state = get();
    const previous = state.past.at(-1);
    if (!previous) return;
    set({
      ...previous,
      past: state.past.slice(0, -1),
      future: [snapshot(state), ...state.future].slice(0, 40),
    });
  },

  redo: () => {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    set({
      ...next,
      past: [...state.past, snapshot(state)].slice(-40),
      future: state.future.slice(1),
    });
  },

  setShape: (shape) =>
    set((state) => ({ preview: { ...state.preview, shape } })),
  setChannel: (channel) =>
    set((state) => ({ preview: { ...state.preview, channel } })),
  togglePreview: (key) =>
    set((state) => ({
      preview: { ...state.preview, [key]: !state.preview[key] },
    })),

  setSourceTexture: (sourceTexture) =>
    set((state) => ({
      ...withCheckpoint(state),
      sourceTexture,
      preview: { ...state.preview, channel: "material" },
    })),

  removeSourceTexture: () =>
    set((state) => {
      const generatedIds = new Set(
        (["baseColor", "height", "normal", "roughness", "metallic", "ao"] as TextureMapChannel[])
          .map((channel) => `generated-map-${channel}`),
      );
      return {
        ...withCheckpoint(state),
        sourceTexture: null,
        nodes: state.nodes.filter((node) => !generatedIds.has(node.id)),
        edges: state.edges.filter((edge) => !generatedIds.has(edge.source)),
        preview: { ...state.preview, channel: "material" },
      };
    }),

  updateMapSettings: (map, values) =>
    set((state) => {
      const generatedNodeId = `generated-map-${map}`;
      const generatedNodeExists = state.nodes.some((node) => node.id === generatedNodeId);
      const enabled = values.enabled;
      let nextNodes = state.nodes;
      let nextEdges = state.edges;
      if (generatedNodeExists && typeof enabled === "boolean") {
        nextNodes = state.nodes.map((node) =>
          node.id === generatedNodeId
            ? { ...node, data: { ...node.data, values: { ...node.data.values, enabled } } }
            : node,
        );
        nextEdges = state.edges.filter((edge) => edge.id !== `generated-map-edge-${map}`);
        const output = state.nodes.find((node) => node.data.kind === "output");
        if (enabled && output) {
          nextEdges = [...nextEdges, {
            id: `generated-map-edge-${map}`,
            source: generatedNodeId,
            sourceHandle: "out",
            target: output.id,
            targetHandle: map,
          }];
        }
      }
      return {
        ...withCheckpoint(state),
        nodes: nextNodes,
        edges: nextEdges,
        mapSettings: {
          ...state.mapSettings,
          [map]: { ...state.mapSettings[map], ...values },
        },
      };
    }),

  resetMapSettings: () =>
    set((state) => ({
      ...withCheckpoint(state),
      mapSettings: structuredClone(DEFAULT_MAP_SETTINGS),
    })),

  setExportResolution: (exportResolution) => set({ exportResolution }),

  replaceProject: (project) =>
    set({
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      nodes: project.nodes,
      edges: project.edges,
      preview: project.preview,
      sourceTexture: project.sourceTexture,
      mapSettings: project.mapSettings,
      exportResolution: project.exportResolution,
      selectedNodeId: null,
      past: [],
      future: [],
    }),

  newProject: () => {
    const project = createStarterProject();
    project.id = crypto.randomUUID();
    project.name = "Untitled Material";
    project.createdAt = new Date().toISOString();
    project.updatedAt = project.createdAt;
    get().replaceProject(project);
  },

  toProject: () => {
    const state = get();
    return {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: state.projectId,
      name: state.projectName.trim() || "Untitled Material",
      createdAt: state.createdAt,
      updatedAt: new Date().toISOString(),
      nodes: state.nodes,
      edges: state.edges,
      preview: state.preview,
      sourceTexture: state.sourceTexture,
      mapSettings: state.mapSettings,
      exportResolution: state.exportResolution,
    };
  },
}));
