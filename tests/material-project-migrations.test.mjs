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
const migrationImport = await importTypeScriptModule(
  "../app/core/material-project-migrations.ts",
  new Map([["./material-node-registry", registryImport.url]]),
);
const compilerImport = await importTypeScriptModule(
  "../app/core/material-graph-compiler.ts",
  new Map([["./material-node-registry", registryImport.url]]),
);

const { getMaterialNodeDefinition } = registryImport.module;
const { migrateMaterialGraph } = migrationImport.module;

function storedNode(id, kind, values = {}, version) {
  const definition = getMaterialNodeDefinition(kind);
  return {
    id,
    type: "materialNode",
    position: { x: 0, y: 0 },
    data: {
      label: definition.label,
      kind,
      category: definition.category,
      ...(version === undefined ? {} : { version }),
      values,
    },
  };
}

function edge(id, source, sourceHandle, target, targetHandle) {
  return { id, source, sourceHandle, target, targetHandle };
}

test("legacy parameters and both sides of socket connections migrate together", () => {
  const nodes = [
    storedNode("color", "color", { color: "#336699" }),
    storedNode("levels", "levels", { min: 0.2, max: 0.8, gamma: 1 }),
    storedNode("normal", "normal", { intensity: 2 }),
    storedNode("channels", "channels"),
    storedNode("output", "output"),
  ];
  const edges = [
    edge("color-levels", "color", "out", "levels", "in"),
    edge("levels-normal", "levels", "out", "normal", "source"),
    edge("color-channels", "color", "out", "channels", "in"),
    edge("levels-albedo", "levels", "out", "output", "albedo"),
    edge("red-metal", "channels", "red", "output", "metalness"),
    edge("blue-ao", "channels", "blue", "output", "ambientOcclusion"),
    edge("normal-output", "normal", "normal", "output", "normal"),
  ];

  const migrated = migrateMaterialGraph(nodes, edges);
  const levels = migrated.nodes.find(({ id }) => id === "levels");
  const normal = migrated.nodes.find(({ id }) => id === "normal");

  assert.deepEqual(levels.data.values, {
    minimum: 0.2,
    maximum: 0.8,
    gamma: 1,
  });
  assert.deepEqual(normal.data.values, { strength: 2 });
  for (const node of migrated.nodes) {
    assert.equal(
      node.data.version,
      getMaterialNodeDefinition(node.data.kind).version,
    );
  }
  assert.deepEqual(
    migrated.edges.map(({ sourceHandle, targetHandle }) => [
      sourceHandle,
      targetHandle,
    ]),
    [
      ["out", "in"],
      ["out", "height"],
      ["out", "in"],
      ["out", "baseColor"],
      ["r", "metallic"],
      ["b", "ao"],
      ["normal", "normal"],
    ],
  );
  assert.equal(
    compilerImport.module.compileMaterialGraph(migrated).isValid,
    true,
  );
  assert.deepEqual(
    migrateMaterialGraph(migrated.nodes, migrated.edges),
    migrated,
    "migrations should be idempotent",
  );
});

test("canonical parameter values win over legacy aliases", () => {
  const migrated = migrateMaterialGraph(
    [
      storedNode(
        "levels",
        "levels",
        { min: 0.1, minimum: 0.35, max: 0.9, maximum: 0.7 },
        1,
      ),
    ],
    [],
  );

  assert.deepEqual(migrated.nodes[0].data.values, {
    minimum: 0.35,
    maximum: 0.7,
  });
});

test("future node versions fail with a clear compatibility error", () => {
  assert.throws(
    () =>
      migrateMaterialGraph(
        [storedNode("levels", "levels", {}, 99)],
        [],
      ),
    /newer than supported version/i,
  );
});
