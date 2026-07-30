import JSZip from "jszip";
import { z } from "zod";
import {
  MATERIAL_NODE_CATEGORIES,
  MATERIAL_NODE_KINDS,
  MATERIAL_TEXTURE_CHANNELS,
} from "./material-node-registry";
import {
  canvasToBlob,
  evaluateMaterial,
  pixelsToCanvas,
  type MaterialEvaluation,
} from "./material-evaluator";
import {
  getPersistentGeneratedMaps,
  storePersistentGeneratedMaps,
} from "./generated-map-cache";
import {
  openMaterialDatabase,
  PROJECT_STORE,
} from "./local-database";
import { migrateMaterialGraph } from "./material-project-migrations";
import {
  DEFAULT_MAP_SETTINGS,
  PROJECT_SCHEMA_VERSION,
  type MaterialPackManifest,
  type MaterialProject,
} from "./material-types";
import {
  evaluateSourceTexture,
  pixelsForChannel,
} from "./texture-generator";
import type { TextureMapChannel } from "./material-types";

const MAX_SOURCE_BYTES = 48 * 1024 * 1024;
const MAX_SOURCE_DATA_URL_LENGTH = Math.ceil((MAX_SOURCE_BYTES * 4) / 3) + 128;
const MAX_SOURCE_PIXELS = 64 * 1024 * 1024;
const MAX_PACK_BYTES = 250 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 64;
const MAX_ZIP_ENTRY_BYTES = 96 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 384 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_PROJECT_BYTES = 96 * 1024 * 1024;

function isLocalImageDataUrl(value: string, mimeType?: string) {
  const allowedPrefix = mimeType
    ? `data:${mimeType};base64,`
    : /^data:image\/(?:png|jpeg|webp);base64,/i;
  return typeof allowedPrefix === "string"
    ? value.startsWith(allowedPrefix)
    : allowedPrefix.test(value.slice(0, 40));
}

const finiteNumber = z.number().finite();
const mapSettingsSchema = z.object({
  baseColor: z.object({
    enabled: z.boolean(),
    brightness: finiteNumber,
    contrast: finiteNumber,
    saturation: finiteNumber,
    hue: finiteNumber,
  }).partial().optional(),
  height: z.object({
    enabled: z.boolean(),
    contrast: finiteNumber,
    bias: finiteNumber,
    blur: finiteNumber,
    invert: z.boolean(),
  }).partial().optional(),
  normal: z.object({
    enabled: z.boolean(),
    strength: finiteNumber,
    detail: finiteNumber,
    invertY: z.boolean(),
  }).partial().optional(),
  roughness: z.object({
    enabled: z.boolean(),
    base: finiteNumber,
    variation: finiteNumber,
    invert: z.boolean(),
  }).partial().optional(),
  metallic: z.object({
    enabled: z.boolean(),
    base: finiteNumber,
    variation: finiteNumber,
    invert: z.boolean(),
  }).partial().optional(),
  ao: z.object({
    enabled: z.boolean(),
    strength: finiteNumber,
    radius: finiteNumber,
    bias: finiteNumber,
  }).partial().optional(),
}).partial();

const nodeValuesSchema = z
  .record(z.string().max(64), z.union([finiteNumber, z.boolean(), z.string().max(160_000)]))
  .superRefine((values, context) => {
    const thumbnail = values.thumbnail;
    if (typeof thumbnail === "string" && !isLocalImageDataUrl(thumbnail)) {
      context.addIssue({
        code: "custom",
        path: ["thumbnail"],
        message: "Map thumbnails must be embedded image data.",
      });
    }
  });

const graphNodeSchema = z.object({
  id: z.string().min(1).max(128),
  type: z.literal("materialNode").optional(),
  position: z.object({ x: finiteNumber, y: finiteNumber }),
  data: z.object({
    label: z.string().min(1).max(160),
    kind: z.enum(MATERIAL_NODE_KINDS),
    category: z.enum(MATERIAL_NODE_CATEGORIES),
    version: z.number().int().positive().max(1000).optional(),
    values: nodeValuesSchema,
  }),
});

const graphEdgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1).max(128),
  target: z.string().min(1).max(128),
  sourceHandle: z.string().max(64).nullable().optional(),
  targetHandle: z.string().max(64).nullable().optional(),
});

