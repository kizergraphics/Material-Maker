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
};

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
    maxEdge: number;
    promise: Promise<PreparedSourceTexture>;
  } | null>(null);
  const generatedRef = useRef<SourceGeneration | null>(null);

  useEffect(() => {
    let active = true;
    if (!project.sourceTexture) {
      preparedRef.current = null;
      generatedRef.current = null;
      return () => {
        active = false;
      };
    }

    const source = project.sourceTexture;
    if (
      !preparedRef.current ||
      preparedRef.current.source !== source ||
      preparedRef.current.maxEdge !== maxEdge
    ) {
      preparedRef.current = {
        source,
        maxEdge,
        promise: prepareSourceTexture(source, maxEdge),
      };
    }

    const previous = generatedRef.current;
    const generateAll =
      !previous ||
      previous.source !== source ||
      previous.maxEdge !== maxEdge;
    const changedChannels = generateAll
      ? textureMapChannels
      : textureMapChannels.filter((channel) =>
          channelPixelsChanged(previous.settings, project.mapSettings, channel),
        );

    // Enabling or disabling a map only affects preview composition; its pixel
    // buffer remains valid and does not need to be regenerated.
    if (!generateAll && changedChannels.length === 0) {
      generatedRef.current = { source, maxEdge, settings: project.mapSettings };
      return () => {
        active = false;
      };
    }

    setGenerating(true);
    const frame = window.requestAnimationFrame(() => {
      void preparedRef.current!.promise
        .then((prepared) => {
          if (!active) return;
          if (generateAll) {
            setEvaluation(generatePreparedMaps(prepared, project.mapSettings));
          } else {
            const updates = Object.assign(
              {},
              ...changedChannels.map((channel) =>
                generateDerivedMap(prepared, project.mapSettings, channel),
              ),
            );
            setEvaluation((current) => ({ ...current, ...updates }));
          }
          generatedRef.current = {
            source,
            maxEdge,
            settings: project.mapSettings,
          };
          setError(null);
        })
        .catch((reason) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : "Map generation failed.");
        })
        .finally(() => {
          if (active) setGenerating(false);
        });
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
    };
  }, [graphEvaluation, maxEdge, project.mapSettings, project.sourceTexture]);

  return project.sourceTexture
    ? { evaluation, isGenerating, error }
    : { evaluation: graphEvaluation, isGenerating: false, error: null };
}
