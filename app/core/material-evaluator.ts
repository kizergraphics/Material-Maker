import {
  compileMaterialGraph,
  type CompiledMaterialGraph,
} from "./material-graph-compiler";
import type { MaterialGraphNode, MaterialProject } from "./material-types";
import {
  getMaterialNodeDefinition,
  type MaterialNodeSample,
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

function evaluateNode(
  nodeId: string | undefined,
  u: number,
  v: number,
  nodes: Map<string, MaterialGraphNode>,
  compiledGraph: CompiledMaterialGraph,
  stack: Set<string>,
): ColorValue {
  if (!nodeId) return [0.5, 0.5, 0.5, 1];
  const node = nodes.get(nodeId);
  if (!node || stack.has(nodeId)) return [1, 0.08, 0.35, 1];

  stack.add(nodeId);
  const values = node.data.values;
  const definition = getMaterialNodeDefinition(node.data.kind);
  const result = definition.evaluate?.({
    u,
    v,
    values,
    sampleInput: (portId) =>
      evaluateNode(
        compiledGraph.sourceFor(node.id, portId),
        u,
        v,
        nodes,
        compiledGraph,
        stack,
      ),
  }) ?? [0.5, 0.5, 0.5, 1];

  stack.delete(nodeId);
  return result;
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
): MaterialEvaluation {
  const compiledGraph = compileMaterialGraph(project);
  const nodes = new Map(compiledGraph.nodesById);
  const output = compiledGraph.outputNode;
  const warnings = compiledGraph.diagnostics.map(
    (diagnostic) => diagnostic.message,
  );

  const baseColorSource = output
    ? compiledGraph.sourceFor(output.id, "baseColor")
    : undefined;
  const normalSource = output
    ? compiledGraph.sourceFor(output.id, "normal")
    : undefined;
  const roughnessSource = output
    ? compiledGraph.sourceFor(output.id, "roughness")
    : undefined;
  const metallicSource = output
    ? compiledGraph.sourceFor(output.id, "metallic")
    : undefined;
  const explicitHeightSource = output
    ? compiledGraph.sourceFor(output.id, "height")
    : undefined;
  const ambientOcclusionSource = output
    ? compiledGraph.sourceFor(output.id, "ao")
    : undefined;

  if (!roughnessSource) warnings.push("Roughness is not connected.");
  if (!metallicSource) warnings.push("Metallic is not connected.");

  const albedo = new Uint8ClampedArray(size * size * 4);
  const heightMap = new Uint8ClampedArray(size * size * 4);
  const normal = new Uint8ClampedArray(size * size * 4);
  const roughness = new Uint8ClampedArray(size * size * 4);
  const metallic = new Uint8ClampedArray(size * size * 4);
  const ambientOcclusion = new Uint8ClampedArray(size * size * 4);
  const step = 1 / size;
  const normalNode = normalSource ? nodes.get(normalSource) : undefined;
  const normalHeightSource =
    normalNode?.data.kind === "normal"
      ? compiledGraph.sourceFor(normalNode.id, "height")
      : undefined;
  const heightSource = explicitHeightSource ?? normalHeightSource;
  const normalStrength = normalNode?.data.values.strength ?? 1;
  const pixelCount = size * size;
  let roughnessTotal = 0;
  let metallicTotal = 0;
  const sampleScalar = (
    nodeId: string | undefined,
    u: number,
    v: number,
    fallback: number,
  ) =>
    nodeId
      ? clamp(
          evaluateNode(
            nodeId,
            u,
            v,
            nodes,
            compiledGraph,
            new Set(),
          )[0],
        )
      : fallback;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const offset = (y * size + x) * 4;
      const base = evaluateNode(
        baseColorSource,
        u,
        v,
        nodes,
        compiledGraph,
        new Set(),
      );
      writePixel(albedo, offset, base);

      const heightValue = sampleScalar(heightSource, u, v, 0.5);
      writePixel(heightMap, offset, [heightValue, heightValue, heightValue, 1]);

      let normalHeightL = 0.5;
      let normalHeightR = 0.5;
      let normalHeightD = 0.5;
      let normalHeightU = 0.5;
      if (normalHeightSource) {
        normalHeightL = sampleScalar(
          normalHeightSource,
          (u - step + 1) % 1,
          v,
          0.5,
        );
        normalHeightR = sampleScalar(
          normalHeightSource,
          (u + step) % 1,
          v,
          0.5,
        );
        normalHeightD = sampleScalar(
          normalHeightSource,
          u,
          (v - step + 1) % 1,
          0.5,
        );
        normalHeightU = sampleScalar(
          normalHeightSource,
          u,
          (v + step) % 1,
          0.5,
        );
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
          evaluateNode(
            normalSource,
            u,
            v,
            nodes,
            compiledGraph,
            new Set(),
          ),
        );
      } else {
        writePixel(normal, offset, [0.5, 0.5, 1, 1]);
      }

      const roughnessSample = sampleScalar(roughnessSource, u, v, 0.6);
      const metallicSample = sampleScalar(metallicSource, u, v, 0);
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
      if (!ambientOcclusionSource && heightSource) {
        if (heightSource === normalHeightSource) {
          aoHeightL = normalHeightL;
          aoHeightR = normalHeightR;
          aoHeightD = normalHeightD;
          aoHeightU = normalHeightU;
        } else {
          aoHeightL = sampleScalar(
            heightSource,
            (u - step + 1) % 1,
            v,
            0.5,
          );
          aoHeightR = sampleScalar(
            heightSource,
            (u + step) % 1,
            v,
            0.5,
          );
          aoHeightD = sampleScalar(
            heightSource,
            u,
            (v - step + 1) % 1,
            0.5,
          );
          aoHeightU = sampleScalar(
            heightSource,
            u,
            (v + step) % 1,
            0.5,
          );
        }
      }
      const occlusion = ambientOcclusionSource
        ? sampleScalar(ambientOcclusionSource, u, v, 1)
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
    width: size,
    height: size,
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
) {
  const compiledGraph = compileMaterialGraph(project);
  const nodes = new Map(compiledGraph.nodesById);
  const node = nodes.get(nodeId);
  const pixels = new Uint8ClampedArray(size * size * 4);
  if (!node) return pixels;
  if (node.data.kind === "output") {
    return evaluateMaterial(project, size).albedo;
  }

  const step = 1 / size;
  const heightSource = node.data.kind === "normal"
    ? compiledGraph.sourceFor(node.id, "height")
    : undefined;
  const normalStrength = node.data.values.strength ?? 1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const v = y / size;
      const offset = (y * size + x) * 4;
      if (node.data.kind !== "normal") {
        writePixel(
          pixels,
          offset,
          evaluateNode(node.id, u, v, nodes, compiledGraph, new Set()),
        );
        continue;
      }

      const heightL = evaluateNode(
        heightSource,
        (u - step + 1) % 1,
        v,
        nodes,
        compiledGraph,
        new Set(),
      )[0];
      const heightR = evaluateNode(
        heightSource,
        (u + step) % 1,
        v,
        nodes,
        compiledGraph,
        new Set(),
      )[0];
      const heightD = evaluateNode(
        heightSource,
        u,
        (v - step + 1) % 1,
        nodes,
        compiledGraph,
        new Set(),
      )[0];
      const heightU = evaluateNode(
        heightSource,
        u,
        (v + step) % 1,
        nodes,
        compiledGraph,
        new Set(),
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
