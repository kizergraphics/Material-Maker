import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import JSZip from "jszip";
import ts from "typescript";

function moduleUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

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
  const url = moduleUrl(javascript);
  return { module: await import(url), url };
}

function asPackFile(bytes) {
  Object.defineProperty(bytes, "size", {
    configurable: true,
    value: bytes.byteLength,
  });
  return bytes;
}

const registryImport = await importTypeScriptModule(
  "../app/core/material-node-registry.ts",
);
const migrationImport = await importTypeScriptModule(
  "../app/core/material-project-migrations.ts",
  new Map([["./material-node-registry", registryImport.url]]),
);
const evaluatorStub = moduleUrl(`
  let lastEvaluationSize = null;
  function pixels(value) {
    return new Uint8ClampedArray([value, value, value, 255]);
  }
  export function evaluateMaterial(_project, size) {
    lastEvaluationSize = size;
    return {
      width: 1,
      height: 1,
      albedo: new Uint8ClampedArray([118, 112, 106, 255]),
      heightMap: pixels(128),
      normal: new Uint8ClampedArray([128, 128, 255, 255]),
      roughness: pixels(153),
      metallic: pixels(0),
      ambientOcclusion: pixels(255),
      roughnessValue: 0.6,
      metallicValue: 0,
      warnings: [],
    };
  }
  export function getLastEvaluationSize() {
    return lastEvaluationSize;
  }
  export function pixelsToCanvas(pixels, width, height) {
    return { pixels, width, height };
  }
  export async function canvasToBlob(canvas) {
    return new Uint8Array(canvas.pixels);
  }
`);
const generatedCacheStub = moduleUrl(`
  export async function getPersistentGeneratedMaps() { return null; }
  export async function storePersistentGeneratedMaps() {}
`);
const localDatabaseStub = moduleUrl(`
  export const PROJECT_STORE = "projects";
  export async function openMaterialDatabase() {
    throw new Error("Database access is not available in this test.");
  }
`);
const materialTypesStub = moduleUrl(`
  export const PROJECT_SCHEMA_VERSION = 4;
  export const DEFAULT_MAP_SETTINGS = {
    baseColor: { enabled: true, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
    height: { enabled: true, contrast: 1.18, bias: 0, blur: 1, invert: false },
    normal: { enabled: true, strength: 2.2, detail: 1, invertY: false },
    roughness: { enabled: true, base: 0.62, variation: 0.34, invert: false },
    metallic: { enabled: true, base: 0, variation: 0, invert: false },
    ao: { enabled: true, strength: 1.2, radius: 4, bias: 0 },
  };
`);
const textureGeneratorStub = moduleUrl(`
  export async function evaluateSourceTexture() {
    throw new Error("Source texture evaluation is not expected in this test.");
  }
  export function pixelsForChannel(evaluation, channel) {
    if (channel === "baseColor") return evaluation.albedo;
    if (channel === "height") return evaluation.heightMap;
    if (channel === "normal") return evaluation.normal;
    if (channel === "roughness") return evaluation.roughness;
    if (channel === "metallic") return evaluation.metallic;
    return evaluation.ambientOcclusion;
  }
`);
const persistenceImport = await importTypeScriptModule(
  "../app/core/material-persistence.ts",
  new Map([
    ["jszip", import.meta.resolve("jszip")],
    ["zod", import.meta.resolve("zod")],
    ["./material-node-registry", registryImport.url],
    ["./material-evaluator", evaluatorStub],
    ["./generated-map-cache", generatedCacheStub],
    ["./local-database", localDatabaseStub],
    ["./material-project-migrations", migrationImport.url],
    ["./material-types", materialTypesStub],
    ["./texture-generator", textureGeneratorStub],
  ]),
);

const {
  createMaterialPack,
  getCachedProjectMapBlob,
  importMaterialPack,
  prepareProjectForStorage,
} = persistenceImport.module;
const evaluatorStubModule = await import(evaluatorStub);

