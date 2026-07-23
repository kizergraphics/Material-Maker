import JSZip from "jszip";
import { z } from "zod";
import { canvasToBlob, evaluateMaterial, pixelsToCanvas } from "./material-evaluator";
import {
  DEFAULT_MAP_SETTINGS,
  PROJECT_SCHEMA_VERSION,
  type MaterialPackManifest,
  type MaterialProject,
} from "./material-types";
import { evaluateSourceTexture } from "./texture-generator";

const DB_NAME = "forge-material-studio";
const DB_VERSION = 1;
const PROJECT_STORE = "projects";

const finiteNumber = z.number().finite();
const mapSettingsSchema = z.object({
  baseColor: z.object({
    brightness: finiteNumber,
    contrast: finiteNumber,
    saturation: finiteNumber,
    hue: finiteNumber,
  }).partial().optional(),
  height: z.object({
    contrast: finiteNumber,
    bias: finiteNumber,
    blur: finiteNumber,
    invert: z.boolean(),
  }).partial().optional(),
  normal: z.object({
    strength: finiteNumber,
    detail: finiteNumber,
    invertY: z.boolean(),
  }).partial().optional(),
  roughness: z.object({
    base: finiteNumber,
    variation: finiteNumber,
    invert: z.boolean(),
  }).partial().optional(),
  metallic: z.object({
    base: finiteNumber,
    variation: finiteNumber,
    invert: z.boolean(),
  }).partial().optional(),
  ao: z.object({
    strength: finiteNumber,
    radius: finiteNumber,
    bias: finiteNumber,
  }).partial().optional(),
}).partial();

const projectSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(PROJECT_SCHEMA_VERSION)]),
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  createdAt: z.string(),
  updatedAt: z.string(),
  nodes: z.array(z.any()).max(1000),
  edges: z.array(z.any()).max(3000),
  preview: z.object({
    shape: z.enum(["sphere", "cube", "plane"]),
    channel: z.enum([
      "material",
      "baseColor",
      "height",
      "normal",
      "roughness",
      "metallic",
      "ao",
    ]),
    showGrid: z.boolean(),
    autoRotate: z.boolean(),
    tiled: z.boolean(),
  }),
  sourceTexture: z
    .object({
      name: z.string().max(240),
      mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      dataUrl: z.string(),
      width: z.number().int().positive().max(16384),
      height: z.number().int().positive().max(16384),
      sizeBytes: z.number().nonnegative(),
    })
    .nullable()
    .optional(),
  mapSettings: mapSettingsSchema.optional(),
  exportResolution: z.union([z.literal(512), z.literal(1024), z.literal(2048)]).optional(),
});

function normalizeProject(value: z.infer<typeof projectSchema>): MaterialProject {
  const supplied = value.mapSettings as Partial<typeof DEFAULT_MAP_SETTINGS> | undefined;
  return {
    ...value,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    sourceTexture: value.sourceTexture ?? null,
    mapSettings: {
      baseColor: { ...DEFAULT_MAP_SETTINGS.baseColor, ...supplied?.baseColor },
      height: { ...DEFAULT_MAP_SETTINGS.height, ...supplied?.height },
      normal: { ...DEFAULT_MAP_SETTINGS.normal, ...supplied?.normal },
      roughness: { ...DEFAULT_MAP_SETTINGS.roughness, ...supplied?.roughness },
      metallic: { ...DEFAULT_MAP_SETTINGS.metallic, ...supplied?.metallic },
      ao: { ...DEFAULT_MAP_SETTINGS.ao, ...supplied?.ao },
    },
    exportResolution: value.exportResolution ?? 1024,
  } as MaterialProject;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        const store = database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage is unavailable."));
  });
}

export async function saveProjectLocal(project: MaterialProject) {
  const database = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).put(project);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("The project could not be saved locally."));
    };
  });
}

