import type {
  MaterialGraphEdge,
  MaterialGraphNode,
  MaterialProject,
} from "./material-types";
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

function sourceFor(
  edges: MaterialGraphEdge[],
  nodeId: string,
  targetHandle: string,
) {
  return edges.find(
    (edge) => edge.target === nodeId && edge.targetHandle === targetHandle,
  )?.source;
}

function evaluateNode(
  nodeId: string | undefined,
  u: number,
  v: number,
  nodes: Map<string, MaterialGraphNode>,
  edges: MaterialGraphEdge[],
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
        sourceFor(edges, node.id, portId),
        u,
        v,
        nodes,
        edges,
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
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const output = project.nodes.find((node) => node.data.kind === "output");
  const warnings: string[] = [];
  if (!output) warnings.push("The graph has no PBR output node.");

  const baseColorSource = output
    ? sourceFor(project.edges, output.id, "baseColor")
    : undefined;
  const normalSource = output
    ? sourceFor(project.edges, output.id, "normal")
    : undefined;
  const roughnessSource = output
    ? sourceFor(project.edges, output.id, "roughness")
    : undefined;
  const metallicSource = output
    ? sourceFor(project.edges, output.id, "metallic")
    : undefined;

  if (!baseColorSource) warnings.push("Base color is not connected.");
  if (!roughnessSource) warnings.push("Roughness is not connected.");
  if (!metallicSource) warnings.push("Metallic is not connected.");

  const roughnessValue = clamp(
    evaluateNode(
      roughnessSource,
      0.5,
      0.5,
      nodes,
      project.edges,
      new Set(),
    )[0],
  );
  const metallicValue = clamp(
    evaluateNode(
      metallicSource,
      0.5,
      0.5,
      nodes,
      project.edges,
      new Set(),
    )[0],
  );

  const albedo = new Uint8ClampedArray(size * size * 4);
  const heightMap = new Uint8ClampedArray(size * size * 4);
  const normal = new Uint8ClampedArray(size * size * 4);
  const roughness = new Uint8ClampedArray(size * size * 4);
  const metallic = new Uint8ClampedArray(size * size * 4);
  const ambientOcclusion = new Uint8ClampedArray(size * size * 4);
  const step = 1 / size;
  const normalNode = normalSource ? nodes.get(normalSource) : undefined;
  const heightSource =
    normalNode?.data.kind === "normal"
      ? sourceFor(project.edges, normalNode.id, "height")
      : normalSource;
  const normalStrength = normalNode?.data.values.strength ?? 1;

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
        project.edges,
        new Set(),
      );
      writePixel(albedo, offset, base);

      const heightL = evaluateNode(
        heightSource,
        (u - step + 1) % 1,
        v,
        nodes,
        project.edges,
        new Set(),
      )[0];
      const heightR = evaluateNode(
        heightSource,
        (u + step) % 1,
        v,
        nodes,
        project.edges,
        new Set(),
      )[0];
      const heightD = evaluateNode(
        heightSource,
        u,
        (v - step + 1) % 1,
        nodes,
        project.edges,
        new Set(),
      )[0];
      const heightU = evaluateNode(
        heightSource,
        u,
        (v + step) % 1,
        nodes,
        project.edges,
        new Set(),
      )[0];
      const heightValue = evaluateNode(
        heightSource,
        u,
        v,
        nodes,
        project.edges,
        new Set(),
      )[0];
      let nx = (heightL - heightR) * normalStrength * 2;
      let ny = (heightD - heightU) * normalStrength * 2;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      const occlusion = clamp(
        1 - Math.max(0, (heightL + heightR + heightD + heightU) * 0.25 - heightValue) * 2.5,
      );
      writePixel(heightMap, offset, [heightValue, heightValue, heightValue, 1]);
      writePixel(normal, offset, [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz, 1]);
      writePixel(roughness, offset, [roughnessValue, roughnessValue, roughnessValue, 1]);
      writePixel(metallic, offset, [metallicValue, metallicValue, metallicValue, 1]);
      writePixel(ambientOcclusion, offset, [occlusion, occlusion, occlusion, 1]);
    }
  }

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
  const nodes = new Map(project.nodes.map((node) => [node.id, node]));
  const node = nodes.get(nodeId);
  const pixels = new Uint8ClampedArray(size * size * 4);
  if (!node) return pixels;
  if (node.data.kind === "output") {
    return evaluateMaterial(project, size).albedo;
  }

  const step = 1 / size;
  const heightSource = node.data.kind === "normal"
    ? sourceFor(project.edges, node.id, "height")
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
          evaluateNode(node.id, u, v, nodes, project.edges, new Set()),
        );
        continue;
      }

      const heightL = evaluateNode(
        heightSource,
        (u - step + 1) % 1,
        v,
        nodes,
        project.edges,
        new Set(),
      )[0];
      const heightR = evaluateNode(
        heightSource,
        (u + step) % 1,
        v,
        nodes,
        project.edges,
        new Set(),
      )[0];
      const heightD = evaluateNode(
        heightSource,
        u,
        (v - step + 1) % 1,
        nodes,
        project.edges,
        new Set(),
      )[0];
      const heightU = evaluateNode(
        heightSource,
        u,
        (v + step) % 1,
        nodes,
        project.edges,
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
