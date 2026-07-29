import {
  getMaterialNodeDefinition,
  type MaterialPortDefinition,
  type MaterialPortType,
  type TextureMapChannel,
} from "./material-node-registry";
import type {
  MaterialGraphEdge,
  MaterialGraphNode,
  MaterialProject,
} from "./material-types";

export type MaterialGraphDiagnosticSeverity = "error" | "warning";

export type MaterialGraphDiagnosticCode =
  | "duplicate-node-id"
  | "duplicate-edge-id"
  | "missing-output"
  | "multiple-outputs"
  | "category-mismatch"
  | "dangling-edge"
  | "unknown-source-handle"
  | "unknown-target-handle"
  | "type-mismatch"
  | "multiple-inputs"
  | "cycle"
  | "missing-required-input";

export type MaterialGraphDiagnostic = {
  severity: MaterialGraphDiagnosticSeverity;
  code: MaterialGraphDiagnosticCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
  portId?: string;
};

type ResolvedMaterialEdge = {
  edge: MaterialGraphEdge;
  sourceNode: MaterialGraphNode;
  targetNode: MaterialGraphNode;
  sourcePort: MaterialPortDefinition;
  targetPort: MaterialPortDefinition;
  sourceType: MaterialPortType;
};

export type CompiledMaterialGraph = {
  nodesById: ReadonlyMap<string, MaterialGraphNode>;
  outputNode: MaterialGraphNode | undefined;
  validEdges: readonly MaterialGraphEdge[];
  topologicalNodeIds: readonly string[];
  reachableNodeIds: ReadonlySet<string>;
  diagnostics: readonly MaterialGraphDiagnostic[];
  diagnosticsByNode: ReadonlyMap<string, readonly MaterialGraphDiagnostic[]>;
  isValid: boolean;
  sourceFor: (nodeId: string, targetPortId: string) => string | undefined;
};

export type MaterialConnectionLike = {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type MaterialConnectionValidation = {
  valid: boolean;
  reason?: string;
};

const textureChannelTypes: Record<TextureMapChannel, MaterialPortType> = {
  baseColor: "color",
  height: "scalar",
  normal: "normal",
  roughness: "scalar",
  metallic: "scalar",
  ao: "scalar",
};

function resolvedPort(
  ports: readonly MaterialPortDefinition[],
  handleId: string | null | undefined,
) {
  if (handleId) return ports.find((port) => port.id === handleId);
  return ports.length === 1 ? ports[0] : undefined;
}

function outputTypeFor(
  node: MaterialGraphNode,
  port: MaterialPortDefinition,
): MaterialPortType {
  if (node.data.kind !== "textureMap") return port.type;
  const channel = node.data.values.mapChannel;
  return channel ? textureChannelTypes[channel] : "texture";
}

export function areMaterialPortTypesCompatible(
  source: MaterialPortType,
  target: MaterialPortType,
) {
  if (source === target) return true;
  if (source === "normal" || target === "normal") return false;
  if (source === "texture" || target === "texture") return false;
  return true;
}

function pathExists(
  startId: string,
  targetId: string,
  edges: readonly Pick<MaterialGraphEdge, "source" | "target">[],
) {
  const targetsBySource = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = targetsBySource.get(edge.source) ?? [];
    targets.push(edge.target);
    targetsBySource.set(edge.source, targets);
  }

  const pending = [startId];
  const visited = new Set<string>();
  while (pending.length) {
    const nodeId = pending.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    if (nodeId === targetId) return true;
    visited.add(nodeId);
    pending.push(...(targetsBySource.get(nodeId) ?? []));
  }
  return false;
}

export function validateMaterialConnection(
  project: Pick<MaterialProject, "nodes" | "edges">,
  connection: MaterialConnectionLike,
): MaterialConnectionValidation {
  if (!connection.source || !connection.target) {
    return { valid: false, reason: "Both ends of the connection are required." };
  }
  if (connection.source === connection.target) {
    return { valid: false, reason: "A node cannot connect to itself." };
  }

  const sourceNode = project.nodes.find((node) => node.id === connection.source);
  const targetNode = project.nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode) {
    return { valid: false, reason: "The connection references a missing node." };
  }

  const sourceDefinition = getMaterialNodeDefinition(sourceNode.data.kind);
  const targetDefinition = getMaterialNodeDefinition(targetNode.data.kind);
  const sourcePort = resolvedPort(
    sourceDefinition.outputs,
    connection.sourceHandle,
  );
  if (!sourcePort) {
    return { valid: false, reason: "The source socket is not supported." };
  }
  const targetPort = resolvedPort(
    targetDefinition.inputs,
    connection.targetHandle,
  );
  if (!targetPort) {
    return { valid: false, reason: "The target socket is not supported." };
  }

  const sourceType = outputTypeFor(sourceNode, sourcePort);
  if (!areMaterialPortTypesCompatible(sourceType, targetPort.type)) {
    return {
      valid: false,
      reason: `${sourcePort.label} cannot feed ${targetPort.label}.`,
    };
  }

  const retainedEdges = project.edges.filter(
    (edge) =>
      !(
        edge.target === connection.target &&
        (edge.targetHandle ?? targetPort.id) === targetPort.id
      ),
  );
  if (pathExists(connection.target, connection.source, retainedEdges)) {
    return { valid: false, reason: "This connection would create a cycle." };
  }

  return { valid: true };
}

