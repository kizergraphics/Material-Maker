import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
  assert.match(response.headers.get("content-security-policy") ?? "", /object-src 'none'/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const html = await response.text();
  assert.match(html, /Forge Material Studio/i);
  assert.match(html, /Material Studio/);
  assert.match(html, /Bake &amp; export/);
  assert.match(html, /Download all maps/);
  assert.match(html, /No material selected/);
  assert.match(html, /Select a material to begin/);
  assert.doesNotMatch(html, /Oxidized Alloy/);
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
  assert.match(html, /Save viewer tweaks/);
  assert.match(html, /Generated outputs/);
  assert.match(html, /Graph values/);
  assert.match(html, /Private by design/);
  assert.match(html, /Ambient occlusion/);
  assert.match(html, /Preview resolution/);
  assert.match(html, /2K/);
});

test("production server serves compiled client assets", async () => {
  const { startProdServer } = await import("vinext/server/prod-server");
  const { server, port } = await startProdServer({
    port: 0,
    host: "127.0.0.1",
    outDir: fileURLToPath(new URL("../dist", import.meta.url)),
    noCompression: true,
    purpose: "test",
  });

  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(response.status, 200);
    const html = await response.text();
    const stylesheetPath = html.match(
      /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i,
    )?.[1];
    assert.ok(stylesheetPath, "The production page should reference a stylesheet.");

    const stylesheet = await fetch(
      new URL(stylesheetPath, `http://127.0.0.1:${port}/`),
    );
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("content-type") ?? "", /^text\/css\b/i);
    assert.ok((await stylesheet.text()).length > 1_000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("keeps persistence local and creates only the PBR output node", async () => {
  const [persistence, studio, preview, node, types, store, launcher, hosting, evaluationHook, mapLab, generationWorker] = await Promise.all([
    readFile(new URL("../app/core/material-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialNode.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/core/material-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/core/material-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../launcher/Program.cs", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/core/use-material-evaluation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TextureMapLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workers/material-generation.worker.ts", import.meta.url), "utf8"),
  ]);
  assert.match(persistence, /indexedDB\.open/);
  assert.match(persistence, /privacy:\s*"local-only"/);
  assert.match(persistence, /textures\/height\.png/);
  assert.match(persistence, /textures\/ambient-occlusion\.png/);
  assert.match(persistence, /deleteProjectLocal/);
  assert.match(persistence, /loadProjectsLocal/);
  assert.match(persistence, /MAX_ZIP_TOTAL_BYTES/);
  assert.match(persistence, /Source images must be embedded/);
  assert.match(studio, /Save to Library/);
  assert.match(studio, /Place Map Lab maps/);
  assert.match(studio, /Nodes & recipes/);
  assert.match(preview, /diagnostic\.unlit = true/);
  assert.match(preview, /DefaultRenderingPipeline/);
  assert.match(preview, /ShadowGenerator/);
  assert.match(preview, /procedural-studio-environment/);
  assert.match(preview, /TriPlanarPBRPlugin/);
  assert.match(
    preview,
    /super\(material,\s*"seamless-triplanar",\s*200,\s*\{\},\s*false,\s*false,\s*true\);[\s\S]*this\.textures = textures;[\s\S]*this\._pluginManager\._addPlugin\(this\);[\s\S]*this\._enable\(true\);/,
  );
  assert.match(preview, /SEAMLESS TRI-PLANAR/);
  assert.match(preview, /MeshBuilder\.CreateSphere/);
  assert.doesNotMatch(preview, /createPoleFreeSphere/);
  assert.match(studio, /createGraphNodeThumbnails/);
  assert.match(studio, /evaluateNodeMap/);
  assert.match(node, /has-thumbnail/);
  assert.match(node, /material-node__thumbnail/);
  assert.match(
    types,
    /createStarterProject\(\)[\s\S]*?nodes:\s*\[[\s\S]*?id:\s*"material-output"[\s\S]*?kind:\s*"output"[\s\S]*?\],[\s\S]*?edges:\s*\[\],/,
  );
  assert.match(
    store,
    /existingOutput\s*\?\?\s*\{[\s\S]*?id:\s*"material-output"[\s\S]*?kind:\s*"output"[\s\S]*?\(existingOutput\s*\?\s*\[\]\s*:\s*\[output\]\)/,
  );
  assert.doesNotMatch(types, /Warm alloy|Micro pitting|Surface variation/);
  assert.match(launcher, /ResolveAppPort\(stateDirectory\)/);
  assert.match(launcher, /app-port\.txt/);
  assert.match(launcher, /http_localhost_\*\.indexeddb\.leveldb/);
  assert.doesNotMatch(launcher, /TcpListener\(IPAddress\.Loopback,\s*0\)/);
  assert.match(launcher, /EnsureProductionBuildAsync/);
  assert.match(launcher, /run start -- --hostname 127\.0\.0\.1 --port/);
  assert.doesNotMatch(launcher, /run dev -- --host 127\.0\.0\.1 --port/);
  assert.match(evaluationHook, /INTERACTIVE_PREVIEW_EDGE\s*=\s*128/);
  assert.match(evaluationHook, /FULL_PREVIEW_DELAY_MS\s*=\s*160/);
  assert.match(evaluationHook, /generationIdRef/);
  assert.match(evaluationHook, /clearTimeout\(fullResolutionTimer\)/);
  assert.match(evaluationHook, /new Worker\(/);
  assert.match(evaluationHook, /worker\.terminate\(\)/);
  assert.match(generationWorker, /OffscreenCanvas/);
  assert.match(generationWorker, /transferablesFor/);
  assert.match(studio, /graphThumbnailCacheRef/);
  assert.match(studio, /graphNodeSignature/);
  assert.match(mapLab, /disabled=\{isGenerating\}/);
  assert.match(hosting, /"d1": null/);
  assert.match(hosting, /"r2": null/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
