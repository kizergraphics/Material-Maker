"use client";

import {
  ArcRotateCamera,
  Color3,
  Color4,
  CubeTexture,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  ImageProcessingConfiguration,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { useEffect, useRef, useState } from "react";
import type { MaterialEvaluation } from "../core/material-evaluator";
import type {
  MapGenerationSettings,
  PreviewChannel,
  PreviewShape,
} from "../core/material-types";

type Props = {
  evaluation: MaterialEvaluation;
  shape: PreviewShape;
  channel: PreviewChannel;
  showGrid: boolean;
  autoRotate: boolean;
  mapSettings: MapGenerationSettings;
  className?: string;
};

function environmentFace(top: string, bottom: string, highlight?: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return "";
  const gradient = context.createLinearGradient(0, 0, 0, 96);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 96, 96);
  if (highlight) {
    const softbox = context.createRadialGradient(29, 22, 2, 29, 22, 43);
    softbox.addColorStop(0, highlight);
    softbox.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = softbox;
    context.fillRect(0, 0, 96, 96);
  }
  return canvas.toDataURL("image/png");
}

function createStudioEnvironment(scene: Scene) {
  const environment = CubeTexture.CreateFromImages([
    environmentFace("#d89d69", "#182331", "rgba(255,244,220,.92)"),
    environmentFace("#6884ad", "#121820", "rgba(190,218,255,.7)"),
    environmentFace("#d9e2e7", "#68727c", "rgba(255,255,255,.96)"),
    environmentFace("#20272d", "#070a0c"),
    environmentFace("#8093a8", "#151a20", "rgba(218,234,255,.55)"),
    environmentFace("#b88056", "#11171c", "rgba(255,225,190,.6)"),
  ], scene, false);
  environment.name = "procedural-studio-environment";
  environment.gammaSpace = true;
  environment.level = 0.74;
  scene.environmentTexture = environment;
  scene.environmentIntensity = 0.82;
}

