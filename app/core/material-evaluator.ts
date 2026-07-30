import {
  compileMaterialGraph,
  type CompiledMaterialGraph,
  type MaterialGraphSource,
} from "./material-graph-compiler";
import type { MaterialProject } from "./material-types";
import {
  getMaterialNodeDefinition,
  type MaterialNodeOutputMap,
  type MaterialNodeSample,
  type TextureMapChannel,
} from "./material-node-registry";

type ColorValue = MaterialNodeSample;

export interface MaterialEvaluation {
  width: number;
  height: number;
  albedo: Uint8ClampedArray;
  heightMap: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  roughness: Uint8ClampedArray;
  metallic: Uint8ClampedArray;
  ambientOcclusion: Uint8ClampedArray;
  roughnessValue: number;
  metallicValue: number;
  warnings: string[];
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const DEFAULT_SAMPLE: MaterialNodeSample = [0.5, 0.5, 0.5, 1];
const TEXTURE_FALLBACKS: Record<TextureMapChannel, MaterialNodeSample> = {
  baseColor: DEFAULT_SAMPLE,
  height: DEFAULT_SAMPLE,
  normal: [0.5, 0.5, 1, 1],
  roughness: [0.6, 0.6, 0.6, 1],
  metallic: [0, 0, 0, 1],
  ao: [1, 1, 1, 1],
};

type EvaluatedGraphSample = ReadonlyMap<string, MaterialNodeOutputMap>;

type MaterialEvaluationPlan = {
  compiledGraph: CompiledMaterialGraph;
  nodeIds: readonly string[];
};

function isGraphSource(
  source: MaterialGraphSource | undefined,
): source is MaterialGraphSource {
  return source !== undefined;
}

function createEvaluationPlan(
  compiledGraph: CompiledMaterialGraph,
  requestedSources: readonly MaterialGraphSource[],
): MaterialEvaluationPlan {
  const requiredNodeIds = new Set<string>();
  const pending = requestedSources.map(({ nodeId }) => nodeId);

  while (pending.length) {
    const nodeId = pending.pop();
    if (!nodeId || requiredNodeIds.has(nodeId)) continue;
    requiredNodeIds.add(nodeId);
    const node = compiledGraph.nodesById.get(nodeId);
    if (!node) continue;
    const definition = getMaterialNodeDefinition(node.data.kind);
    for (const input of definition.inputs) {
      const source = compiledGraph.inputSourceFor(nodeId, input.id);
      if (source) pending.push(source.nodeId);
    }
  }

  return {
    compiledGraph,
    nodeIds: compiledGraph.topologicalNodeIds.filter((nodeId) =>
      requiredNodeIds.has(nodeId),
    ),
  };
}

function sampleEvaluatedSource(
  evaluated: EvaluatedGraphSample,
  source: MaterialGraphSource | undefined,
  fallback: MaterialNodeSample = DEFAULT_SAMPLE,
): MaterialNodeSample {
  if (!source) return fallback;
  return evaluated.get(source.nodeId)?.[source.portId] ?? fallback;
}

function normalizeNodeOutputs(
  outputPortId: string | undefined,
  result: MaterialNodeSample | MaterialNodeOutputMap | undefined,
): MaterialNodeOutputMap {
  if (!result) return {};
  if (Array.isArray(result)) {
    return outputPortId
      ? { [outputPortId]: result as MaterialNodeSample }
      : {};
  }
  return result as MaterialNodeOutputMap;
}

function evaluatePlanAt(
  plan: MaterialEvaluationPlan,
  u: number,
  v: number,
  textureInputs?: MaterialEvaluation,
): EvaluatedGraphSample {
  const evaluated = new Map<string, MaterialNodeOutputMap>();

  for (const nodeId of plan.nodeIds) {
    const node = plan.compiledGraph.nodesById.get(nodeId);
    if (!node) continue;
    const definition = getMaterialNodeDefinition(node.data.kind);
    if (!definition.evaluate || !definition.outputs.length) continue;
    const result = definition.evaluate({
      u,
      v,
      values: node.data.values,
      sampleInput: (portId) =>
        sampleEvaluatedSource(
          evaluated,
          plan.compiledGraph.inputSourceFor(nodeId, portId),
        ),
      sampleTextureMap: (channel) =>
        sampleTextureMap(textureInputs, channel, u, v),
    });
    evaluated.set(
      nodeId,
      normalizeNodeOutputs(definition.outputs[0]?.id, result),
    );
  }

  return evaluated;
}

function pixelsForTextureChannel(
  evaluation: MaterialEvaluation,
  channel: TextureMapChannel,
) {
  if (channel === "baseColor") return evaluation.albedo;
  if (channel === "height") return evaluation.heightMap;
  if (channel === "normal") return evaluation.normal;
  if (channel === "roughness") return evaluation.roughness;
  if (channel === "metallic") return evaluation.metallic;
  return evaluation.ambientOcclusion;
}

function sampleTextureMap(
  evaluation: MaterialEvaluation | undefined,
  channel: TextureMapChannel,
  u: number,
  v: number,
): MaterialNodeSample {
  if (!evaluation?.width || !evaluation.height) {
    return TEXTURE_FALLBACKS[channel];
  }
  const pixels = pixelsForTextureChannel(evaluation, channel);
  const wrappedU = ((u % 1) + 1) % 1;
  const wrappedV = ((v % 1) + 1) % 1;
  const x = Math.min(
    evaluation.width - 1,
    Math.floor(wrappedU * evaluation.width),
  );
  const y = Math.min(
    evaluation.height - 1,
    Math.floor(wrappedV * evaluation.height),
  );
  const offset = (y * evaluation.width + x) * 4;
  if (offset + 3 >= pixels.length) return TEXTURE_FALLBACKS[channel];
  return [
    pixels[offset] / 255,
    pixels[offset + 1] / 255,
    pixels[offset + 2] / 255,
    pixels[offset + 3] / 255,
  ];
}

function writePixel(
  target: Uint8ClampedArray,
  offset: number,
  color: ColorValue,
) {
  target[offset] = Math.round(clamp(color[0]) * 255);
  target[offset + 1] = Math.round(clamp(color[1]) * 255);
  target[offset + 2] = Math.round(clamp(color[2]) * 255);
  target[offset + 3] = Math.round(clamp(color[3]) * 255);
}

export function evaluateMaterial(
  project: Pick<MaterialProject, "nodes" | "edges">,
  size = 256,
  textureInputs?: MaterialEvaluation,
): MaterialEvaluation {
  const compiledGraph = compileMaterialGraph(project);
  const nodes = new Map(compiledGraph.nodesById);
  const output = compiledGraph.outputNode;
  const warnings = compiledGraph.diagnostics.map(
    (diagnostic) => diagnostic.message,
  );
  if (
    !textureInputs &&
    [...compiledGraph.reachableNodeIds].some(
      (nodeId) =>
        compiledGraph.nodesById.get(nodeId)?.data.kind === "textureMap",
    )
  ) {
    warnings.push("Generated texture inputs are unavailable.");
  }

  const baseColorSource = output
    ? compiledGraph.inputSourceFor(output.id, "baseColor")
    : undefined;
  const normalSource = output
    ? compiledGraph.inputSourceFor(output.id, "normal")
    : undefined;
  const roughnessSource = output
    ? compiledGraph.inputSourceFor(output.id, "roughness")
    : undefined;
  const metallicSource = output
    ? compiledGraph.inputSourceFor(output.id, "metallic")
    : undefined;
  const explicitHeightSource = output
    ? compiledGraph.inputSourceFor(output.id, "height")
    : undefined;
  const ambientOcclusionSource = output
    ? compiledGraph.inputSourceFor(output.id, "ao")
    : undefined;

  if (!roughnessSource) warnings.push("Roughness is not connected.");
  if (!metallicSource) warnings.push("Metallic is not connected.");

  const width = textureInputs?.width ?? size;
  const height = textureInputs?.height ?? size;
  const albedo = new Uint8ClampedArray(width * height * 4);
  const heightMap = new Uint8ClampedArray(width * height * 4);
  const normal = new Uint8ClampedArray(width * height * 4);
  const roughness = new Uint8ClampedArray(width * height * 4);
  const metallic = new Uint8ClampedArray(width * height * 4);
  const ambientOcclusion = new Uint8ClampedArray(width * height * 4);
  const stepU = 1 / width;
  const stepV = 1 / height;
  const normalNode = normalSource ? nodes.get(normalSource.nodeId) : undefined;
  const normalHeightSource =
    normalNode?.data.kind === "normal"
      ? compiledGraph.inputSourceFor(normalNode.id, "height")
      : undefined;
  const heightSource = explicitHeightSource ?? normalHeightSource;
  const normalStrength = normalNode?.data.values.strength ?? 1;
  const materialPlan = createEvaluationPlan(
    compiledGraph,
    [
      baseColorSource,
      normalSource,
      roughnessSource,
      metallicSource,
      heightSource,
      ambientOcclusionSource,
    ].filter(isGraphSource),
  );
  const neighbourPlan = createEvaluationPlan(
    compiledGraph,
    [
      normalHeightSource,
      ambientOcclusionSource ? undefined : heightSource,
    ].filter(isGraphSource),
  );
  const pixelCount = width * height;
  let roughnessTotal = 0;
  let metallicTotal = 0;
  const sampleScalar = (
    evaluated: EvaluatedGraphSample,
    source: MaterialGraphSource | undefined,
    fallback: number,
  ) =>
    source
      ? clamp(sampleEvaluatedSource(evaluated, source)[0])
      : fallback;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const offset = (y * width + x) * 4;
      const evaluated = evaluatePlanAt(materialPlan, u, v, textureInputs);
      const base = sampleEvaluatedSource(evaluated, baseColorSource);
      writePixel(albedo, offset, base);

      const heightValue = sampleScalar(evaluated, heightSource, 0.5);
      writePixel(heightMap, offset, [heightValue, heightValue, heightValue, 1]);

      const needsNeighbours =
        Boolean(normalHeightSource) ||
        Boolean(!ambientOcclusionSource && heightSource);
      const left = needsNeighbours
        ? evaluatePlanAt(
            neighbourPlan,
            (u - stepU + 1) % 1,
            v,
            textureInputs,
          )
        : undefined;
      const right = needsNeighbours
        ? evaluatePlanAt(neighbourPlan, (u + stepU) % 1, v, textureInputs)
        : undefined;
      const down = needsNeighbours
        ? evaluatePlanAt(
            neighbourPlan,
            u,
            (v - stepV + 1) % 1,
            textureInputs,
          )
        : undefined;
      const up = needsNeighbours
        ? evaluatePlanAt(neighbourPlan, u, (v + stepV) % 1, textureInputs)
        : undefined;
      let normalHeightL = 0.5;
      let normalHeightR = 0.5;
      let normalHeightD = 0.5;
      let normalHeightU = 0.5;
      if (normalHeightSource && left && right && down && up) {
        normalHeightL = sampleScalar(left, normalHeightSource, 0.5);
        normalHeightR = sampleScalar(right, normalHeightSource, 0.5);
        normalHeightD = sampleScalar(down, normalHeightSource, 0.5);
        normalHeightU = sampleScalar(up, normalHeightSource, 0.5);
      }

      if (normalHeightSource) {
        let nx = (normalHeightL - normalHeightR) * normalStrength * 2;
        let ny = (normalHeightD - normalHeightU) * normalStrength * 2;
        let nz = 1;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        writePixel(normal, offset, [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz, 1]);
      } else if (normalSource) {
        writePixel(
          normal,
          offset,
          sampleEvaluatedSource(evaluated, normalSource),
        );
      } else {
        writePixel(normal, offset, [0.5, 0.5, 1, 1]);
      }

      const roughnessSample = sampleScalar(evaluated, roughnessSource, 0.6);
      const metallicSample = sampleScalar(evaluated, metallicSource, 0);
      roughnessTotal += roughnessSample;
      metallicTotal += metallicSample;
      writePixel(
        roughness,
        offset,
        [roughnessSample, roughnessSample, roughnessSample, 1],
      );
      writePixel(
        metallic,
        offset,
        [metallicSample, metallicSample, metallicSample, 1],
      );

      let aoHeightL = 0.5;
      let aoHeightR = 0.5;
      let aoHeightD = 0.5;
      let aoHeightU = 0.5;
      if (
        !ambientOcclusionSource &&
        heightSource &&
        left &&
        right &&
        down &&
        up
      ) {
        if (heightSource === normalHeightSource) {
          aoHeightL = normalHeightL;
          aoHeightR = normalHeightR;
          aoHeightD = normalHeightD;
          aoHeightU = normalHeightU;
        } else {
          aoHeightL = sampleScalar(left, heightSource, 0.5);
          aoHeightR = sampleScalar(right, heightSource, 0.5);
          aoHeightD = sampleScalar(down, heightSource, 0.5);
          aoHeightU = sampleScalar(up, heightSource, 0.5);
        }
      }
      const occlusion = ambientOcclusionSource
        ? sampleScalar(evaluated, ambientOcclusionSource, 1)
        : heightSource
          ? clamp(
              1 -
                Math.max(
                  0,
                  (aoHeightL + aoHeightR + aoHeightD + aoHeightU) * 0.25 -
                    heightValue,
                ) *
                  2.5,
            )
          : 1;
      writePixel(
        ambientOcclusion,
        offset,
        [occlusion, occlusion, occlusion, 1],
      );
    }
  }

  const roughnessValue = roughnessTotal / pixelCount;
  const metallicValue = metallicTotal / pixelCount;

  return {
    width,
    height,
    albedo,
    heightMap,
    normal,
    roughness,
    metallic,
    ambientOcclusion,
    roughnessValue,
    metallicValue,
    warnings,
  };
}

