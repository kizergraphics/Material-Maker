import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const registrySource = await readFile(
  new URL("../app/core/material-node-registry.ts", import.meta.url),
  "utf8",
);
const registryJavaScript = ts.transpileModule(registrySource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const registry = await import(
  `data:text/javascript;base64,${Buffer.from(registryJavaScript).toString("base64")}`
);

test("registry defines every node kind exactly once", () => {
  const definitions = registry.MATERIAL_NODE_DEFINITIONS;
  const definitionKinds = definitions.map((definition) => definition.kind);

  assert.deepEqual(definitionKinds, registry.MATERIAL_NODE_KINDS);
  assert.equal(new Set(definitionKinds).size, definitionKinds.length);
  assert.deepEqual(
    registry.NODE_LIBRARY.map((definition) => definition.kind),
    [
      "color",
      "noise",
      "levels",
      "blend",
      "channels",
      "roughness",
      "metallic",
      "normal",
    ],
  );
});

test("registry definitions have internally consistent ports and defaults", () => {
  for (const definition of registry.MATERIAL_NODE_DEFINITIONS) {
    assert.ok(definition.version > 0);
    assert.ok(definition.label);
    assert.ok(definition.description);

    const portIds = [...definition.inputs, ...definition.outputs].map(
      (port) => port.id,
    );
    assert.equal(
      new Set(portIds).size,
      portIds.length,
      `${definition.kind} contains duplicate port IDs`,
    );

    for (const parameter of definition.parameters) {
      assert.equal(
        definition.defaultValues[parameter.key],
        parameter.defaultValue,
        `${definition.kind}.${parameter.key} has mismatched defaults`,
      );
    }
  }
});

test("registry evaluators preserve existing deterministic sampling behavior", () => {
  const color = registry.getMaterialNodeDefinition("color");
  assert.deepEqual(
    color.evaluate({
      u: 0,
      v: 0,
      values: { color: "#ff8040" },
      sampleInput: () => [0, 0, 0, 1],
    }),
    [1, 128 / 255, 64 / 255, 1],
  );

  const levels = registry.getMaterialNodeDefinition("levels");
  assert.deepEqual(
    levels.evaluate({
      u: 0,
      v: 0,
      values: { minimum: 0, maximum: 1, gamma: 1 },
      sampleInput: () => [0.25, 0.5, 0.75, 1],
    }),
    [0.25, 0.5, 0.75, 1],
  );

  const noise = registry.getMaterialNodeDefinition("noise");
  const context = {
    u: 0.375,
    v: 0.625,
    values: { scale: 8, contrast: 0.62, seed: 14 },
    sampleInput: () => [0, 0, 0, 1],
  };
  assert.deepEqual(noise.evaluate(context), noise.evaluate(context));

  const channels = registry.getMaterialNodeDefinition("channels");
  assert.deepEqual(
    channels.evaluate({
      u: 0,
      v: 0,
      values: {},
      sampleInput: () => [0.1, 0.2, 0.3, 0.4],
    }),
    {
      r: [0.1, 0.1, 0.1, 1],
      g: [0.2, 0.2, 0.2, 1],
      b: [0.3, 0.3, 0.3, 1],
      a: [0.4, 0.4, 0.4, 1],
    },
  );
});
