"use client";

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene,
  StandardMaterial,
  Texture,
  Vector3,
} from "@babylonjs/core";
import { useEffect, useRef, useState } from "react";
import type { MaterialEvaluation } from "../core/material-evaluator";
import type { PreviewChannel, PreviewShape } from "../core/material-types";

type Props = {
  evaluation: MaterialEvaluation;
  shape: PreviewShape;
  channel: PreviewChannel;
  showGrid: boolean;
  autoRotate: boolean;
  className?: string;
};

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
  return MeshBuilder.CreateSphere(
    "preview-mesh",
    { diameter: 2.75, segments: 96 },
    scene,
  );
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
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const groundRef = useRef<Mesh | null>(null);
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
      preserveDrawingBuffer: true,
      stencil: true,
      antialias: true,
    });
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.025, 0.029, 0.033, 1);
    scene.ambientColor = new Color3(0.06, 0.07, 0.08);

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
    camera.attachControl(canvas, true);

    const keyLight = new DirectionalLight(
      "key-light",
      new Vector3(-0.6, -1, 0.55),
      scene,
    );
    keyLight.position = new Vector3(4, 6, -4);
    keyLight.intensity = 4.1;
    keyLight.diffuse = new Color3(1, 0.84, 0.68);

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
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    meshRef.current?.dispose(false, true);
    const mesh = createPreviewMesh(scene, shape);
    mesh.material = materialRef.current;
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
      diagnostic.emissiveTexture = diagnosticTexture;
      diagnostic.emissiveColor = Color3.White();
      material = diagnostic;
      albedo.dispose();
      normal.dispose();
    } else {
      const pbr = new PBRMaterial("generated-pbr", scene);
      pbr.albedoTexture = albedo;
      pbr.bumpTexture = channel === "material" ? normal : null;
      if (channel === "material") {
        const packed = new Uint8ClampedArray(evaluation.width * evaluation.height * 4);
        for (let offset = 0; offset < packed.length; offset += 4) {
          packed[offset] = evaluation.ambientOcclusion[offset];
          packed[offset + 1] = evaluation.roughness[offset];
          packed[offset + 2] = evaluation.metallic[offset];
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
      } else {
        pbr.metallic = 0;
        pbr.roughness = 0.76;
      }
      pbr.environmentIntensity = 0.9;
      pbr.metallicF0Factor = 0.88;
      pbr.clearCoat.isEnabled = channel === "material";
      pbr.clearCoat.intensity = 0.16;
      pbr.clearCoat.roughness = 0.42;
      material = pbr;
      if (channel !== "material") normal.dispose();
    }

    materialRef.current = material;
    if (meshRef.current) meshRef.current.material = material;
  }, [evaluation, channel]);

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
      </div>
      <div className="material-preview__hint">Drag to orbit · Scroll to zoom</div>
    </div>
  );
}