test("local storage preparation preserves graph connections and node positions", () => {
  const timestamp = "2026-07-30T15:00:00.000Z";
  const project = {
    schemaVersion: 4,
    id: "stored-graph",
    name: "Stored Graph",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [
      {
        id: "color",
        type: "materialNode",
        position: { x: -312.5, y: 148.25 },
        selected: true,
        data: {
          label: "Base color",
          kind: "color",
          category: "input",
          version: 1,
          values: { color: "#336699" },
        },
      },
      {
        id: "output",
        type: "materialNode",
        position: { x: 427.75, y: -96.5 },
        data: {
          label: "PBR material",
          kind: "output",
          category: "output",
          version: 2,
          values: {},
        },
      },
    ],
    edges: [
      {
        id: "color-output",
        source: "color",
        sourceHandle: "out",
        target: "output",
        targetHandle: "baseColor",
        selected: true,
      },
    ],
    preview: {
      shape: "sphere",
      channel: "material",
      showGrid: true,
      autoRotate: true,
      tiled: true,
    },
    sourceTexture: null,
    mapSettings: {
      baseColor: { enabled: true, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
      height: { enabled: true, contrast: 1.18, bias: 0, blur: 1, invert: false },
      normal: { enabled: true, strength: 2.2, detail: 1, invertY: false },
      roughness: { enabled: true, base: 0.62, variation: 0.34, invert: false },
      metallic: { enabled: true, base: 0, variation: 0, invert: false },
      ao: { enabled: true, strength: 1.2, radius: 4, bias: 0 },
    },
    exportResolution: 1024,
  };

  const stored = prepareProjectForStorage(project);

  assert.deepEqual(
    stored.nodes.map(({ id, position }) => ({ id, position })),
    [
      { id: "color", position: { x: -312.5, y: 148.25 } },
      { id: "output", position: { x: 427.75, y: -96.5 } },
    ],
  );
  assert.deepEqual(stored.edges, [
    {
      id: "color-output",
      source: "color",
      target: "output",
      sourceHandle: "out",
      targetHandle: "baseColor",
    },
  ]);
  assert.equal("selected" in stored.nodes[0], false);
});

test("individual map preparation uses the selected export resolution", async () => {
  const timestamp = "2026-07-30T15:30:00.000Z";
  const project = {
    schemaVersion: 4,
    id: "full-resolution-map",
    name: "Full Resolution Map",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [],
    edges: [],
    preview: {
      shape: "sphere",
      channel: "roughness",
      showGrid: true,
      autoRotate: true,
      tiled: true,
    },
    sourceTexture: null,
    mapSettings: {
      baseColor: { enabled: true, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
      height: { enabled: true, contrast: 1.18, bias: 0, blur: 1, invert: false },
      normal: { enabled: true, strength: 2.2, detail: 1, invertY: false },
      roughness: { enabled: true, base: 0.62, variation: 0.34, invert: false },
      metallic: { enabled: true, base: 0, variation: 0, invert: false },
      ao: { enabled: true, strength: 1.2, radius: 4, bias: 0 },
    },
    exportResolution: 2048,
  };

  const blob = await getCachedProjectMapBlob(project, "roughness");

  assert.ok(blob);
  assert.equal(evaluatorStubModule.getLastEvaluationSize(), 2048);
});

test("legacy material packs migrate, normalize, export, and re-import", async () => {
  const timestamp = "2026-01-02T03:04:05.000Z";
  const legacyProject = {
    schemaVersion: 1,
    id: "legacy-round-trip",
    name: "Legacy Round Trip",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: [
      {
        id: "color",
        type: "materialNode",
        position: { x: 0, y: 0 },
        data: {
          label: "Base color",
          kind: "color",
          category: "input",
          values: { color: "#336699", opacity: 0.5 },
        },
      },
      {
        id: "levels",
        type: "materialNode",
        position: { x: 180, y: 0 },
        data: {
          label: "Levels",
          kind: "levels",
          category: "filter",
          version: 1,
          values: {
            min: -1,
            max: 2,
            gamma: "invalid",
            unknown: 42,
          },
        },
      },
      {
        id: "noise",
        type: "materialNode",
        position: { x: 0, y: 180 },
        data: {
          label: "Value noise",
          kind: "noise",
          category: "blend",
          values: {
            scale: 100,
            contrast: -3,
            seed: "invalid",
          },
        },
      },
      {
        id: "generated",
        type: "materialNode",
        position: { x: 0, y: 300 },
        data: {
          label: "Generated map",
          kind: "textureMap",
          category: "input",
          values: {
            mapChannel: "invalid",
            enabled: "yes",
            value: 0.3,
          },
        },
      },
      {
        id: "output",
        type: "materialNode",
        position: { x: 360, y: 0 },
        data: {
          label: "PBR material",
          kind: "output",
          category: "output",
          version: 1,
          values: {},
        },
      },
    ],
    edges: [
      {
        id: "color-levels",
        source: "color",
        sourceHandle: "out",
        target: "levels",
        targetHandle: "in",
      },
      {
        id: "levels-output",
        source: "levels",
        sourceHandle: "out",
        target: "output",
        targetHandle: "albedo",
      },
    ],
    preview: {
      shape: "sphere",
      channel: "material",
      showGrid: true,
      autoRotate: true,
      tiled: true,
    },
  };
  const legacyZip = new JSZip();
  legacyZip.file(
    "manifest.json",
    JSON.stringify({
      format: "forge-material-pack",
      formatVersion: 1,
    }),
  );
  legacyZip.file("material.json", JSON.stringify(legacyProject));
  const legacyBytes = asPackFile(
    await legacyZip.generateAsync({ type: "uint8array" }),
  );

  const imported = await importMaterialPack(legacyBytes);

  assert.equal(imported.schemaVersion, 4);
  assert.equal(imported.nodes.find(({ id }) => id === "noise").data.category, "generator");
  assert.deepEqual(
    imported.nodes.find(({ id }) => id === "levels").data.values,
    { minimum: 0, maximum: 1, gamma: 1.08 },
  );
  assert.deepEqual(
    imported.nodes.find(({ id }) => id === "noise").data.values,
    { scale: 32, contrast: 0, seed: 14 },
  );
  assert.deepEqual(
    imported.nodes.find(({ id }) => id === "generated").data.values,
    { mapChannel: "baseColor", enabled: true },
  );
  assert.equal(
    imported.edges.find(({ id }) => id === "levels-output").targetHandle,
    "baseColor",
  );

  const exported = await createMaterialPack(imported);
  assert.match(exported.filename, /\.mmpack$/);
  const exportedBytes = asPackFile(
    new Uint8Array(await exported.blob.arrayBuffer()),
  );
  const reimported = await importMaterialPack(exportedBytes);

  assert.equal(reimported.schemaVersion, 4);
  assert.deepEqual(reimported.nodes, imported.nodes);
  assert.deepEqual(reimported.edges, imported.edges);
  assert.deepEqual(reimported.mapSettings, imported.mapSettings);
  assert.equal(reimported.exportResolution, imported.exportResolution);
});