export function compileMaterialGraph(
  project: Pick<MaterialProject, "nodes" | "edges">,
): CompiledMaterialGraph {
  const diagnostics: MaterialGraphDiagnostic[] = [];
  const diagnosticKeys = new Set<string>();
  const addDiagnostic = (diagnostic: MaterialGraphDiagnostic) => {
    const key = [
      diagnostic.code,
      diagnostic.nodeId ?? "",
      diagnostic.edgeId ?? "",
      diagnostic.portId ?? "",
      diagnostic.message,
    ].join(":");
    if (diagnosticKeys.has(key)) return;
    diagnosticKeys.add(key);
    diagnostics.push(diagnostic);
  };

  const nodesById = new Map<string, MaterialGraphNode>();
  for (const node of project.nodes) {
    if (nodesById.has(node.id)) {
      addDiagnostic({
        severity: "error",
        code: "duplicate-node-id",
        nodeId: node.id,
        message: `Multiple nodes use the ID “${node.id}”.`,
      });
      continue;
    }
    nodesById.set(node.id, node);
    const definition = getMaterialNodeDefinition(node.data.kind);
    if (node.data.category !== definition.category) {
      addDiagnostic({
        severity: "warning",
        code: "category-mismatch",
        nodeId: node.id,
        message: `${node.data.label} has outdated category metadata.`,
      });
    }
  }

  const outputNodes = [...nodesById.values()].filter(
    (node) => node.data.kind === "output",
  );
  const outputNode = outputNodes[0];
  if (!outputNode) {
    addDiagnostic({
      severity: "warning",
      code: "missing-output",
      message: "The graph has no PBR material output.",
    });
  }
  for (const extraOutput of outputNodes.slice(1)) {
    addDiagnostic({
      severity: "error",
      code: "multiple-outputs",
      nodeId: extraOutput.id,
      message: "The graph can contain only one PBR material output.",
    });
  }

  const edgeIds = new Set<string>();
  const occupiedInputs = new Map<string, string>();
  const resolvedEdges: ResolvedMaterialEdge[] = [];
  for (const edge of project.edges) {
    if (edgeIds.has(edge.id)) {
      addDiagnostic({
        severity: "error",
        code: "duplicate-edge-id",
        edgeId: edge.id,
        message: `Multiple connections use the ID “${edge.id}”.`,
      });
      continue;
    }
    edgeIds.add(edge.id);

    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);
    if (!sourceNode || !targetNode) {
      addDiagnostic({
        severity: "error",
        code: "dangling-edge",
        edgeId: edge.id,
        nodeId: sourceNode?.id ?? targetNode?.id,
        message: "A connection references a node that no longer exists.",
      });
      continue;
    }

    const sourceDefinition = getMaterialNodeDefinition(sourceNode.data.kind);
    const targetDefinition = getMaterialNodeDefinition(targetNode.data.kind);
    const sourcePort = resolvedPort(sourceDefinition.outputs, edge.sourceHandle);
    if (!sourcePort) {
      addDiagnostic({
        severity: "error",
        code: "unknown-source-handle",
        edgeId: edge.id,
        nodeId: sourceNode.id,
        portId: edge.sourceHandle ?? undefined,
        message: `${sourceNode.data.label} has an unsupported output socket.`,
      });
      continue;
    }
    const targetPort = resolvedPort(targetDefinition.inputs, edge.targetHandle);
    if (!targetPort) {
      addDiagnostic({
        severity: "error",
        code: "unknown-target-handle",
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: edge.targetHandle ?? undefined,
        message: `${targetNode.data.label} has an unsupported input socket.`,
      });
      continue;
    }

    const sourceType = outputTypeFor(sourceNode, sourcePort);
    if (!areMaterialPortTypesCompatible(sourceType, targetPort.type)) {
      addDiagnostic({
        severity: "error",
        code: "type-mismatch",
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: targetPort.id,
        message: `${sourceNode.data.label} cannot feed ${targetNode.data.label} → ${targetPort.label}.`,
      });
      continue;
    }

    const inputKey = `${targetNode.id}:${targetPort.id}`;
    if (occupiedInputs.has(inputKey)) {
      addDiagnostic({
        severity: "error",
        code: "multiple-inputs",
        edgeId: edge.id,
        nodeId: targetNode.id,
        portId: targetPort.id,
        message: `${targetNode.data.label} → ${targetPort.label} has more than one connection.`,
      });
      continue;
    }
    occupiedInputs.set(inputKey, edge.id);
    resolvedEdges.push({
      edge,
      sourceNode,
      targetNode,
      sourcePort,
      targetPort,
      sourceType,
    });
  }

  const targetsBySource = new Map<string, string[]>();
  const sourcesByTarget = new Map<string, string[]>();
  for (const { sourceNode, targetNode } of resolvedEdges) {
    const targets = targetsBySource.get(sourceNode.id) ?? [];
    targets.push(targetNode.id);
    targetsBySource.set(sourceNode.id, targets);
    const sources = sourcesByTarget.get(targetNode.id) ?? [];
    sources.push(sourceNode.id);
    sourcesByTarget.set(targetNode.id, sources);
  }

  const visitState = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const cycleNodeIds = new Set<string>();
  const visit = (nodeId: string) => {
    visitState.set(nodeId, 1);
    path.push(nodeId);
    for (const targetId of targetsBySource.get(nodeId) ?? []) {
      const state = visitState.get(targetId) ?? 0;
      if (state === 0) visit(targetId);
      else if (state === 1) {
        const cycleStart = path.lastIndexOf(targetId);
        for (const cycleNodeId of path.slice(cycleStart)) {
          cycleNodeIds.add(cycleNodeId);
        }
      }
    }
    path.pop();
    visitState.set(nodeId, 2);
  };
  for (const nodeId of nodesById.keys()) {
    if ((visitState.get(nodeId) ?? 0) === 0) visit(nodeId);
  }
  for (const nodeId of cycleNodeIds) {
    addDiagnostic({
      severity: "error",
      code: "cycle",
      nodeId,
      message: `${nodesById.get(nodeId)?.data.label ?? nodeId} is part of a connection cycle.`,
    });
  }

  const reachableNodeIds = new Set<string>();
  const pendingReachable = outputNode ? [outputNode.id] : [];
  while (pendingReachable.length) {
    const nodeId = pendingReachable.pop();
    if (!nodeId || reachableNodeIds.has(nodeId)) continue;
    reachableNodeIds.add(nodeId);
    pendingReachable.push(...(sourcesByTarget.get(nodeId) ?? []));
  }

  for (const nodeId of reachableNodeIds) {
    const node = nodesById.get(nodeId);
    if (!node) continue;
    const definition = getMaterialNodeDefinition(node.data.kind);
    for (const input of definition.inputs) {
      if (!input.required || occupiedInputs.has(`${nodeId}:${input.id}`)) continue;
      addDiagnostic({
        severity: "warning",
        code: "missing-required-input",
        nodeId,
        portId: input.id,
        message: `${node.data.label} needs a ${input.label} connection.`,
      });
    }
  }

  const indegree = new Map<string, number>(
    [...nodesById.keys()].map((nodeId) => [nodeId, 0]),
  );
  for (const { sourceNode, targetNode } of resolvedEdges) {
    if (cycleNodeIds.has(sourceNode.id) || cycleNodeIds.has(targetNode.id)) continue;
    indegree.set(targetNode.id, (indegree.get(targetNode.id) ?? 0) + 1);
  }
  const ready = [...indegree.entries()]
    .filter(([, count]) => count === 0)
    .map(([nodeId]) => nodeId);
  const topologicalNodeIds: string[] = [];
  while (ready.length) {
    const nodeId = ready.shift();
    if (!nodeId) continue;
    topologicalNodeIds.push(nodeId);
    for (const targetId of targetsBySource.get(nodeId) ?? []) {
      if (cycleNodeIds.has(nodeId) || cycleNodeIds.has(targetId)) continue;
      const nextCount = (indegree.get(targetId) ?? 1) - 1;
      indegree.set(targetId, nextCount);
      if (nextCount === 0) ready.push(targetId);
    }
  }

  const inputSources = new Map<string, string>();
  for (const resolved of resolvedEdges) {
    inputSources.set(
      `${resolved.targetNode.id}:${resolved.targetPort.id}`,
      resolved.sourceNode.id,
    );
  }

  const diagnosticsByNode = new Map<string, MaterialGraphDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    if (!diagnostic.nodeId) continue;
    const nodeDiagnostics = diagnosticsByNode.get(diagnostic.nodeId) ?? [];
    nodeDiagnostics.push(diagnostic);
    diagnosticsByNode.set(diagnostic.nodeId, nodeDiagnostics);
  }

  return {
    nodesById,
    outputNode,
    validEdges: resolvedEdges.map(({ edge }) => edge),
    topologicalNodeIds,
    reachableNodeIds,
    diagnostics,
    diagnosticsByNode,
    isValid: !diagnostics.some(({ severity }) => severity === "error"),
    sourceFor: (nodeId, targetPortId) =>
      inputSources.get(`${nodeId}:${targetPortId}`),
  };
}
