import type { MaterialEvaluation } from "./material-evaluator";
import type {
  MaterialGraphEdge,
  MaterialGraphNode,
} from "./material-types";

export type GraphEvaluationProject = {
  nodes: MaterialGraphNode[];
  edges: MaterialGraphEdge[];
};

export type GraphEvaluationWorkerRequest =
  | {
      type: "evaluate-material";
      requestId: number;
      project: GraphEvaluationProject;
      size: number;
    }
  | {
      type: "evaluate-node-maps";
      requestId: number;
      project: GraphEvaluationProject;
      nodeIds: string[];
      size: number;
    };

export type GraphEvaluationWorkerResponse =
  | {
      type: "material-evaluated";
      requestId: number;
      evaluation: MaterialEvaluation;
    }
  | {
      type: "node-maps-evaluated";
      requestId: number;
      maps: Record<string, Uint8ClampedArray>;
    }
  | {
      type: "error";
      requestId: number;
      message: string;
    };

export function projectForGraphWorker(
  nodes: MaterialGraphNode[],
  edges: MaterialGraphEdge[],
): GraphEvaluationProject {
  return {
    nodes: nodes.map((node) => {
      const values = Object.fromEntries(
        Object.entries(node.data.values).filter(
          ([key]) => key !== "thumbnail",
        ),
      );
      return {
        id: node.id,
        type: "materialNode" as const,
        position: { x: 0, y: 0 },
        data: {
          label: node.data.label,
          kind: node.data.kind,
          category: node.data.category,
          version: node.data.version,
          values,
        },
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
}
