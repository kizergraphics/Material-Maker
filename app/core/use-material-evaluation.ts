"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateMaterial, type MaterialEvaluation } from "./material-evaluator";
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

const INTERACTIVE_PREVIEW_EDGE = 128;
const FULL_PREVIEW_DELAY_MS = 160;

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
  const graphEvaluation = useMemo(
    () => evaluateMaterial(
      { nodes: project.nodes, edges: project.edges },
      maxEdge,
    ),
    [maxEdge, project.edges, project.nodes],
  );
  const [evaluation, setEvaluation] = useState<MaterialEvaluation>(graphEvaluation);
  const [isGenerating, setGenerating] = useState(Boolean(project.sourceTexture));
  const [error, setError] = useState<string | null>(null);
  const preparedRef = useRef<{
    source: NonNullable<MaterialProject["sourceTexture"]>;
    promises: Map<number, Promise<PreparedSourceTexture>>;
  } | null>(null);
  const completedRef = useRef<SourceGeneration | null>(null);
  const generationIdRef = useRef(0);

  useEffect(() => {
    const generationId = generationIdRef.current + 1;
    generationIdRef.current = generationId;
    let active = true;
    let frame = 0;
    let fullResolutionTimer = 0;
    const isCurrent = () =>
      active && generationIdRef.current === generationId;

    if (!project.sourceTexture) {
      preparedRef.current = null;
      completedRef.current = null;
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
    }

    const getPrepared = (edge: number) => {
      const cache = preparedRef.current!;
      const cached = cache.promises.get(edge);
      if (cached) return cached;
      const promise = prepareSourceTexture(source, edge);
      cache.promises.set(edge, promise);
      return promise;
    };

    const completed = completedRef.current;
    const hasCompletedFullResolution =
      completed?.source === source &&
      completed.maxEdge === maxEdge;
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
        const prepared = await getPrepared(maxEdge);
        if (!isCurrent()) return;

        const latestCompleted = completedRef.current;
        const generateAll =
          latestCompleted?.source !== source ||
          latestCompleted.maxEdge !== maxEdge;
        let nextEvaluation: MaterialEvaluation;

        if (generateAll) {
          nextEvaluation = generatePreparedMaps(prepared, project.mapSettings);
        } else {
          const fullResolutionChanges = textureMapChannels.filter((channel) =>
            channelPixelsChanged(
              latestCompleted.settings,
              project.mapSettings,
              channel,
            ),
          );
          const updates = Object.assign(
            {},
            ...fullResolutionChanges.map((channel) =>
              generateDerivedMap(prepared, project.mapSettings, channel),
            ),
          );
          nextEvaluation = {
            ...latestCompleted.evaluation,
            ...updates,
          };
        }

        if (!isCurrent()) return;
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
      const interactiveEdge = Math.min(INTERACTIVE_PREVIEW_EDGE, maxEdge);
      void getPrepared(interactiveEdge)
        .then((prepared) => {
          if (!isCurrent()) return;
          const interactiveEvaluation = generatePreparedMaps(
            prepared,
            project.mapSettings,
          );
          if (!isCurrent()) return;
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
    });

    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(fullResolutionTimer);
    };
  }, [graphEvaluation, maxEdge, project.mapSettings, project.sourceTexture]);

  return project.sourceTexture
    ? { evaluation, isGenerating, error }
    : { evaluation: graphEvaluation, isGenerating: false, error: null };
}