export async function loadLatestProject() {
  const database = await openDatabase();
  return new Promise<MaterialProject | null>((resolve, reject) => {
    const request = database
      .transaction(PROJECT_STORE, "readonly")
      .objectStore(PROJECT_STORE)
      .getAll();
    request.onsuccess = () => {
      database.close();
      const projects = request.result
        .map((value) => projectSchema.safeParse(value))
        .filter((result) => result.success)
        .map((result) => normalizeProject(result.data))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(projects[0] ?? null);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Saved projects could not be read."));
    };
  });
}

const sanitizeName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled-material";

async function addTexture(
  zip: JSZip,
  path: string,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const canvas = pixelsToCanvas(pixels, width, height);
  zip.file(path, await canvasToBlob(canvas));
}

export async function createMaterialPack(project: MaterialProject) {
  const safeProject: MaterialProject = {
    ...project,
    updatedAt: new Date().toISOString(),
  };
  const manifest: MaterialPackManifest = {
    format: "forge-material-pack",
    formatVersion: 1,
    createdAt: safeProject.updatedAt,
    generator: "Forge Material Studio",
    projectName: safeProject.name,
    projectFile: "material.json",
    privacy: "local-only",
  };
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("material.json", JSON.stringify(safeProject, null, 2));

  const resolution = safeProject.exportResolution;
  const evaluation = safeProject.sourceTexture
    ? await evaluateSourceTexture(safeProject.sourceTexture, safeProject.mapSettings, resolution)
    : evaluateMaterial(safeProject, resolution);
  await Promise.all([
    addTexture(zip, "textures/base-color.png", evaluation.albedo, evaluation.width, evaluation.height),
    addTexture(zip, "textures/height.png", evaluation.heightMap, evaluation.width, evaluation.height),
    addTexture(zip, "textures/normal.png", evaluation.normal, evaluation.width, evaluation.height),
    addTexture(zip, "textures/roughness.png", evaluation.roughness, evaluation.width, evaluation.height),
    addTexture(zip, "textures/metallic.png", evaluation.metallic, evaluation.width, evaluation.height),
    addTexture(zip, "textures/ambient-occlusion.png", evaluation.ambientOcclusion, evaluation.width, evaluation.height),
  ]);
  if (safeProject.sourceTexture) {
    const extension = safeProject.sourceTexture.mimeType === "image/jpeg"
      ? "jpg"
      : safeProject.sourceTexture.mimeType.split("/")[1];
    zip.file(
      `source/albedo-original.${extension}`,
      await (await fetch(safeProject.sourceTexture.dataUrl)).blob(),
    );
  }
  zip.file(
    "export-report.json",
    JSON.stringify(
      {
        generatedAt: safeProject.updatedAt,
        resolution: { width: evaluation.width, height: evaluation.height },
        colorSpace: {
          baseColor: "sRGB",
          height: "linear",
          normal: "linear",
          roughness: "linear",
          metallic: "linear",
          ambientOcclusion: "linear",
        },
        warnings: evaluation.warnings,
      },
      null,
      2,
    ),
  );

  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  return {
    blob,
    filename: `${sanitizeName(safeProject.name)}.mmpack`,
  };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importMaterialPack(file: File) {
  if (file.size > 250 * 1024 * 1024) {
    throw new Error("This package is larger than the 250 MB safety limit.");
  }
  const zip = await JSZip.loadAsync(file, { checkCRC32: true });
  const manifestEntry = zip.file("manifest.json");
  const projectEntry = zip.file("material.json");
  if (!manifestEntry || !projectEntry) {
    throw new Error("This file is missing the Forge material manifest or project.");
  }
  const manifest = JSON.parse(await manifestEntry.async("string")) as unknown;
  const manifestResult = z
    .object({
      format: z.literal("forge-material-pack"),
      formatVersion: z.literal(1),
    })
    .safeParse(manifest);
  if (!manifestResult.success) {
    throw new Error("This material package version is not supported.");
  }
  const rawProject = JSON.parse(await projectEntry.async("string")) as unknown;
  const projectResult = projectSchema.safeParse(rawProject);
  if (!projectResult.success) {
    throw new Error("The material graph is invalid or uses an unsupported schema.");
  }
  return normalizeProject(projectResult.data);
}
