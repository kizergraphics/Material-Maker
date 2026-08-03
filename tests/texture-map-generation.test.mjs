import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
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
  return import(url);
}

const cacheStub = moduleUrl(`
  export async function fingerprintSourceFile() { return "test-source"; }
`);
const generator = await importTypeScriptModule(
  "../app/core/texture-generator.ts",
  new Map([["./generated-map-cache", cacheStub]]),
);

const settings = {
  baseColor: { enabled: true, brightness: 0, contrast: 1, saturation: 1, hue: 0 },
  height: { enabled: true, depth: 0.008, contrast: 1, bias: 0, blur: 0, invert: false },
  normal: { enabled: true, strength: 2, detail: 1, invertY: false },
  roughness: { enabled: true, base: 0.5, variation: 1, invert: false },
  metallic: { enabled: true, base: 0.25, variation: 0.5, invert: false },
  ao: { enabled: true, strength: 1.2, radius: 1, bias: 0 },
};

function grayscaleSource(values) {
  return new Uint8ClampedArray(
    values.flatMap((value) => [value, value, value, 255]),
  );
}

function firstChannel(pixels) {
  const values = [];
  for (let offset = 0; offset < pixels.length; offset += 4) {
    values.push(pixels[offset]);
  }
  return values;
}

test("the image pipeline emits six complete PBR maps", () => {
  const source = grayscaleSource(
    [0, 64, 192, 255, 255, 192, 64, 0],
  );
  const result = generator.generatePreparedMaps(
    generator.prepareSourcePixels(source, 4, 2, 1),
    settings,
  );

  for (const pixels of [
    result.albedo,
    result.heightMap,
    result.normal,
    result.roughness,
    result.metallic,
    result.ambientOcclusion,
  ]) {
    assert.equal(pixels.length, 4 * 2 * 4);
    for (let offset = 3; offset < pixels.length; offset += 4) {
      assert.equal(pixels[offset], 255);
    }
  }
  assert.ok(new Set(firstChannel(result.heightMap)).size > 1);
  assert.ok(new Set(firstChannel(result.normal)).size > 1);
  assert.ok(new Set(firstChannel(result.roughness)).size > 1);
  assert.ok(new Set(firstChannel(result.metallic)).size > 1);
  assert.ok(new Set(firstChannel(result.ambientOcclusion)).size > 1);
});

test("roughness uses its generated scalar values instead of a constant channel", () => {
  const source = grayscaleSource([0, 255]);
  const result = generator.generatePreparedMaps(
    generator.prepareSourcePixels(source, 2, 1, 1),
    settings,
  );

  assert.deepEqual(firstChannel(result.roughness), [0, 255]);
  assert.equal(result.roughnessValue, 0.5);
});

test("height processing drives the derived normal and AO maps", () => {
  const source = grayscaleSource(
    [0, 64, 192, 255, 255, 192, 64, 0],
  );
  const prepared = generator.prepareSourcePixels(source, 4, 2, 1);
  const regular = generator.generatePreparedMaps(prepared, settings);
  const inverted = generator.generatePreparedMaps(prepared, {
    ...settings,
    height: { ...settings.height, invert: true },
  });

  assert.notDeepEqual(regular.normal, inverted.normal);
  assert.notDeepEqual(regular.ambientOcclusion, inverted.ambientOcclusion);
  assert.notDeepEqual(regular.heightMap, inverted.heightMap);
});
