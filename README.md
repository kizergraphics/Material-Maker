# Forge Material Studio

Forge is a local-first procedural PBR material authoring prototype for game-production workflows. The studio combines a typed node graph, a live Babylon.js preview, device-local project persistence, and portable `.mmpack` exports. The companion `/viewer` route opens those packages entirely in browser memory.

## Included in this slice

- Editable React Flow material graph with deterministic color, tileable noise, levels, blend, normal-from-height, roughness, metallic, and PBR output nodes.
- Local albedo import for PNG, JPEG, and WebP files with non-destructive generation of height, normal, roughness, metallic, and ambient-occlusion maps.
- A six-map workbench with per-map controls, individual PNG downloads, source-aspect preservation, and 512/1024/2048 export sizes.
- Live sphere, cube, and plane preview with beauty and individual-channel inspection.
- IndexedDB autosave, project recovery, undo/redo, and keyboard save shortcuts.
- Validated `.mmpack` import/export with baked PNG maps, source graph, manifest, and export report.
- Standalone no-upload viewer with drag-and-drop package loading.
- Responsive dark workstation interface and private social preview metadata.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the studio and `http://localhost:3000/viewer` for the package viewer.

## Validation

```bash
npm test
npx tsc --noEmit
```

Projects are saved only on the current device. The hosted application contains no D1 database, R2 bucket, account system, telemetry, or material upload service.

## Generate maps from an albedo

1. Choose **Add albedo texture** in the Library, or select **Map Lab** in the project toolbar.
2. Open a PNG, JPEG, or WebP file. Forge generates an editable albedo, height, normal, roughness, metallic, and ambient-occlusion set in the browser.
3. Select any map card or preview channel to expose its controls. Metallic defaults to a dielectric value because metal cannot be identified reliably from color alone.
4. Download the selected map as PNG, or use **Bake & export** to package the complete map set and source image in a `.mmpack` file.
