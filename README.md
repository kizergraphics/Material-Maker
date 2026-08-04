# Forge Material Studio

<p align="center">
  <img src="public/og.png" alt="Forge Material Studio — procedural PBR, local-first" width="100%">
</p>

Forge Material Studio is a local-first procedural PBR material authoring tool. Build materials with a typed node graph, generate a six-map PBR set from an image, inspect the result in a live Babylon.js preview, and export portable `.mmpack` packages—all without uploading source images or projects.

The application runs on your own computer. It has no account system, telemetry, material upload service, D1 database, or R2 bucket.

## Download and try it

The Windows release includes `Material Maker.exe` and the project files it needs. Download the latest `Forge-Material-Studio-*-Windows-x64.zip` from [GitHub Releases](https://github.com/kizergraphics/Material-Maker/releases/latest), extract the entire folder, and keep the executable beside the project files.

The launcher requires [Node.js 22.13 or newer](https://nodejs.org/), the [.NET 8 Desktop Runtime](https://dotnet.microsoft.com/download/dotnet/8.0), and Microsoft Edge or Google Chrome. On first launch it installs the locked npm dependencies and creates a local production build.

> [!IMPORTANT]
> `Material Maker.exe` is an unsigned, open-source launcher built directly from [`launcher/Program.cs`](launcher/Program.cs). Windows may display a SmartScreen warning because the file has no commercial code-signing certificate. The launcher contains no known malicious behavior: it starts Forge only on your computer, does not upload projects or textures, installs no background service, and stops its local processes when its window closes. Verify the accompanying `SHA256SUMS.txt` checksum before running it.

### Run from source

1. Select **Code → Download ZIP** on GitHub and extract the folder.
2. Install Node.js 22.13 or newer.
3. Open a terminal in the extracted folder and run:

```bash
npm install
npm run dev
```

Open `http://localhost:3000` for the studio or `http://localhost:3000/viewer` for the package viewer. Everything remains on the local device.

## What you can do

- Build tileable materials with cloud noise, checker, Voronoi, gradient, brick, color-ramp, threshold, transform, math, blend, masked-blend, channel, and normal nodes.
- Turn a PNG, JPEG, or WebP albedo into editable base-color, height, normal, roughness, metallic, and ambient-occlusion maps.
- Preview materials on a sphere, cube, plane, or production-style model with beauty and individual-channel inspection.
- Work at 512, 1024, or 2048 pixels while preserving the source aspect ratio.
- Save projects in IndexedDB with recovery, generated-map caching, undo/redo, and keyboard save shortcuts.
- Export individual PNG maps or a validated `.mmpack` containing baked maps, the source graph, manifest, and export report.
- Open `.mmpack` files in the standalone viewer entirely in browser memory.

## Screenshots

### Image-to-material Map Lab

![Six generated PBR texture maps and a live material preview](docs/images/map-lab.png)

### Procedural node graph

![Generated maps connected to the PBR material output in the node editor](docs/images/node-graph.png)

### Local package viewer

![A marble material displayed in the local package viewer](docs/images/material-viewer.png)

## Generate maps from an image

1. Choose **Add albedo texture** in the Library, or select **Map Lab** in the project toolbar.
2. Open a PNG, JPEG, or WebP file. Forge generates an editable six-map material set in the browser.
3. Select a map card or preview channel to tune it independently. Metallic defaults to a dielectric value because metal cannot be identified reliably from color alone.
4. Choose **Send maps to graph** to continue procedurally, download individual PNGs, or select **Bake & export** to create an `.mmpack`.

## Windows launcher

The local Windows launcher installs dependencies, creates an optimized build when project files change, and opens Forge in a dedicated browser window. Closing that window also stops the local service.

`Material Maker.exe` is intentionally excluded from source control and distributed as a versioned GitHub Release asset instead. To build it locally, install the .NET 8 SDK and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\launcher\build-launcher.ps1
```

Keep the generated `Material Maker.exe` in the project root.

## Development and validation

```bash
npm install
npm run lint
npm test
npx tsc --noEmit
```

## License

Forge Material Studio is free and open-source software released under the [MIT License](LICENSE). You may use, copy, modify, and distribute it, including commercially, provided the copyright and license notice remain with the software.
