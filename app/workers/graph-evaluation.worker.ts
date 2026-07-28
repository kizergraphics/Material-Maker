import {
  evaluateMaterial,
  evaluateNodeMap,
  type MaterialEvaluation,
} from "../core/material-evaluator";
import type {
  GraphEvaluationWorkerRequest,
  GraphEvaluationWorkerResponse,
} from "../core/graph-evaluation-worker-types";

type WorkerScope = {
  onmessage: ((event: MessageEvent<GraphEvaluationWorkerRequest>) => void) | null;
  postMessage: (
    message: GraphEvaluationWorkerResponse,
    transfer?: Transferable[],
  ) => void;
};

const scope = globalThis as unknown as WorkerScope;

function transferablesFor(values: MaterialEvaluation | Record<string, Uint8ClampedArray>) {
  const transferables = new Set<Transferable>();
  for (const value of Object.values(values)) {
    if (value instanceof Uint8ClampedArray) {
      transferables.add(value.buffer);
    }
  }
  return [...transferables];
}

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === "evaluate-material") {
      const evaluation = evaluateMaterial(message.project, message.size);
      scope.postMessage(
        {
          type: "material-evaluated",
          requestId: message.requestId,
          evaluation,
        },
        transferablesFor(evaluation),
      );
      return;
    }

    const maps = Object.fromEntries(
      message.nodeIds.map((nodeId) => [
        nodeId,
        evaluateNodeMap(message.project, nodeId, message.size),
      ]),
    );
    scope.postMessage(
      {
        type: "node-maps-evaluated",
        requestId: message.requestId,
        maps,
      },
      transferablesFor(maps),
    );
  } catch (reason) {
    scope.postMessage({
      type: "error",
      requestId: message.requestId,
      message:
        reason instanceof Error ? reason.message : "Graph evaluation failed.",
    });
  }
};
