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
const { module: compiler } = await importTypeScriptModule(
  "../app/core/material-graph-compiler.ts",
  new Map([["./material-node-registry", registryImport.url]]),
);
const { createMaterialNodeData } = registryImport.module;

function node(id, kind) {
  return {
    id,
    type: "materialNode",
    position: { x: 0, y: 0 },
    data: createMaterialNodeData(kind),
  };
}

function edge(id, source, sourceHandle, target, targetHandle) {
  return { id, source, sourceHandle, target, targetHandle };
}

test("compiler creates an indexed, topological graph for valid nodes", () => {
  const nodes = [node("color", "color"), node("output", "output")];
  const edges = [edge("color-out", "color", "out", "output", "baseColor")];
  const result = compiler.compileMaterialGraph({ nodes, edges });

  assert.equal(result.isValid, true);
  assert.equal(result.sourceFor("output", "baseColor"), "color");
  assert.deepEqual(result.inputSourceFor("output", "baseColor"), {
    nodeId: "color",
    portId: "out",
    type: "color",
  });
  assert.deepEqual(result.topologicalNodeIds, ["color", "output"]);
  assert.deepEqual([...result.reachableNodeIds], ["output", "color"]);
  assert.deepEqual(result.diagnostics, []);
});

test("compiler preserves the selected source port for multi-output nodes", () => {
  const nodes = [
    node("color", "color"),
    node("channels", "channels"),
    node("output", "output"),
  ];
  const edges = [
    edge("color-to-channels", "color", "out", "channels", "in"),
    edge("green-to-roughness", "channels", "g", "output", "roughness"),
  ];
  const result = compiler.compileMaterialGraph({ nodes, edges });

  assert.equal(result.isValid, true);
  assert.deepEqual(result.inputSourceFor("output", "roughness"), {
    nodeId: "channels",
    portId: "g",
    type: "scalar",
  });
});

test("compiler reports duplicate inputs and dangling connections", () => {
  const nodes = [
    node("color-a", "color"),
    node("color-b", "color"),
    node("output", "output"),
  ];
  const edges = [
    edge("first", "color-a", "out", "output", "baseColor"),
    edge("second", "color-b", "out", "output", "baseColor"),
    edge("dangling", "missing", "out", "output", "roughness"),
  ];
  const result = compiler.compileMaterialGraph({ nodes, edges });

  assert.equal(result.isValid, false);
  assert.deepEqual(
    result.diagnostics
      .filter(({ severity }) => severity === "error")
      .map(({ code }) => code),
    ["multiple-inputs", "dangling-edge"],
  );
  assert.equal(result.sourceFor("output", "baseColor"), "color-a");
});

test("connection validation blocks incompatible normals and cycles", () => {
  const nodes = [
    node("noise", "noise"),
    node("levels-a", "levels"),
    node("levels-b", "levels"),
    node("output", "output"),
  ];

  const normalMismatch = compiler.validateMaterialConnection(
    { nodes, edges: [] },
    {
      source: "noise",
      sourceHandle: "out",
      target: "output",
      targetHandle: "normal",
    },
  );
  assert.equal(normalMismatch.valid, false);
  assert.match(normalMismatch.reason, /cannot feed/i);

  const existingEdges = [
    edge("a-to-b", "levels-a", "out", "levels-b", "in"),
  ];
  const cycle = compiler.validateMaterialConnection(
    { nodes, edges: existingEdges },
    {
      source: "levels-b",
      sourceHandle: "out",
      target: "levels-a",
      targetHandle: "in",
    },
  );
  assert.deepEqual(cycle, {
    valid: false,
    reason: "This connection would create a cycle.",
  });
});

test("compiler marks every node participating in an imported cycle", () => {
  const nodes = [
    node("levels-a", "levels"),
    node("levels-b", "levels"),
    node("output", "output"),
  ];
  const edges = [
    edge("a-to-b", "levels-a", "out", "levels-b", "in"),
    edge("b-to-a", "levels-b", "out", "levels-a", "in"),
    edge("to-output", "levels-a", "out", "output", "baseColor"),
  ];
  const result = compiler.compileMaterialGraph({ nodes, edges });

  assert.equal(result.isValid, false);
  assert.deepEqual(
    result.diagnostics
      .filter(({ code }) => code === "cycle")
      .map(({ nodeId }) => nodeId)
      .sort(),
    ["levels-a", "levels-b"],
  );
});