const sourceTextureSchema = z.object({
  name: z.string().max(240),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  dataUrl: z.string().max(MAX_SOURCE_DATA_URL_LENGTH),
  width: z.number().int().positive().max(16384),
  height: z.number().int().positive().max(16384),
  sizeBytes: z.number().int().nonnegative().max(MAX_SOURCE_BYTES),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).superRefine((source, context) => {
  if (!isLocalImageDataUrl(source.dataUrl, source.mimeType)) {
    context.addIssue({
      code: "custom",
      path: ["dataUrl"],
      message: "Source images must be embedded in the material package.",
    });
  }
  if (source.width * source.height > MAX_SOURCE_PIXELS) {
    context.addIssue({
      code: "custom",
      path: ["width"],
      message: "Source image dimensions exceed the safe pixel limit.",
    });
  }
});

const projectSchema = z.object({
  schemaVersion: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(PROJECT_SCHEMA_VERSION),
  ]),
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(160),
  createdAt: z.string(),
  updatedAt: z.string(),
  nodes: z.array(graphNodeSchema).max(1000),
  edges: z.array(graphEdgeSchema).max(3000),
  preview: z.object({
    shape: z.enum(["sphere", "cube", "plane"]),
    channel: z.union([
      z.literal("material"),
      z.enum(MATERIAL_TEXTURE_CHANNELS),
    ]),
    showGrid: z.boolean(),
    autoRotate: z.boolean(),
    tiled: z.boolean(),
  }),
  sourceTexture: sourceTextureSchema.nullable().optional(),
  mapSettings: mapSettingsSchema.optional(),
  exportResolution: z.union([z.literal(512), z.literal(1024), z.literal(2048)]).optional(),
});

function normalizeProject(
  value: z.infer<typeof projectSchema>,
  trustSourceFingerprint = false,
): MaterialProject {
  const supplied = value.mapSettings as Partial<typeof DEFAULT_MAP_SETTINGS> | undefined;
  const migratedGraph = migrateMaterialGraph(value.nodes, value.edges);
  const sourceTexture = value.sourceTexture
    ? {
        ...value.sourceTexture,
        fingerprint: trustSourceFingerprint
          ? value.sourceTexture.fingerprint
          : undefined,
      }
    : null;
  return {
    ...value,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    nodes: migratedGraph.nodes,
    edges: migratedGraph.edges,
    sourceTexture,
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

export function prepareProjectForStorage(project: MaterialProject) {
  return normalizeProject(projectSchema.parse(project), true);
}

export async function saveProjectLocal(project: MaterialProject) {
  const storedProject = prepareProjectForStorage(project);
  const database = await openMaterialDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).put(storedProject);
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
  const projects = await loadProjectsLocal();
  return projects[0] ?? null;
}

export async function loadProjectsLocal() {
  const database = await openMaterialDatabase();
  return new Promise<MaterialProject[]>((resolve, reject) => {
    const request = database
      .transaction(PROJECT_STORE, "readonly")
      .objectStore(PROJECT_STORE)
      .getAll();
    request.onsuccess = () => {
      database.close();
      const projects = request.result
        .map((value) => projectSchema.safeParse(value))
        .filter((result) => result.success)
        .flatMap((result) => {
          try {
            return [normalizeProject(result.data, true)];
          } catch {
            return [];
          }
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      resolve(projects);
    };
    request.onerror = () => {
      database.close();
      reject(request.error ?? new Error("Saved projects could not be read."));
    };
  });
}

export async function deleteProjectLocal(projectId: string) {
  const database = await openMaterialDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("The material could not be deleted."));
    };
  });
}

const sanitizeName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled-material";

const evaluationBlobCache = new WeakMap<
  MaterialEvaluation,
  Map<TextureMapChannel, Promise<Blob>>
>();

type ProjectEvaluationCache = {
  project: MaterialProject;
  evaluation: Promise<MaterialEvaluation>;
};

type MaterialPackCache = {
  project: MaterialProject;
  pack: Promise<{ blob: Blob; filename: string }>;
};

let projectEvaluationCache: ProjectEvaluationCache | null = null;
let materialPackCache: MaterialPackCache | null = null;

function sameEvaluationInputs(
  cached: MaterialProject,
  project: MaterialProject,
) {
  return (
    cached.nodes === project.nodes &&
    cached.edges === project.edges &&
    cached.sourceTexture === project.sourceTexture &&
    cached.mapSettings === project.mapSettings &&
    cached.exportResolution === project.exportResolution
  );
}

function samePackInputs(
  cached: MaterialProject,
  project: MaterialProject,
) {
  return (
    cached.id === project.id &&
    cached.name === project.name &&
    cached.createdAt === project.createdAt &&
    cached.preview === project.preview &&
    sameEvaluationInputs(cached, project)
  );
}

function evaluateGeneratedTextureGraph(
  project: MaterialProject,
  generated: MaterialEvaluation,
) {
  return project.nodes.some((node) => node.data.kind === "textureMap")
    ? evaluateMaterial(project, project.exportResolution, generated)
    : generated;
}

function getProjectEvaluationCache(project: MaterialProject) {
  if (
    projectEvaluationCache &&
    sameEvaluationInputs(projectEvaluationCache.project, project)
  ) {
    return projectEvaluationCache;
  }

  const evaluation = project.sourceTexture
    ? getPersistentGeneratedMaps(
        project.sourceTexture,
        project.mapSettings,
        project.exportResolution,
      ).then(async (cached) => {
        const generated =
          cached ??
          (await evaluateSourceTexture(
            project.sourceTexture!,
            project.mapSettings,
            project.exportResolution,
          ));
        if (!cached) {
          void storePersistentGeneratedMaps(
            project.sourceTexture!,
            project.mapSettings,
            project.exportResolution,
            generated,
          );
        }
        return evaluateGeneratedTextureGraph(project, generated);
      })
    : Promise.resolve(evaluateMaterial(project, project.exportResolution));
  const cache = {
    project,
    evaluation: evaluation.catch((error) => {
      if (projectEvaluationCache === cache) projectEvaluationCache = null;
      throw error;
    }),
  };
  projectEvaluationCache = cache;
  return cache;
}

