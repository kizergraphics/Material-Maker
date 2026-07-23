"use client";

import { useEffect, useMemo, useState } from "react";
import { evaluateMaterial, type MaterialEvaluation } from "./material-evaluator";
import type { MaterialProject } from "./material-types";
import { evaluateSourceTexture } from "./texture-generator";

export function useMaterialEvaluation(
  project: Pick<
    MaterialProject,
    "nodes" | "edges" | "sourceTexture" | "mapSettings"
  >,
  maxEdge: number,
) {
  const graphEvaluation = useMemo(
    () => evaluateMaterial(project, maxEdge),
    [maxEdge, project.edges, project.nodes],
  );
  const [evaluation, setEvaluation] = useState<MaterialEvaluation>(graphEvaluation);
  const [isGenerating, setGenerating] = useState(Boolean(project.sourceTexture));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!project.sourceTexture) {
      setEvaluation(graphEvaluation);
      setGenerating(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    setGenerating(true);
    const timeout = window.setTimeout(() => {
      evaluateSourceTexture(project.sourceTexture!, project.mapSettings, maxEdge)
        .then((next) => {
          if (!active) return;
          setEvaluation(next);
          setError(null);
        })
        .catch((reason) => {
          if (!active) return;
          setError(reason instanceof Error ? reason.message : "Map generation failed.");
        })
        .finally(() => {
          if (active) setGenerating(false);
        });
    }, 80);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [graphEvaluation, maxEdge, project.mapSettings, project.sourceTexture]);

  return { evaluation, isGenerating, error };
}
