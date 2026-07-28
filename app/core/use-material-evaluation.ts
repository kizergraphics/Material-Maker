"use client";

import { useEffect, useRef, useState } from "react";
import {
  evaluateMaterial,
  type MaterialEvaluation,
} from "./material-evaluator";
import {
  projectForGraphWorker,
  type GraphEvaluationWorkerRequest,
  type GraphEvaluationWorkerResponse,
} from "./graph-evaluation-worker-types";
import type {
  GeneratedMapsPayload,
  MaterialGenerationWorkerRequest,
  MaterialGenerationWorkerResponse,
} from "./material-generation-worker-types";
import type { MaterialProject } from "./material-types";
import {
  generateDerivedMap,
  generatePreparedMaps,
  prepareSourceTexture,
  textureMapChannels,
  type PreparedSourceTexture,
} from "./texture-generator";

type SourceGeneration = {
  source: NonNullable<MaterialProject["sourceTexture"]>;
  maxEdge: number;
  settings: MaterialProject["mapSettings"];
  evaluation: MaterialEvaluation;
};

type PendingWorkerRequest = {
  generationId: number;
  resolve: (payload: GeneratedMapsPayload) => void;
  reject: (reason: unknown) => void;
};

type GenerationWorkerState = {
  source: NonNullable<MaterialProject["sourceTexture"]>;
  worker: Worker;
  nextRequestId: number;
  pending: Map<number, PendingWorkerRequest>;
};

const INTERACTIVE_PREVIEW_EDGE = 128;
const INTERACTIVE_PREVIEW_DELAY_MS = 40;
const FULL_PREVIEW_DELAY_MS = 240;
const GRAPH_EVALUATION_DELAY_MS = 50;

const emptyGraphEvaluation: MaterialEvaluation = {
  width: 1,
  height: 1,
  albedo: new Uint8ClampedArray([128, 128, 128, 255]),
  heightMap: new Uint8ClampedArray([128, 128, 128, 255]),
  normal: new Uint8ClampedArray([128, 128, 255, 255]),
  roughness: new Uint8ClampedArray([153, 153, 153, 255]),
  metallic: new Uint8ClampedArray([0, 0, 0, 255]),
  ambientOcclusion: new Uint8ClampedArray([255, 255, 255, 255]),
  roughnessValue: 0.6,
  metallicValue: 0,
  warnings: ["Evaluating procedural graph."],
};

function useGraphMaterialEvaluation(
  project: Pick<MaterialProject, "nodes" | "edges">,
  size: number,
  enabled: boolean,
) {
  const [evaluation, setEvaluation] =
    useState<MaterialEvaluation>(emptyGraphEvaluation);
  const [isGenerating, setGenerating] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const generationIdRef = useRef(0);
  const workerDisabledRef = useRef(false);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    let active = true;
    let frame = 0;
    let timer = 0;
    const isCurrent = () =>
      active && generationIdRef.current === generationId;

    const terminateWorker = () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };

    if (!enabled) {
      terminateWorker();
      return () => {
        active = false;
      };
    }

    const evaluateOnMainThread = () =>
      evaluateMaterial(
        { nodes: project.nodes, edges: project.edges },
        size,
      );

    const evaluateInWorker = () => {
      terminateWorker();
      const worker = new Worker(
        new URL("../workers/graph-evaluation.worker.ts", import.meta.url),
        { type: "module", name: "forge-graph-evaluation" },
      );
      workerRef.current = worker;
      return new Promise<MaterialEvaluation>((resolve, reject) => {
        worker.onmessage = (
          event: MessageEvent<GraphEvaluationWorkerResponse>,
        ) => {
          const response = event.data;
          if (response.requestId !== generationId) return;
          if (response.type === "error") {
            reject(new Error(response.message));
            return;
          }
          if (response.type !== "material-evaluated") return;
          resolve(response.evaluation);
        };
        worker.onerror = () => {
          reject(new Error("The graph evaluation worker failed."));
        };
        const request: GraphEvaluationWorkerRequest = {
          type: "evaluate-material",
          requestId: generationId,
          project: projectForGraphWorker(project.nodes, project.edges),
          size,
        };
        worker.postMessage(request);
      }).finally(() => {
        if (workerRef.current === worker) {
          worker.terminate();
          workerRef.current = null;
        }
      });
    };

    frame = window.requestAnimationFrame(() => {
      if (!isCurrent()) return;
      setGenerating(true);
      timer = window.setTimeout(() => {
        const canUseWorker =
          !workerDisabledRef.current && typeof Worker !== "undefined";
        const request = canUseWorker
          ? evaluateInWorker().catch((reason) => {
              if (!isCurrent()) throw reason;
              workerDisabledRef.current = true;
              return evaluateOnMainThread();
            })
          : Promise.resolve(evaluateOnMainThread());

        void request
          .then((nextEvaluation) => {
            if (!isCurrent()) return;
            setEvaluation(nextEvaluation);
            setError(null);
          })
          .catch((reason) => {
            if (!isCurrent()) return;
            setError(
              reason instanceof Error
                ? reason.message
                : "Graph evaluation failed.",
            );
          })
          .finally(() => {
            if (isCurrent()) setGenerating(false);
          });
      }, GRAPH_EVALUATION_DELAY_MS);
    });

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      terminateWorker();
    };
  }, [enabled, project.edges, project.nodes, size]);

  return { evaluation, isGenerating: enabled && isGenerating, error };
}