export function getCachedMapBlob(
  evaluation: MaterialEvaluation,
  channel: TextureMapChannel,
) {
  let channelCache = evaluationBlobCache.get(evaluation);
  if (!channelCache) {
    channelCache = new Map();
    evaluationBlobCache.set(evaluation, channelCache);
  }
  const cached = channelCache.get(channel);
  if (cached) return cached;

  const blob = canvasToBlob(
    pixelsToCanvas(
      pixelsForChannel(evaluation, channel),
      evaluation.width,
      evaluation.height,
    ),
  ).catch((error) => {
    channelCache.delete(channel);
    throw error;
  });
  channelCache.set(channel, blob);
  return blob;
}

export async function getCachedProjectMapBlobs(
  project: MaterialProject,
  channels: TextureMapChannel[],
) {
  const cache = getProjectEvaluationCache(project);
  const evaluation = await cache.evaluation;
  const blobs = await Promise.all(
    channels.map(async (channel) => ({
      channel,
      blob: await getCachedMapBlob(evaluation, channel),
    })),
  );
  return { evaluation, blobs };
}

async function buildMaterialPack(
  project: MaterialProject,
  evaluationCache: ProjectEvaluationCache,
) {
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

  const evaluation = await evaluationCache.evaluation;
  const textures = [
    ["baseColor", "textures/base-color.png"],
    ["height", "textures/height.png"],
    ["normal", "textures/normal.png"],
    ["roughness", "textures/roughness.png"],
    ["metallic", "textures/metallic.png"],
    ["ao", "textures/ambient-occlusion.png"],
  ] as const;
  await Promise.all(
    textures
      .filter(([channel]) => safeProject.mapSettings[channel].enabled)
      .map(async ([channel, path]) => {
        zip.file(path, await getCachedMapBlob(evaluation, channel));
      }),
  );
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
        enabledMaps: Object.fromEntries(
          textures.map(([channel]) => [channel, safeProject.mapSettings[channel].enabled]),
        ),
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

export function createMaterialPack(project: MaterialProject) {
  if (
    materialPackCache &&
    samePackInputs(materialPackCache.project, project)
  ) {
    return materialPackCache.pack;
  }

  const cache = {
    project,
    pack: buildMaterialPack(
      project,
      getProjectEvaluationCache(project),
    ).catch((error) => {
      if (materialPackCache === cache) materialPackCache = null;
      throw error;
    }),
  };
  materialPackCache = cache;
  return cache.pack;
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
  if (file.size > MAX_PACK_BYTES) {
    throw new Error("This package is larger than the 250 MB safety limit.");
  }
  const zip = await JSZip.loadAsync(file, { checkCRC32: true });
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error("This package contains too many files.");
  }
  let totalUncompressedBytes = 0;
  for (const entry of entries) {
    const originalName = (entry as { unsafeOriginalName?: string }).unsafeOriginalName ?? entry.name;
    const pathSegments = originalName.replace(/\\/g, "/").split("/");
    if (originalName.startsWith("/") || pathSegments.includes("..")) {
      throw new Error("This package contains an unsafe file path.");
    }
    if (entry.dir) continue;
    const entrySize = (entry as unknown as { _data?: { uncompressedSize?: unknown } })
      ._data?.uncompressedSize;
    if (typeof entrySize !== "number" || !Number.isSafeInteger(entrySize) || entrySize < 0) {
      throw new Error("This package has invalid file metadata.");
    }
    if (entrySize > MAX_ZIP_ENTRY_BYTES) {
      throw new Error("This package contains a file that is too large to open safely.");
    }
    totalUncompressedBytes += entrySize;
    if (totalUncompressedBytes > MAX_ZIP_TOTAL_BYTES) {
      throw new Error("This package expands beyond the safe memory limit.");
    }
  }
  const manifestEntry = zip.file("manifest.json");
  const projectEntry = zip.file("material.json");
  if (!manifestEntry || !projectEntry) {
    throw new Error("This file is missing the Forge material manifest or project.");
  }
  const manifestSize = (manifestEntry as unknown as { _data?: { uncompressedSize?: number } })
    ._data?.uncompressedSize ?? Number.POSITIVE_INFINITY;
  const projectSize = (projectEntry as unknown as { _data?: { uncompressedSize?: number } })
    ._data?.uncompressedSize ?? Number.POSITIVE_INFINITY;
  if (manifestSize > MAX_MANIFEST_BYTES || projectSize > MAX_PROJECT_BYTES) {
    throw new Error("This package manifest or project is too large to open safely.");
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
