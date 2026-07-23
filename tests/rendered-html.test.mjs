import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the material studio shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /Forge Material Studio/i);
  assert.match(html, /Material Studio/);
  assert.match(html, /Bake &amp; export/);
  assert.match(html, /Node library/);
  assert.match(html, /Add albedo texture/);
  assert.match(html, /Generate 6 editable PBR maps/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("server-renders the no-upload web viewer", async () => {
  const response = await render("/viewer");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Material Viewer · Forge Material Studio<\/title>/i);
  assert.match(html, /No files are uploaded/);
  assert.match(html, /Open \.mmpack/);
  assert.match(html, /My materials/);
  assert.match(html, /Private by design/);
  assert.match(html, /Ambient occlusion/);
});

test("keeps persistence local and removes the starter preview", async () => {
  const [persistence, studio, preview, node, hosting] = await Promise.all([
    readFile(new URL("../app/core/material-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialNode.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(persistence, /indexedDB\.open/);
  assert.match(persistence, /privacy:\s*"local-only"/);
  assert.match(persistence, /textures\/height\.png/);
  assert.match(persistence, /textures\/ambient-occlusion\.png/);
  assert.match(persistence, /deleteProjectLocal/);
  assert.match(persistence, /loadProjectsLocal/);
  assert.match(studio, /Save to Library/);
  assert.match(studio, /Place Map Lab maps/);
  assert.match(studio, /Nodes & recipes/);
  assert.match(preview, /diagnostic\.diffuseColor = Color3\.Black/);
  assert.match(preview, /DefaultRenderingPipeline/);
  assert.match(preview, /ShadowGenerator/);
  assert.match(preview, /procedural-studio-environment/);
  assert.match(node, /material-node__thumbnail/);
  assert.match(hosting, /"d1": null/);
  assert.match(hosting, /"r2": null/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
