import type {
  MaterialGraphEdge,
  MaterialGraphNode,
  MaterialProject,
} from "./material-types";

type ColorValue = [number, number, number, number];

export interface MaterialEvaluation {
  width: number;
  height: number;
  albedo: Uint8ClampedArray;
  normal: Uint8ClampedArray;
  roughness: Uint8ClampedArray;
  metallic: Uint8ClampedArray;
  roughnessValue: number;
  metallicValue: number;
  warnings: string[];
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

function hexToColor(hex: string | undefined): ColorValue {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return [0.5, 0.5, 0.5, 1];
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

function hash2d(x: number, y: number, seed: number) {
  let value = (x * 374761393 + y * 668265263 + seed * 69069) | 0;
  value = (value ^ (value >>> 13)) * 1274126177;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

const smooth = (value: number) => value * value * (3 - 2 * value);

function tileableNoise(u: number, v: number, scale: number, seed: number) {
  const frequency = Math.max(1, Math.round(scale));
  const x = u * frequency;
  const y = v * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % frequency;
  const y1 = (y0 + 1) % frequency;
  const wrappedX0 = ((x0 % frequency) + frequency) % frequency;
  const wrappedY0 = ((y0 % frequency) + frequency) % frequency;
  const tx = smooth(x - Math.floor(x));
  const ty = smooth(y - Math.floor(y));
  const a = hash2d(wrappedX0, wrappedY0, seed);
  const b = hash2d(x1, wrappedY0, seed);
  const c = hash2d(wrappedX0, y1, seed);
  const d = hash2d(x1, y1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

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
  let result: ColorValue;

  switch (node.data.kind) {
    case "color":
      result = hexToColor(values.color);
      break;
    case "noise": {
      const raw = tileableNoise(
        u,
        v,
        values.scale ?? 8,
        Math.round(values.seed ?? 1),
      );
      const contrast = 0.45 + (values.contrast ?? 0.5) * 2.1;
      const tonal = clamp((raw - 0.5) * contrast + 0.5);
      result = [tonal, tonal, tonal, 1];
      break;
    }
    case "levels": {
      const input = evaluateNode(
        sourceFor(edges, node.id, "in"),
        u,
        v,
        nodes,
        edges,
        stack,
      );
      const minimum = values.minimum ?? 0;
      const maximum = Math.max(minimum + 0.001, values.maximum ?? 1);
      const gamma = Math.max(0.05, values.gamma ?? 1);
      const remap = (channel: number) =>
        Math.pow(clamp((channel - minimum) / (maximum - minimum)), 1 / gamma);
      result = [remap(input[0]), remap(input[1]), remap(input[2]), input[3]];
      break;
    }
    case "blend": {
      const a = evaluateNode(
        sourceFor(edges, node.id, "a"),
        u,
        v,
        nodes,
        edges,
        stack,
      );
      stack.delete(sourceFor(edges, node.id, "a") ?? "");
      const b = evaluateNode(
        sourceFor(edges, node.id, "b"),
        u,
        v,
        nodes,
        edges,
        stack,
      );
      const opacity = clamp(values.opacity ?? 0.5);
      result = [
        a[0] + (b[0] - a[0]) * opacity,
        a[1] + (b[1] - a[1]) * opacity,
        a[2] + (b[2] - a[2]) * opacity,
        1,
      ];
      break;
    }
    case "roughness":
    case "metallic": {
      const value = clamp(values.value ?? 0.5);
      result = [value, value, value, 1];
      break;
    }
    case "normal":
      result = evaluateNode(
        sourceFor(edges, node.id, "height"),
        u,
        v,
        nodes,
        edges,
        stack,
      );
      break;
    default:
      result = [0.5, 0.5, 0.5, 1];
  }

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
  const normal = new Uint8ClampedArray(size * size * 4);
  const roughness = new Uint8ClampedArray(size * size * 4);
  const metallic = new Uint8ClampedArray(size * size * 4);
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
      let nx = (heightL - heightR) * normalStrength * 2;
      let ny = (heightD - heightU) * normalStrength * 2;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz) || 1;
      nx /= length;
      ny /= length;
      nz /= length;
      writePixel(normal, offset, [nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz, 1]);
      writePixel(roughness, offset, [roughnessValue, roughnessValue, roughnessValue, 1]);
      writePixel(metallic, offset, [metallicValue, metallicValue, metallicValue, 1]);
    }
  }

  return {
    width: size,
    height: size,
    albedo,
    normal,
    roughness,
    metallic,
    roughnessValue,
    metallicValue,
    warnings,
  };
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
