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

    let expectedVersion = 1;
    for (const migration of definition.migrations ?? []) {
      assert.equal(
        migration.fromVersion,
        expectedVersion,
        `${definition.kind} has a gap in its migration chain`,
      );
      assert.ok(migration.toVersion > migration.fromVersion);
      assert.ok(migration.toVersion <= definition.version);
      const parameterKeys = new Set(
        definition.parameters.map(({ key }) => key),
      );
      for (const target of Object.values(
        migration.parameterRenames ?? {},
      )) {
        assert.ok(
          parameterKeys.has(target),
          `${definition.kind} migration targets unknown parameter ${target}`,
        );
      }
      for (const [key, value] of Object.entries(
        migration.addedDefaults ?? {},
      )) {
        assert.ok(
          Object.hasOwn(definition.defaultValues, key),
          `${definition.kind} migration adds unknown default ${key}`,
        );
        assert.equal(
          value,
          definition.defaultValues[key],
          `${definition.kind} migration default for ${key} is stale`,
        );
      }
      const inputIds = new Set(definition.inputs.map(({ id }) => id));
      for (const target of Object.values(migration.inputPortRenames ?? {})) {
        assert.ok(
          inputIds.has(target),
          `${definition.kind} migration targets unknown input ${target}`,
        );
      }
      const outputIds = new Set(definition.outputs.map(({ id }) => id));
      for (const target of Object.values(migration.outputPortRenames ?? {})) {
        assert.ok(
          outputIds.has(target),
          `${definition.kind} migration targets unknown output ${target}`,
        );
      }
      expectedVersion = migration.toVersion;
    }
    assert.equal(
      expectedVersion,
      definition.version,
      `${definition.kind} migrations do not reach the current version`,
    );
  }
});

test("new node data stores the current definition version", () => {
  for (const definition of registry.MATERIAL_NODE_DEFINITIONS) {
    const data = registry.createMaterialNodeData(definition.kind);
    assert.equal(data.version, definition.version);
  }
});

test("node values normalize by definition and discard unsupported fields", () => {
  assert.deepEqual(
    registry.normalizeMaterialNodeValues("noise", {
      scale: 999,
      contrast: -4,
      seed: "not-a-number",
      opacity: 0.25,
    }),
    {
      scale: 32,
      contrast: 0,
      seed: 14,
    },
  );
  assert.deepEqual(
    registry.normalizeMaterialNodeValues("color", {
      color: "red",
      value: 0.2,
    }),
    { color: "#76706a" },
  );
  assert.deepEqual(
    registry.normalizeMaterialNodeValues("textureMap", {
      mapChannel: "unsupported",
      enabled: "yes",
      thumbnail: "data:image/png;base64,AA==",
      seed: 4,
    }),
    {
      mapChannel: "baseColor",
      enabled: true,
      thumbnail: "data:image/png;base64,AA==",
    },
  );
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

  const sampleNoise = (u, v, seed = 14) =>
    noise.evaluate({
      u,
      v,
      values: { scale: 8, contrast: 0.62, seed },
      sampleInput: () => [0, 0, 0, 1],
    });
  assert.ok(
    Math.abs(sampleNoise(0, 0.43)[0] - sampleNoise(1, 0.43)[0]) < 1e-12,
  );
  assert.ok(
    Math.abs(sampleNoise(0.27, 0)[0] - sampleNoise(0.27, 1)[0]) < 1e-12,
  );
  assert.notDeepEqual(sampleNoise(0.375, 0.625), sampleNoise(0.375, 0.625, 15));
  for (const sample of [
    sampleNoise(0.1, 0.2),
    sampleNoise(0.4, 0.7),
    sampleNoise(0.9, 0.3),
  ]) {
    assert.equal(sample[0], sample[1]);
    assert.equal(sample[1], sample[2]);
    assert.equal(sample[3], 1);
    assert.ok(sample[0] >= 0 && sample[0] <= 1);
  }

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

  const textureMap = registry.getMaterialNodeDefinition("textureMap");
  assert.deepEqual(
    textureMap.evaluate({
      u: 0.25,
      v: 0.75,
      values: { mapChannel: "roughness", enabled: true },
      sampleInput: () => [0, 0, 0, 1],
      sampleTextureMap: (channel) =>
        channel === "roughness" ? [0.2, 0.2, 0.2, 1] : [0, 0, 0, 1],
    }),
    [0.2, 0.2, 0.2, 1],
  );
});
