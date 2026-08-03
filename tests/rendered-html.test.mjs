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

test("keeps Babylon and Map Lab out of the initial studio and viewer bundles", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../dist/client/.vite/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const studioKey = "app/components/MaterialStudio.tsx";
  const viewerKey = "app/components/MaterialViewerClient.tsx";
  const previewKey = "app/components/MaterialPreview.tsx";
  const mapLabKey = "app/components/TextureMapLab.tsx";

  const staticImportsFor = (entryKey) => {
    const imports = new Set();
    const visit = (key) => {
      if (imports.has(key)) return;
      imports.add(key);
      for (const importedKey of manifest[key]?.imports ?? []) {
        visit(importedKey);
      }
    };
    visit(entryKey);
    return imports;
  };

  assert.equal(manifest[previewKey]?.isDynamicEntry, true);
  assert.equal(manifest[mapLabKey]?.isDynamicEntry, true);
  for (const entryKey of [studioKey, viewerKey]) {
    const staticImports = staticImportsFor(entryKey);
    assert.equal(staticImports.has(previewKey), false);
    assert.equal(staticImports.has(mapLabKey), false);
  }
});

test("keeps persistence local and creates only the PBR output node", async () => {
  const [persistence, localDatabase, generatedMapCache, studio, preview, node, types, store, launcher, hosting, evaluationHook, textureGenerator, mapLab, generationWorker, graphWorker, graphWorkerTypes, workerUrl, deferredTools] = await Promise.all([
    readFile(new URL("../app/core/material-persistence.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/core/local-database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/core/generated-map-cache.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialStudio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialPreview.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/MaterialNode.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/core/material-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/core/material-store.ts", import.meta.url), "utf8"),
    readFile(new URL("../launcher/Program.cs", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/core/use-material-evaluation.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/core/texture-generator.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/TextureMapLab.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workers/material-generation.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/workers/graph-evaluation.worker.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/core/graph-evaluation-worker-types.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/core/worker-url.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/DeferredMaterialTools.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(localDatabase, /indexedDB\.open/);
  assert.match(localDatabase, /GENERATED_MAP_CACHE_STORE/);
  assert.match(localDatabase, /PREFERENCE_STORE\s*=\s*"preferences"/);
  assert.match(localDatabase, /DB_VERSION\s*=\s*3/);
  assert.match(localDatabase, /createIndex\("createdAt",\s*"createdAt"\)/);
  assert.match(persistence, /privacy:\s*"local-only"/);
  assert.match(persistence, /textures\/height\.png/);
  assert.match(persistence, /textures\/ambient-occlusion\.png/);
  assert.match(persistence, /deleteProjectLocal/);
  assert.match(persistence, /loadProjectsLocal/);
  assert.match(persistence, /savePreviewFloorPreference/);
  assert.match(persistence, /loadPreviewFloorPreference/);
  assert.match(persistence, /prepareProjectForStorage\(project\)/);
  assert.match(persistence, /objectStore\(PROJECT_STORE\)\.put\(storedProject\)/);
  assert.match(persistence, /MAX_ZIP_TOTAL_BYTES/);
  assert.match(persistence, /Source images must be embedded/);
  assert.match(persistence, /migrateMaterialGraph\(value\.nodes,\s*value\.edges\)/);
  assert.match(persistence, /version:\s*z\.number\(\)\.int\(\)\.positive\(\)/);
  assert.match(types, /PROJECT_SCHEMA_VERSION\s*=\s*4/);
  assert.match(studio, /Save to Library/);
  assert.match(studio, /Place Map Lab maps/);
  assert.match(
    studio,
    /exportResolution === "original"[\s\S]*?Math\.min\(2048,[\s\S]*?sourceTexture\.width[\s\S]*?sourceTexture\.height[\s\S]*?: exportResolution/,
  );
  assert.match(studio, /Nodes & recipes/);
  assert.match(preview, /diagnostic\.unlit = true/);
  assert.match(preview, /DefaultRenderingPipeline/);
  assert.match(preview, /ShadowGenerator/);
  assert.match(preview, /procedural-studio-environment/);
  assert.match(preview, /TriPlanarPBRPlugin/);
  assert.match(preview, /Model UVs/);
  assert.match(preview, /Tri-planar/);
  assert.match(preview, /UV texture tiling/);
  assert.match(preview, /anisotropicFilteringLevel = 16/);
  assert.match(
    preview,
    /new DynamicTexture\([\s\S]*?true,[\s\S]*?Texture\.TRILINEAR_SAMPLINGMODE/,
  );
  assert.match(preview, /applyUvTiling\(albedo\.texture, uvTiling\)/);
  assert.match(
    preview,
    /previewResolutionLabel\(evaluation\.width, evaluation\.height\)/,
  );
  assert.match(preview, /useAmbientOcclusionFromMetallicTextureRed = true/);
  assert.match(preview, /useRoughnessFromMetallicTextureAlpha = false/);
  assert.match(preview, /useRoughnessFromMetallicTextureGreen = true/);
  assert.match(preview, /useMetallnessFromMetallicTextureBlue = true/);
  assert.match(preview, /packNormalHeightTexture/);
  assert.match(preview, /pbr\.useParallax = materialHeightDepth > 0/);
  assert.match(preview, /pbr\.useParallaxOcclusion = false/);
  assert.match(preview, /pbr\.parallaxScaleBias = materialHeightDepth/);
  assert.match(preview, /pbr\.bumpTexture = normal\.texture/);
  assert.match(mapLab, /Surface depth/);
  assert.match(
    preview,
    /super\(material,\s*"seamless-triplanar",\s*200,\s*\{\},\s*false,\s*false,\s*true\);[\s\S]*this\.textures = textures;[\s\S]*this\._pluginManager\._addPlugin\(this\);[\s\S]*this\._enable\(true\);/,
  );
  assert.match(preview, /SEAMLESS TRI-PLANAR/);
  assert.match(preview, /preview-ball\.fbx/);
  assert.match(preview, /SceneLoader\.ImportMeshAsync/);
  assert.match(preview, /primary-preview-root/);
  assert.doesNotMatch(preview, /Mesh\.MergeMeshes/);
  assert.doesNotMatch(preview, /createPoleFreeSphere/);
  assert.match(preview, /pixelBuffersEqual/);
  assert.match(preview, /uploadTexturePixels/);
  assert.match(preview, /currentGpuState\?\.structureKey === materialStructureKey/);
  assert.match(preview, /updateTexture\(\s*currentGpuState\.albedo/);
  assert.match(preview, /updateTexture\(\s*currentGpuState\.normal/);
  assert.match(preview, /updateTexture\(\s*currentGpuState\.orm/);
  assert.match(studio, /planGraphNodeThumbnails/);
  assert.match(studio, /evaluateNodeMap/);
  assert.match(node, /has-thumbnail/);
  assert.match(node, /material-node__thumbnail/);
  assert.match(
    types,
    /createStarterProject\(\)[\s\S]*?nodes:\s*\[[\s\S]*?id:\s*"material-output"[\s\S]*?data:\s*createMaterialNodeData\("output"\)[\s\S]*?\],[\s\S]*?edges:\s*\[\],/,
  );
  assert.match(
    store,
    /existingOutput\s*\?\?\s*\{[\s\S]*?id:\s*"material-output"[\s\S]*?data:\s*createMaterialNodeData\("output"\)[\s\S]*?\(existingOutput\s*\?\s*\[\]\s*:\s*\[output\]\)/,
  );
  assert.match(store, /function ensureMaterialOutput/);
  assert.match(store, /setPersistentPreviewFloor/);
  assert.match(
    store,
    /replaceProject:[\s\S]*?ground:\s*structuredClone\(state\.preview\.scene\.ground\)/,
  );
  assert.match(
    store,
    /change\.type === "remove"\s*&&\s*outputIds\.has\(change\.id\)/,
  );
  assert.match(store, /nodes:\s*ensureMaterialOutput\(project\.nodes\)/);
  assert.match(studio, /deletable:\s*node\.data\.kind\s*!==\s*"output"/);
  assert.match(studio, /Graph is incomplete/);
  assert.match(studio, /compileMaterialGraph/);
  assert.match(studio, /validationIssues/);
  assert.match(studio, /onConnect=\{connectGraphNodes\}/);
  assert.match(studio, /onNodeDragStop=\{persistGraphImmediately\}/);
  assert.doesNotMatch(
    studio,
    /header-save"[\s\S]{0,200}disabled=\{!hasActiveProject\s*\|\|\s*saveState\s*===\s*"saving"\}/,
  );
  assert.match(
    studio,
    /workspaceView\s*===\s*"graph"\s*&&\s*selectedNode\s*&&\s*!selectedMapChannel\s*\?\s*\([\s\S]*?<NodeInspector node=\{selectedNode\}\s*\/>[\s\S]*?\)\s*:\s*sourceTexture\s*\?/,
  );
  assert.match(studio, /selected:\s*node\.id\s*===\s*selectedNodeId/);
  assert.match(
    studio,
    /node\.data\.kind\s*===\s*"textureMap"\s*&&\s*node\.data\.values\.mapChannel[\s\S]*?setChannel\(node\.data\.values\.mapChannel\)/,
  );
  assert.match(studio, /onNodeClick=\{\(_,\s*node\)\s*=>\s*selectGraphNode\(node\)\}/);
  assert.match(studio, /onPaneClick=\{\(\)\s*=>\s*setSelectedNode\(null\)\}/);
  assert.match(
    studio,
    /className=\{`\$\{preview\.channel[\s\S]*?onClick=\{\(\)\s*=>\s*\{\s*setSelectedNode\(null\);\s*setChannel\(item\.id\);/,
  );
  assert.match(node, /definition\.outputs\.map/);
  assert.match(node, /className="material-node__output"/);
  assert.doesNotMatch(types, /Warm alloy|Micro pitting|Surface variation/);
  assert.match(launcher, /ResolveAppPort\(stateDirectory\)/);
  assert.match(launcher, /app-port\.txt/);
  assert.match(launcher, /http_localhost_\*\.indexeddb\.leveldb/);
  assert.doesNotMatch(launcher, /TcpListener\(IPAddress\.Loopback,\s*0\)/);
  assert.match(launcher, /EnsureProductionBuildAsync/);
  assert.match(launcher, /CancellationToken/);
  assert.match(launcher, /Installing project dependencies/);
  assert.match(launcher, /run start -- --hostname 127\.0\.0\.1 --port/);
  assert.doesNotMatch(launcher, /run dev -- --host 127\.0\.0\.1 --port/);
  assert.match(evaluationHook, /INTERACTIVE_PREVIEW_EDGE\s*=\s*128/);
  assert.match(evaluationHook, /INTERACTIVE_PREVIEW_DELAY_MS\s*=\s*40/);
  assert.match(evaluationHook, /FULL_PREVIEW_DELAY_MS\s*=\s*240/);
  assert.match(evaluationHook, /interactiveRef/);
  assert.match(evaluationHook, /clearTimeout\(interactiveTimer\)/);
  assert.match(evaluationHook, /generationIdRef/);
  assert.match(evaluationHook, /clearTimeout\(fullResolutionTimer\)/);
  assert.match(evaluationHook, /new Worker\(/);
  assert.match(evaluationHook, /worker\.terminate\(\)/);
  assert.match(evaluationHook, /graph-evaluation\.worker\.ts/);
  assert.match(evaluationHook, /GRAPH_EVALUATION_DELAY_MS\s*=\s*50/);
  assert.doesNotMatch(evaluationHook, /const graphEvaluation = useMemo/);
  assert.match(generationWorker, /OffscreenCanvas/);
  assert.match(generationWorker, /transferablesFor/);
  assert.match(graphWorker, /evaluateMaterial/);
  assert.match(graphWorker, /evaluateNodeMap/);
  assert.match(graphWorker, /transferablesFor/);
  assert.match(graphWorkerTypes, /projectForGraphWorker/);
  assert.match(workerUrl, /assetUrl\.protocol\s*!==\s*"file:"/);
  assert.match(workerUrl, /window\.location\.origin/);
  assert.match(evaluationHook, /browserWorkerUrl/);
  assert.match(evaluationHook, /Promise\.resolve\(\)\.then\(evaluateInWorker\)/);
  assert.match(evaluationHook, /getPersistentGeneratedMaps/);
  assert.match(evaluationHook, /storePersistentGeneratedMaps/);
  assert.match(evaluationHook, /function changedMapChannels/);
  assert.match(
    evaluationHook,
    /changed\.has\("height"\)[\s\S]*?changed\.add\("normal"\)[\s\S]*?changed\.add\("ao"\)/,
  );
  assert.match(studio, /Tile \{preview\.uvTiling\}×/);
  assert.match(studio, /aria-pressed=\{preview\.channel === item\.id\}/);
  assert.match(textureGenerator, /fingerprintSourceFile/);
  assert.match(generatedMapCache, /GENERATION_ALGORITHM_VERSION/);
  assert.match(generatedMapCache, /MAX_PERSISTENT_CACHE_ENTRIES\s*=\s*3/);
  assert.match(generatedMapCache, /fingerprintSourceTexture/);
  assert.match(generatedMapCache, /fingerprintSettings/);
  assert.match(generatedMapCache, /settings\.baseColor\.brightness/);
  assert.doesNotMatch(generatedMapCache, /enabled:\s*settings\./);
  assert.match(generatedMapCache, /isValidCacheRecord/);
  assert.match(persistence, /getPersistentGeneratedMaps/);
  assert.match(persistence, /storePersistentGeneratedMaps/);
  assert.match(studio, /browserWorkerUrl/);
  assert.match(studio, /graphThumbnailCacheRef/);
  assert.match(studio, /graphNodeSignature/);
  assert.match(studio, /forge-graph-thumbnails/);
  assert.match(mapLab, /disabled=\{isGenerating\}/);
  assert.match(deferredTools, /lazy\(\(\)\s*=>/);
  assert.match(deferredTools, /import\("\.\/MaterialPreview"\)/);
  assert.match(deferredTools, /import\("\.\/TextureMapLab"\)/);
  assert.match(deferredTools, /prewarmDeferredMaterialTools/);
  assert.match(persistence, /evaluationBlobCache/);
  assert.match(persistence, /getCachedProjectMapBlobs/);
  assert.match(
    persistence,
    /getCachedProjectMapBlob\([\s\S]*?getCachedProjectMapBlobs\(project,\s*\[channel\]\)/,
  );
  assert.match(studio, /onDownloadMap=\{prepareProjectMapDownload\}/);
  assert.match(studio, /Choose map size/);
  assert.match(studio, /getExportDimensions\(source,\s*option\.value\)/);
  assert.match(studio, /Upscaled · no new detail/);
  assert.match(studio, /onClick=\{openDownloadSizeDialog\}/);
  assert.match(studio, /handleDownloadAllMaps\(resolution\)/);
  assert.match(mapLab, /onDownloadMap:\s*\(channel:\s*TextureMapChannel\)\s*=>\s*Promise<Blob>/);
  assert.match(mapLab, /value="original"/);
  assert.match(mapLab, /Original · \$\{sourceDimensions\.width\}×\$\{sourceDimensions\.height\}/);
  assert.match(mapLab, /Preparing \$\{exportSizeLabel\} map/);
  assert.match(
    mapLab,
    /Applies to the live Studio preview \(up to 2K\), individual PNGs, all-map downloads, and material packs/,
  );
  assert.doesNotMatch(mapLab, /getCachedMapBlob\(evaluation,\s*channel\)/);
  assert.match(hosting, /"d1": null/);
  assert.match(hosting, /"r2": null/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
