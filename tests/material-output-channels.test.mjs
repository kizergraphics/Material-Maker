import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScriptModule(path, replacements = new Map()) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  let javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  for (const [specifier, replacement] of replacements) {
    javascript = javascript.replaceAll(`"${specifier}"`, `"${replacement}"`);
  }
  const url = `data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`;
  return { module: await import(url), url };
}

const registryImport = await importTypeScriptModule(
  "../app/core/material-node-registry.ts",
);
const compilerImport = await importTypeScriptModule(
  "../app/core/material-graph-compiler.ts",
  new Map([["./material-node-registry", registryImport.url]]),
);
const { module: evaluator } = await importTypeScriptModule(
  "../app/core/material-evaluator.ts",
  new Map([
    ["./material-node-registry", registryImport.url],
    ["./material-graph-compiler", compilerImport.url],
  ]),
);
const { createMaterialNodeData } = registryImport.module;

function node(id, kind, values = {}) {
  return {
    id,
    type: "materialNode",
    position: { x: 0, y: 0 },
    data: createMaterialNodeData(kind, { values }),
  };
}

function edge(id, source, sourceHandle, target, targetHandle) {
  return { id, source, sourceHandle, target, targetHandle };
}

function firstChannels(pixels) {
  const values = [];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    values.push(pixels[offset]);
  }
  return values;
}

test("all six graph outputs evaluate independently per pixel", () => {
  const nodes = [
    node("color", "color", { color: "#ff0000" }),
    node("noise", "noise", { scale: 5, contrast: 0.72, seed: 19 }),
    node("height", "roughness", { value: 0.2 }),
    node("normal", "normal", { strength: 2 }),
    node("ao", "roughness", { value: 0.25 }),
    node("output", "output"),
  ];
  const edges = [
    edge("base", "color", "out", "output", "baseColor"),
    edge("height", "height", "out", "output", "height"),
    edge("normal-height", "noise", "out", "normal", "height"),
    edge("normal", "normal", "normal", "output", "normal"),
    edge("roughness", "noise", "out", "output", "roughness"),
    edge("metallic", "noise", "out", "output", "metallic"),
    edge("ao", "ao", "out", "output", "ao"),
  ];

  const result = evaluator.evaluateMaterial({ nodes, edges }, 16);
  const albedo = firstChannels(result.albedo);
  const height = firstChannels(result.heightMap);
  const normalX = firstChannels(result.normal);
  const roughness = firstChannels(result.roughness);
  const metallic = firstChannels(result.metallic);
  const ao = firstChannels(result.ambientOcclusion);

  assert.deepEqual(new Set(albedo), new Set([255]));
  assert.deepEqual(new Set(height), new Set([51]));
  assert.ok(new Set(normalX).size > 1, "normal output should vary from its own height input");
  assert.ok(new Set(roughness).size > 1, "roughness should evaluate per pixel");
  assert.ok(new Set(metallic).size > 1, "metallic should evaluate per pixel");
  assert.deepEqual(roughness, metallic);
  assert.deepEqual(new Set(ao), new Set([64]));
  assert.deepEqual(result.warnings, []);

  const roughnessPixelAverage =
    roughness.reduce((total, value) => total + value, 0) /
    roughness.length /
    255;
  assert.ok(Math.abs(result.roughnessValue - roughnessPixelAverage) <= 1 / 255);
  assert.ok(Math.abs(result.metallicValue - roughnessPixelAverage) <= 1 / 255);
});

test("unconnected optional outputs use neutral PBR defaults", () => {
  const nodes = [
    node("color", "color", { color: "#808080" }),
    node("output", "output"),
  ];
  const edges = [
    edge("base", "color", "out", "output", "baseColor"),
  ];
  const result = evaluator.evaluateMaterial({ nodes, edges }, 2);

  assert.deepEqual(new Set(firstChannels(result.heightMap)), new Set([128]));
  assert.deepEqual(
    [...result.normal.slice(0, 4)],
    [128, 128, 255, 255],
  );
  assert.deepEqual(new Set(firstChannels(result.roughness)), new Set([153]));
  assert.deepEqual(new Set(firstChannels(result.metallic)), new Set([0]));
  assert.deepEqual(
    new Set(firstChannels(result.ambientOcclusion)),
    new Set([255]),
  );
  assert.equal(result.roughnessValue, 0.6);
  assert.equal(result.metallicValue, 0);
});

