import {
  migrateMaterialNodeState,
  type MaterialNodeCategory,
  type MaterialNodeKind,
} from "./material-node-registry";
import type {
  MaterialGraphEdge,
  MaterialGraphNode,
} from "./material-types";

export type StoredMaterialGraphNode = {
  id: string;
  type?: "materialNode";
  position: { x: number; y: number };
  data: {
    label: string;
    kind: MaterialNodeKind;
    category: MaterialNodeCategory;
    version?: number;
    values: Readonly<Record<string, unknown>>;
  };
};

export type StoredMaterialGraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

type NodePortRenames = {
  inputPortRenames: Readonly<Record<string, string>>;
  outputPortRenames: Readonly<Record<string, string>>;
};

function migratedHandle(
  handle: string | null | undefined,
  renames: Readonly<Record<string, string>> | undefined,
) {
  if (typeof handle !== "string") return handle;
  return renames?.[handle] ?? handle;
}

export function migrateMaterialGraph(
  storedNodes: readonly StoredMaterialGraphNode[],
  storedEdges: readonly StoredMaterialGraphEdge[],
): {
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
} {
  const portRenamesByNodeId = new Map<string, NodePortRenames>();
  const nodes = storedNodes.map((node): MaterialGraphNode => {
    const migrated = migrateMaterialNodeState(
      node.data.kind,
      node.data.version,
      node.data.values,
    );
    if (!portRenamesByNodeId.has(node.id)) {
      portRenamesByNodeId.set(node.id, migrated);
    }
    return {
      ...node,
      type: "materialNode",
      data: {
        ...node.data,
        version: migrated.version,
        values: migrated.values,
      },
    };
  });

  const edges = storedEdges.map((edge): MaterialGraphEdge => {
    const sourceRenames = portRenamesByNodeId.get(edge.source);
    const targetRenames = portRenamesByNodeId.get(edge.target);
    return {
      ...edge,
      sourceHandle: migratedHandle(
        edge.sourceHandle,
        sourceRenames?.outputPortRenames,
      ),
      targetHandle: migratedHandle(
        edge.targetHandle,
        targetRenames?.inputPortRenames,
      ),
    };
  });

  return { nodes, edges };
}