function channelPixelsChanged(
  previous: MaterialProject["mapSettings"],
  next: MaterialProject["mapSettings"],
  channel: (typeof textureMapChannels)[number],
) {
  const previousValues = previous[channel] as Record<string, number | boolean>;
  const nextValues = next[channel] as Record<string, number | boolean>;
  return Object.keys(nextValues).some(
    (key) => key !== "enabled" && previousValues[key] !== nextValues[key],
  );
}

export function useMaterialEvaluation(
  project: Pick<
    MaterialProject,
    "nodes" | "edges" | "sourceTexture" | "mapSettings"
  >,
  maxEdge: number,
) {
  const graphResult = useGraphMaterialEvaluation(
    { nodes: project.nodes, edges: project.edges },
    maxEdge,
    !project.sourceTexture,
  );
  const [evaluation, setEvaluation] =
    useState<MaterialEvaluation>(emptyGraphEvaluation);
  const [isGenerating, setGenerating] = useState(
    Boolean(project.sourceTexture),
  );
  const [error, setError] = useState<string | null>(null);
  const preparedRef = useRef<{
    source: NonNullable<MaterialProject["sourceTexture"]>;
    promises: Map<number, Promise<PreparedSourceTexture>>;
  } | null>(null);
  const completedRef = useRef<SourceGeneration | null>(null);
  const interactiveRef = useRef<SourceGeneration | null>(null);
  const generationIdRef = useRef(0);
  const workerRef = useRef<GenerationWorkerState | null>(null);
  const workerDisabledRef = useRef(false);

  useEffect(
    () => () => {
      const state = workerRef.current;
      if (!state) return;
      state.worker.terminate();
      for (const pending of state.pending.values()) {
        pending.reject(new Error("Map generation was cancelled."));
      }
      state.pending.clear();
      workerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    let active = true;
    let frame = 0;
    let interactiveTimer = 0;
    let fullResolutionTimer = 0;
    const isCurrent = () =>
      active && generationIdRef.current === generationId;

    const terminateWorker = (reason: Error) => {
      const state = workerRef.current;
      if (!state) return;
      state.worker.terminate();
      workerRef.current = null;
      for (const pending of state.pending.values()) {
        pending.reject(reason);
      }
      state.pending.clear();
    };

    const cancelWorkerGeneration = () => {
      const state = workerRef.current;
      if (
        state &&
        [...state.pending.values()].some(
          (pending) => pending.generationId === generationId,
        )
      ) {
        terminateWorker(new Error("Map generation was cancelled."));
      }
    };

    if (!project.sourceTexture) {
      preparedRef.current = null;
      completedRef.current = null;
      interactiveRef.current = null;
      workerDisabledRef.current = false;
      terminateWorker(new Error("The source texture was removed."));
      return () => {
        active = false;
      };
    }

    const source = project.sourceTexture;
    if (!preparedRef.current || preparedRef.current.source !== source) {
      preparedRef.current = {
        source,
        promises: new Map(),
      };
      workerDisabledRef.current = false;
    }

    const getPrepared = (edge: number) => {
      const cache = preparedRef.current!;
      const cached = cache.promises.get(edge);
      if (cached) return cached;
      const promise = prepareSourceTexture(source, edge);
      cache.promises.set(edge, promise);
      return promise;
    };

    const ensureWorker = () => {
      const current = workerRef.current;
      if (current?.source === source) return current;
      if (current) {
        terminateWorker(new Error("The source texture changed."));
      }

      const worker = new Worker(
        new URL("../workers/material-generation.worker.ts", import.meta.url),
        { type: "module", name: "forge-map-generation" },
      );
      const state: GenerationWorkerState = {
        source,
        worker,
        nextRequestId: 0,
        pending: new Map(),
      };
      workerRef.current = state;
      worker.onmessage = (
        event: MessageEvent<MaterialGenerationWorkerResponse>,
      ) => {
        const response = event.data;
        const pending = state.pending.get(response.requestId);
        if (!pending) return;
        state.pending.delete(response.requestId);
        if (response.type === "error") {
          pending.reject(new Error(response.message));
          return;
        }
        pending.resolve({
          result: response.result,
          width: response.width,
          height: response.height,
          full: response.full,
        });
      };
      worker.onerror = () => {
        if (workerRef.current === state) {
          terminateWorker(new Error("The map generation worker failed."));
        }
      };
      const initialize: MaterialGenerationWorkerRequest = {
        type: "initialize",
        source,
      };
      worker.postMessage(initialize);
      return state;
    };

    const generateInWorker = (
      edge: number,
      channels: (typeof textureMapChannels)[number][],
    ) => {
      const state = ensureWorker();
      const requestId = state.nextRequestId + 1;
      state.nextRequestId = requestId;
      return new Promise<GeneratedMapsPayload>((resolve, reject) => {
        state.pending.set(requestId, {
          generationId,
          resolve,
          reject,
        });
        const request: MaterialGenerationWorkerRequest = {
          type: "generate",
          requestId,
          maxEdge: edge,
          settings: project.mapSettings,
          channels,
        };
        try {
          state.worker.postMessage(request);
        } catch (reason) {
          state.pending.delete(requestId);
          reject(reason);
        }
      });
    };

    const generateOnMainThread = async (
      edge: number,
      channels: (typeof textureMapChannels)[number][],
    ): Promise<GeneratedMapsPayload> => {
      const prepared = await getPrepared(edge);
      const full = channels.length === textureMapChannels.length;
      return {
        result: full
          ? generatePreparedMaps(prepared, project.mapSettings)
          : Object.assign(
              {},
              ...channels.map((channel) =>
                generateDerivedMap(prepared, project.mapSettings, channel),
              ),
            ),
        width: prepared.width,
        height: prepared.height,
        full,
      };
    };

    const generateAtResolution = async (
      edge: number,
      channels: (typeof textureMapChannels)[number][],
    ) => {
      const canUseWorker =
        !workerDisabledRef.current &&
        typeof Worker !== "undefined" &&
        typeof OffscreenCanvas !== "undefined" &&
        typeof createImageBitmap !== "undefined";
      if (canUseWorker) {
        try {
          return await generateInWorker(edge, channels);
        } catch (reason) {
          if (!isCurrent()) throw reason;
          workerDisabledRef.current = true;
          terminateWorker(new Error("Falling back to browser map generation."));
        }
      }
      return generateOnMainThread(edge, channels);
    };

    const completed = completedRef.current;
    const hasCompletedFullResolution =
      completed?.source === source && completed.maxEdge === maxEdge;
    const changedChannels = hasCompletedFullResolution
      ? textureMapChannels.filter((channel) =>
          channelPixelsChanged(
            completed.settings,
            project.mapSettings,
            channel,
          ),
        )
      : textureMapChannels;

    // Enabling or disabling a map only affects preview composition; its pixel
    // buffer remains valid and does not need to be regenerated.
    if (hasCompletedFullResolution && changedChannels.length === 0) {
      completedRef.current = {
        ...completed,
        settings: project.mapSettings,
      };
      frame = window.requestAnimationFrame(() => {
        if (!isCurrent()) return;
        setEvaluation(completed.evaluation);
        setGenerating(false);
      });
      return () => {
        active = false;
        window.cancelAnimationFrame(frame);
      };
    }

    const generateFullResolution = async () => {
      try {
        const latestCompleted = completedRef.current;
        const generateAll =
          latestCompleted?.source !== source ||
          latestCompleted.maxEdge !== maxEdge;
        const fullResolutionChanges = generateAll
          ? textureMapChannels
          : textureMapChannels.filter((channel) =>
              channelPixelsChanged(
                latestCompleted.settings,
                project.mapSettings,
                channel,
              ),
            );
        const payload = await generateAtResolution(
          maxEdge,
          fullResolutionChanges,
        );
        if (!isCurrent()) return;

        let nextEvaluation: MaterialEvaluation;
        if (payload.full) {
          nextEvaluation = payload.result as MaterialEvaluation;
        } else if (latestCompleted) {
          nextEvaluation = {
            ...latestCompleted.evaluation,
            ...payload.result,
          };
        } else {
          throw new Error("The full-resolution map cache is unavailable.");
        }
        completedRef.current = {
          source,
          maxEdge,
          settings: project.mapSettings,
          evaluation: nextEvaluation,
        };
        setEvaluation(nextEvaluation);
        setError(null);
      } catch (reason) {
        if (!isCurrent()) return;
        setError(
          reason instanceof Error ? reason.message : "Map generation failed.",
        );
      } finally {
        if (isCurrent()) setGenerating(false);
      }
    };

    frame = window.requestAnimationFrame(() => {
      setGenerating(true);
      interactiveTimer = window.setTimeout(() => {
        const interactiveEdge = Math.min(INTERACTIVE_PREVIEW_EDGE, maxEdge);
        const latestInteractive = interactiveRef.current;
        const canReuseInteractive =
          latestInteractive?.source === source &&
          latestInteractive.maxEdge === interactiveEdge;
        const interactiveChanges = canReuseInteractive
          ? textureMapChannels.filter((channel) =>
              channelPixelsChanged(
                latestInteractive.settings,
                project.mapSettings,
                channel,
              ),
            )
          : textureMapChannels;

        void generateAtResolution(interactiveEdge, interactiveChanges)
          .then((payload) => {
            if (!isCurrent()) return;
            let interactiveEvaluation: MaterialEvaluation;
            if (payload.full) {
              interactiveEvaluation = payload.result as MaterialEvaluation;
            } else if (canReuseInteractive && latestInteractive) {
              interactiveEvaluation = {
                ...latestInteractive.evaluation,
                ...payload.result,
              };
            } else {
              throw new Error("The interactive map cache is unavailable.");
            }
            interactiveRef.current = {
              source,
              maxEdge: interactiveEdge,
              settings: project.mapSettings,
              evaluation: interactiveEvaluation,
            };
            setEvaluation(interactiveEvaluation);
            setError(null);

            if (interactiveEdge === maxEdge) {
              completedRef.current = {
                source,
                maxEdge,
                settings: project.mapSettings,
                evaluation: interactiveEvaluation,
              };
              setGenerating(false);
              return;
            }

            fullResolutionTimer = window.setTimeout(() => {
              void generateFullResolution();
            }, FULL_PREVIEW_DELAY_MS);
          })
          .catch((reason) => {
            if (!isCurrent()) return;
            setError(
              reason instanceof Error ? reason.message : "Map generation failed.",
            );
            setGenerating(false);
          });
      }, INTERACTIVE_PREVIEW_DELAY_MS);
    });

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(interactiveTimer);
      window.clearTimeout(fullResolutionTimer);
      cancelWorkerGeneration();
    };
  }, [maxEdge, project.mapSettings, project.sourceTexture]);

  return project.sourceTexture
    ? { evaluation, isGenerating, error }
    : graphResult;
}