export function evaluateNodeMap(
  project: Pick<MaterialProject, "nodes" | "edges">,
  nodeId: string,
  size = 64,
  textureInputs?: MaterialEvaluation,
) {
  const compiledGraph = compileMaterialGraph(project);
  const nodes = new Map(compiledGraph.nodesById);
  const node = nodes.get(nodeId);
  const pixels = new Uint8ClampedArray(size * size * 4);
  if (!node) return pixels;
  if (node.data.kind === "output") {
    return evaluateMaterial(project, size, textureInputs).albedo;
  }

  const step = 1 / size;
  const definition = getMaterialNodeDefinition(node.data.kind);
  const outputPort = definition.outputs[0];
  if (!outputPort) return pixels;
  const nodeSource: MaterialGraphSource = {
    nodeId: node.id,
    portId: outputPort.id,
    type: outputPort.type,
  };
  const heightSource = node.data.kind === "normal"
    ? compiledGraph.inputSourceFor(node.id, "height")
    : undefined;
  const normalStrength = node.data.values.strength ?? 1;
  const plan = createEvaluationPlan(
    compiledGraph,
    [heightSource ?? nodeSource],
  );

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const offset = (y * size + x) * 4;
      if (node.data.kind !== "normal") {
        const evaluated = evaluatePlanAt(plan, u, v, textureInputs);
        writePixel(
          pixels,
          offset,
          sampleEvaluatedSource(evaluated, nodeSource),
        );
        continue;
      }

      const heightL = sampleEvaluatedSource(
        evaluatePlanAt(plan, (u - step + 1) % 1, v, textureInputs),
        heightSource,
      )[0];
      const heightR = sampleEvaluatedSource(
        evaluatePlanAt(plan, (u + step) % 1, v, textureInputs),
        heightSource,
      )[0];
      const heightD = sampleEvaluatedSource(
        evaluatePlanAt(plan, u, (v - step + 1) % 1, textureInputs),
        heightSource,
      )[0];
      const heightU = sampleEvaluatedSource(
        evaluatePlanAt(plan, u, (v + step) % 1, textureInputs),
        heightSource,
      )[0];
      let nx = (heightL - heightR) * normalStrength * 2;
      let ny = (heightD - heightU) * normalStrength * 2;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      writePixel(pixels, offset, [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz, 1]);
    }
  }

  return pixels;
}

export function pixelsToCanvas(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is not available in this browser.");
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The texture could not be encoded."));
    }, "image/png");
  });
}