function createPoleFreeSphere(scene: Scene) {
  const subdivisions = 48;
  const radius = 1.375;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const faces = [
    { center: [1, 0, 0], axisU: [0, 0, -1], axisV: [0, 1, 0] },
    { center: [-1, 0, 0], axisU: [0, 0, 1], axisV: [0, 1, 0] },
    { center: [0, 1, 0], axisU: [1, 0, 0], axisV: [0, 0, -1] },
    { center: [0, -1, 0], axisU: [1, 0, 0], axisV: [0, 0, 1] },
    { center: [0, 0, 1], axisU: [1, 0, 0], axisV: [0, 1, 0] },
    { center: [0, 0, -1], axisU: [-1, 0, 0], axisV: [0, 1, 0] },
  ] as const;

  for (const face of faces) {
    const vertexOffset = positions.length / 3;
    for (let row = 0; row <= subdivisions; row += 1) {
      const v = row / subdivisions;
      const faceV = v * 2 - 1;
      for (let column = 0; column <= subdivisions; column += 1) {
        const u = column / subdivisions;
        const faceU = u * 2 - 1;
        const x = face.center[0] + face.axisU[0] * faceU + face.axisV[0] * faceV;
        const y = face.center[1] + face.axisU[1] * faceU + face.axisV[1] * faceV;
        const z = face.center[2] + face.axisU[2] * faceU + face.axisV[2] * faceV;

        // Spherify a cube instead of collapsing latitude rows into pole vertices.
        // Each of the six faces retains a full, evenly distributed UV square.
        const sphereX = x * Math.sqrt(1 - (y * y) / 2 - (z * z) / 2 + (y * y * z * z) / 3);
        const sphereY = y * Math.sqrt(1 - (z * z) / 2 - (x * x) / 2 + (z * z * x * x) / 3);
        const sphereZ = z * Math.sqrt(1 - (x * x) / 2 - (y * y) / 2 + (x * x * y * y) / 3);
        const inverseLength = 1 / Math.hypot(sphereX, sphereY, sphereZ);
        const normalX = sphereX * inverseLength;
        const normalY = sphereY * inverseLength;
        const normalZ = sphereZ * inverseLength;

        positions.push(normalX * radius, normalY * radius, normalZ * radius);
        normals.push(normalX, normalY, normalZ);
        uvs.push(u, 1 - v);
      }
    }

    const rowWidth = subdivisions + 1;
    for (let row = 0; row < subdivisions; row += 1) {
      for (let column = 0; column < subdivisions; column += 1) {
        const topLeft = vertexOffset + row * rowWidth + column;
        const topRight = topLeft + 1;
        const bottomLeft = topLeft + rowWidth;
        const bottomRight = bottomLeft + 1;
        indices.push(topLeft, topRight, bottomLeft, topRight, bottomRight, bottomLeft);
      }
    }
  }

  const mesh = new Mesh("preview-mesh", scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.uvs = uvs;
  vertexData.indices = indices;
  vertexData.applyToMesh(mesh, true);
  return mesh;
}

function createPreviewMesh(scene: Scene, shape: PreviewShape) {
  if (shape === "cube") {
    const mesh = MeshBuilder.CreateBox(
      "preview-mesh",
      { size: 2.45, faceUV: undefined },
      scene,
    );
    mesh.rotation.y = Math.PI / 4;
    return mesh;
  }
  if (shape === "plane") {
    const mesh = MeshBuilder.CreateGround(
      "preview-mesh",
      { width: 3.25, height: 3.25, subdivisions: 64 },
      scene,
    );
    mesh.position.y = 0.1;
    return mesh;
  }
  return createPoleFreeSphere(scene);
}

function createTexture(
  scene: Scene,
  name: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const texture = new DynamicTexture(
    name,
    { width, height },
    scene,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  const context = texture.getContext();
  context.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.update(false);
  return texture;
}

export function MaterialPreview({
  evaluation,
  shape,
  channel,
  showGrid,
  autoRotate,
  mapSettings,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const groundRef = useRef<Mesh | null>(null);
  const shadowRef = useRef<ShadowGenerator | null>(null);
  const materialRef = useRef<PBRMaterial | StandardMaterial | null>(null);
  const autoRotateRef = useRef(autoRotate);
  const [fps, setFps] = useState(60);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas, true, {
      preserveDrawingBuffer: false,
      stencil: true,
      antialias: true,
      powerPreference: "high-performance",
    }, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.025, 0.029, 0.033, 1);
    scene.ambientColor = new Color3(0.035, 0.042, 0.05);
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 1.08;
    scene.imageProcessingConfiguration.contrast = 1.16;
    createStudioEnvironment(scene);

    const camera = new ArcRotateCamera(
      "preview-camera",
      -Math.PI / 2.4,
      Math.PI / 2.25,
      5.4,
      new Vector3(0, 0.05, 0),
      scene,
    );
    camera.lowerRadiusLimit = 3.3;
    camera.upperRadiusLimit = 8;
    camera.wheelPrecision = 50;
    camera.panningSensibility = 800;
    camera.inertia = 0.72;
    camera.minZ = 0.05;
    camera.wheelDeltaPercentage = 0.01;
    camera.attachControl(canvas, true);

    const pipeline = new DefaultRenderingPipeline(
      "preview-rendering-pipeline",
      true,
      scene,
      [camera],
    );
    pipeline.samples = 4;
    pipeline.fxaaEnabled = true;
    pipeline.bloomEnabled = true;
    pipeline.bloomThreshold = 0.92;
    pipeline.bloomWeight = 0.1;
    pipeline.bloomKernel = 40;

    const keyLight = new DirectionalLight(
      "key-light",
      new Vector3(-0.6, -1, 0.55),
      scene,
    );
    keyLight.position = new Vector3(4, 6, -4);
    keyLight.intensity = 4.1;
    keyLight.diffuse = new Color3(1, 0.84, 0.68);
    keyLight.shadowMinZ = 0.1;
    keyLight.shadowMaxZ = 20;

    const shadows = new ShadowGenerator(1024, keyLight);
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 24;
    shadows.bias = 0.0007;
    shadows.normalBias = 0.025;
    shadows.setDarkness(0.34);
    shadowRef.current = shadows;

    const fill = new HemisphericLight(
      "fill-light",
      new Vector3(0.25, 1, -0.25),
      scene,
    );
    fill.intensity = 1.15;
    fill.diffuse = new Color3(0.58, 0.72, 1);
    fill.groundColor = new Color3(0.035, 0.04, 0.052);

    const rim = new DirectionalLight(
      "rim-light",
      new Vector3(0.75, -0.2, -0.8),
      scene,
    );
    rim.intensity = 2.2;
    rim.diffuse = new Color3(0.35, 0.55, 1);

    const ground = MeshBuilder.CreateGround(
      "studio-floor",
      { width: 12, height: 12 },
      scene,
    );
    ground.position.y = -1.58;
    const groundMaterial = new StandardMaterial("floor-material", scene);
    groundMaterial.diffuseColor = new Color3(0.035, 0.041, 0.047);
    groundMaterial.specularColor = new Color3(0.08, 0.09, 0.1);
    ground.material = groundMaterial;
    ground.receiveShadows = true;
    groundRef.current = ground;

    engineRef.current = engine;
    sceneRef.current = scene;

    scene.onBeforeRenderObservable.add(() => {
      if (meshRef.current && autoRotateRef.current) {
        meshRef.current.rotation.y += engine.getDeltaTime() * 0.00012;
      }
    });

    engine.runRenderLoop(() => scene.render());
    const resizeObserver = new ResizeObserver(() => engine.resize());
    resizeObserver.observe(canvas);
    const fpsTimer = window.setInterval(
      () => setFps(Math.round(engine.getFps() || 0)),
      1000,
    );

    return () => {
      window.clearInterval(fpsTimer);
      resizeObserver.disconnect();
      scene.dispose();
      engine.dispose();
      sceneRef.current = null;
      engineRef.current = null;
      shadowRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (meshRef.current) shadowRef.current?.removeShadowCaster(meshRef.current);
    meshRef.current?.dispose(false, true);
    const mesh = createPreviewMesh(scene, shape);
    mesh.material = materialRef.current;
    shadowRef.current?.addShadowCaster(mesh, true);
    meshRef.current = mesh;
  }, [shape]);

  useEffect(() => {
    if (groundRef.current) groundRef.current.isVisible = showGrid;
  }, [showGrid]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    materialRef.current?.dispose(true, true);

    const albedo = createTexture(
      scene,
      "generated-albedo",
      evaluation.albedo,
      evaluation.width,
      evaluation.height,
    );
    const normal = createTexture(
      scene,
      "generated-normal",
      evaluation.normal,
      evaluation.width,
      evaluation.height,
    );

    let material: PBRMaterial | StandardMaterial;
    if (channel === "normal") {
      const diagnostic = new StandardMaterial("normal-diagnostic", scene);
      diagnostic.disableLighting = true;
      diagnostic.diffuseColor = Color3.Black();
      diagnostic.specularColor = Color3.Black();
      diagnostic.emissiveTexture = normal;
      diagnostic.emissiveColor = Color3.White();
      material = diagnostic;
      albedo.dispose();
    } else if (
      channel === "height" ||
      channel === "roughness" ||
      channel === "metallic" ||
      channel === "ao"
    ) {
      const pixels = channel === "height"
        ? evaluation.heightMap
        : channel === "roughness"
          ? evaluation.roughness
          : channel === "metallic"
            ? evaluation.metallic
            : evaluation.ambientOcclusion;
      const diagnosticTexture = createTexture(
        scene,
        `${channel}-diagnostic`,
        pixels,
        evaluation.width,
        evaluation.height,
      );
      const diagnostic = new StandardMaterial(`${channel}-diagnostic`, scene);
      diagnostic.disableLighting = true;
      diagnostic.diffuseColor = Color3.Black();
      diagnostic.specularColor = Color3.Black();
      diagnostic.emissiveTexture = diagnosticTexture;
      diagnostic.emissiveColor = Color3.White();
      material = diagnostic;
      albedo.dispose();
      normal.dispose();
    } else {
      const pbr = new PBRMaterial("generated-pbr", scene);
      pbr.albedoTexture = channel !== "material" || mapSettings.baseColor.enabled ? albedo : null;
      if (channel === "material" && !mapSettings.baseColor.enabled) {
        pbr.albedoColor = new Color3(0.5, 0.5, 0.5);
      }
      pbr.bumpTexture = channel === "material" && mapSettings.normal.enabled ? normal : null;
      if (channel === "material") {
        const packed = new Uint8ClampedArray(evaluation.width * evaluation.height * 4);
        for (let offset = 0; offset < packed.length; offset += 4) {
          packed[offset] = mapSettings.ao.enabled ? evaluation.ambientOcclusion[offset] : 255;
          packed[offset + 1] = mapSettings.roughness.enabled ? evaluation.roughness[offset] : 153;
          packed[offset + 2] = mapSettings.metallic.enabled ? evaluation.metallic[offset] : 0;
          packed[offset + 3] = 255;
        }
        pbr.metallicTexture = createTexture(
          scene,
          "generated-orm",
          packed,
          evaluation.width,
          evaluation.height,
        );
        pbr.useAmbientOcclusionFromMetallicTextureRed = true;
        pbr.useRoughnessFromMetallicTextureGreen = true;
        pbr.useMetallnessFromMetallicTextureBlue = true;
        pbr.metallic = 1;
        pbr.roughness = 1;
        if (!mapSettings.baseColor.enabled) albedo.dispose();
        if (!mapSettings.normal.enabled) normal.dispose();
      } else {
        pbr.metallic = 0;
        pbr.roughness = 0.76;
      }
      pbr.environmentIntensity = 0.9;
      pbr.directIntensity = 1.08;
      pbr.specularIntensity = 1.12;
      pbr.metallicF0Factor = 0.88;
      pbr.usePhysicalLightFalloff = true;
      pbr.enableSpecularAntiAliasing = true;
      pbr.clearCoat.isEnabled = channel === "material";
      pbr.clearCoat.intensity = 0.16;
      pbr.clearCoat.roughness = 0.42;
      material = pbr;
      if (channel !== "material") normal.dispose();
    }

    materialRef.current = material;
    if (meshRef.current) meshRef.current.material = material;
  }, [evaluation, channel, mapSettings]);

  return (
    <div className={`material-preview ${className ?? ""}`}>
      <canvas
        ref={canvasRef}
        className="material-preview__canvas"
        aria-label="Interactive three-dimensional material preview"
      />
      <div className="material-preview__badges" aria-hidden="true">
        <span>256 PREVIEW</span>
        <span>{fps} FPS</span>
        {shape === "sphere" ? <span>POLE-FREE UV</span> : null}
        {channel !== "material" && !mapSettings[channel].enabled ? <span>MAP OFF</span> : null}
      </div>
      <div className="material-preview__hint">Drag to orbit · Scroll to zoom</div>
    </div>
  );
}
