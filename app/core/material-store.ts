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
  NODE_LIBRARY,
  PROJECT_SCHEMA_VERSION,
  createStarterProject,
  type MaterialGraphEdge,
  type MaterialGraphNode,
  type MaterialNodeKind,
  type MaterialProject,
  type NodeValueMap,
  type PreviewChannel,
  type PreviewSettings,
  type PreviewShape,
} from "./material-types";

type Snapshot = {
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
  preview: PreviewSettings;
};

type MaterialStore = {
  projectId: string;
  projectName: string;
  createdAt: string;
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
  preview: PreviewSettings;
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
  updateNodeValue: (nodeId: string, values: Partial<NodeValueMap>) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  setShape: (shape: PreviewShape) => void;
  setChannel: (channel: PreviewChannel) => void;
  togglePreview: (key: "showGrid" | "autoRotate" | "tiled") => void;
  replaceProject: (project: MaterialProject) => void;
  newProject: () => void;
  toProject: () => MaterialProject;
};

const starter = createStarterProject();

function snapshot(state: Pick<MaterialStore, "nodes" | "edges" | "preview">) {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    preview: structuredClone(state.preview),
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

  replaceProject: (project) =>
    set({
      projectId: project.id,
      projectName: project.name,
      createdAt: project.createdAt,
      nodes: project.nodes,
      edges: project.edges,
      preview: project.preview,
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
    };
  },
}));
