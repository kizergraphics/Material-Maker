# Forge Material Studio

Forge is a local-first procedural PBR material authoring prototype for game-production workflows. The studio combines a typed node graph, a live Babylon.js preview, device-local project persistence, and portable `.mmpack` exports. The companion `/viewer` route opens those packages entirely in browser memory.

## Included in this slice

- Editable React Flow material graph with deterministic color, tileable noise, levels, blend, normal-from-height, roughness, metallic, and PBR output nodes.
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