test("multi-output nodes can branch distinct ports into material channels", () => {
  const nodes = [
    node("color", "color", { color: "#336699" }),
    node("channels", "channels"),
    node("output", "output"),
  ];
  const edges = [
    edge("color", "color", "out", "channels", "in"),
    edge("base", "color", "out", "output", "baseColor"),
    edge("red", "channels", "r", "output", "roughness"),
    edge("green", "channels", "g", "output", "metallic"),
    edge("blue", "channels", "b", "output", "ao"),
  ];

  const result = evaluator.evaluateMaterial({ nodes, edges }, 2);

  assert.deepEqual(new Set(firstChannels(result.roughness)), new Set([51]));
  assert.deepEqual(new Set(firstChannels(result.metallic)), new Set([102]));
  assert.deepEqual(
    new Set(firstChannels(result.ambientOcclusion)),
    new Set([153]),
  );
  assert.equal(result.roughnessValue, 0.2);
  assert.equal(result.metallicValue, 0.4);
  assert.deepEqual(result.warnings, []);
});

test("generated texture maps flow through the compiled graph at source dimensions", () => {
  const nodes = [
    node("generated-base", "textureMap", { mapChannel: "baseColor" }),
    node("levels", "levels", { minimum: 0, maximum: 1, gamma: 1 }),
    node("generated-height", "textureMap", { mapChannel: "height" }),
    node("generated-normal", "textureMap", { mapChannel: "normal" }),
    node("generated-rough", "textureMap", { mapChannel: "roughness" }),
    node("generated-metal", "textureMap", { mapChannel: "metallic" }),
    node("generated-ao", "textureMap", { mapChannel: "ao" }),
    node("output", "output"),
  ];
  const edges = [
    edge("base-levels", "generated-base", "out", "levels", "in"),
    edge("base", "levels", "out", "output", "baseColor"),
    edge("height", "generated-height", "out", "output", "height"),
    edge("normal", "generated-normal", "out", "output", "normal"),
    edge("rough", "generated-rough", "out", "output", "roughness"),
    edge("metal", "generated-metal", "out", "output", "metallic"),
    edge("ao", "generated-ao", "out", "output", "ao"),
  ];
  const textureInputs = {
    width: 2,
    height: 1,
    albedo: new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]),
    heightMap: new Uint8ClampedArray([
      64, 64, 64, 255,
      192, 192, 192, 255,
    ]),
    normal: new Uint8ClampedArray([
      128, 128, 255, 255,
      96, 160, 240, 255,
    ]),
    roughness: new Uint8ClampedArray([
      32, 32, 32, 255,
      224, 224, 224, 255,
    ]),
    metallic: new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]),
    ambientOcclusion: new Uint8ClampedArray([
      200, 200, 200, 255,
      100, 100, 100, 255,
    ]),
    roughnessValue: 0.5,
    metallicValue: 0.5,
    warnings: [],
  };

  const result = evaluator.evaluateMaterial(
    { nodes, edges },
    8,
    textureInputs,
  );

  assert.equal(result.width, 2);
  assert.equal(result.height, 1);
  assert.deepEqual(result.albedo, textureInputs.albedo);
  assert.deepEqual(result.heightMap, textureInputs.heightMap);
  assert.deepEqual(result.normal, textureInputs.normal);
  assert.deepEqual(result.roughness, textureInputs.roughness);
  assert.deepEqual(result.metallic, textureInputs.metallic);
  assert.deepEqual(
    result.ambientOcclusion,
    textureInputs.ambientOcclusion,
  );
  assert.equal(result.roughnessValue, 128 / 255);
  assert.equal(result.metallicValue, 0.5);
  assert.deepEqual(result.warnings, []);
});

test("Transform 2D resamples its upstream graph at transformed UV coordinates", () => {
  const nodes = [
    node("checker", "checker", { scale: 2, rotation: 0 }),
    node("transform", "transform2d", {
      scaleX: 1,
      scaleY: 1,
      offsetX: 0.25,
      offsetY: 0,
      rotation: 0,
    }),
  ];
  const edges = [
    edge("checker-transform", "checker", "out", "transform", "in"),
  ];

  const transformed = evaluator.evaluateNodeMap(
    { nodes, edges },
    "transform",
    4,
  );

  assert.deepEqual(firstChannels(transformed).slice(0, 4), [0, 255, 255, 0]);
});
