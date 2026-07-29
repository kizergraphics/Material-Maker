import type { MaterialEvaluation } from "./material-evaluator";
import {
  GENERATED_MAP_CACHE_STORE,
  openMaterialDatabase,
} from "./local-database";
import type {
  MapGenerationSettings,
  SourceTextureAsset,
} from "./material-types";

const CACHE_FORMAT_VERSION = 1;
const GENERATION_ALGORITHM_VERSION = 1;
const MAX_PERSISTENT_CACHE_ENTRIES = 3;
const MAX_CACHE_ENTRY_BYTES = 128 * 1024 * 1024;

type GeneratedMapCacheRecord = MaterialEvaluation & {
  key: string;
  cacheFormatVersion: number;
  generationAlgorithmVersion: number;
  maxEdge: number;
  createdAt: number;
  sizeBytes: number;
};

const sourceFingerprintCache = new WeakMap<
  SourceTextureAsset,
  Promise<string>
>();
const settingsFingerprintCache = new WeakMap<
  MapGenerationSettings,
  Promise<string>
>();

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function sha256(buffer: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Content fingerprints are unavailable.");
  }
  return bytesToHex(
    new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", buffer)),
  );
}

async function sha256Text(value: string) {
  return sha256(new TextEncoder().encode(value).buffer);
}

export async function fingerprintSourceFile(file: File) {
  return sha256(await file.arrayBuffer());
}

async function fingerprintSourceTexture(source: SourceTextureAsset) {
  if (source.fingerprint) return source.fingerprint;
  const cached = sourceFingerprintCache.get(source);
  if (cached) return cached;
  const fingerprint = fetch(source.dataUrl)
    .then((response) => {
      if (!response.ok) {
        throw new Error("The source texture could not be fingerprinted.");
      }
      return response.arrayBuffer();
    })
    .then(sha256)
    .then((value) => {
      source.fingerprint = value;
      return value;
    })
    .catch((error) => {
      sourceFingerprintCache.delete(source);
      throw error;
    });
  sourceFingerprintCache.set(source, fingerprint);
  return fingerprint;
}

function pixelSettings(settings: MapGenerationSettings) {
  return {
    baseColor: {
      brightness: settings.baseColor.brightness,
      contrast: settings.baseColor.contrast,
      saturation: settings.baseColor.saturation,
      hue: settings.baseColor.hue,
    },
    height: {
      contrast: settings.height.contrast,
      bias: settings.height.bias,
      blur: settings.height.blur,
      invert: settings.height.invert,
    },
    normal: {
      strength: settings.normal.strength,
      detail: settings.normal.detail,
      invertY: settings.normal.invertY,
    },
    roughness: {
      base: settings.roughness.base,
      variation: settings.roughness.variation,
      invert: settings.roughness.invert,
    },
    metallic: {
      base: settings.metallic.base,
      variation: settings.metallic.variation,
      invert: settings.metallic.invert,
    },
    ao: {
      strength: settings.ao.strength,
      radius: settings.ao.radius,
      bias: settings.ao.bias,
    },
  };
}

async function fingerprintSettings(settings: MapGenerationSettings) {
  const cached = settingsFingerprintCache.get(settings);
  if (cached) return cached;
  const fingerprint = sha256Text(JSON.stringify(pixelSettings(settings))).catch(
    (error) => {
      settingsFingerprintCache.delete(settings);
      throw error;
    },
  );
  settingsFingerprintCache.set(settings, fingerprint);
  return fingerprint;
}

async function generatedMapCacheKey(
  source: SourceTextureAsset,
  settings: MapGenerationSettings,
  maxEdge: number,
) {
  const [sourceFingerprint, settingsFingerprint] = await Promise.all([
    fingerprintSourceTexture(source),
    fingerprintSettings(settings),
  ]);
  return [
    `v${CACHE_FORMAT_VERSION}`,
    `algorithm-${GENERATION_ALGORITHM_VERSION}`,
    sourceFingerprint,
    settingsFingerprint,
    maxEdge,
  ].join(":");
}

function evaluationSizeBytes(evaluation: MaterialEvaluation) {
  return (
    evaluation.albedo.byteLength +
    evaluation.heightMap.byteLength +
    evaluation.normal.byteLength +
    evaluation.roughness.byteLength +
    evaluation.metallic.byteLength +
    evaluation.ambientOcclusion.byteLength
  );
}

function isValidCacheRecord(
  value: unknown,
  key: string,
  maxEdge: number,
): value is GeneratedMapCacheRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<GeneratedMapCacheRecord>;
  if (
    record.key !== key ||
    record.cacheFormatVersion !== CACHE_FORMAT_VERSION ||
    record.generationAlgorithmVersion !== GENERATION_ALGORITHM_VERSION ||
    record.maxEdge !== maxEdge ||
    !Number.isSafeInteger(record.width) ||
    !Number.isSafeInteger(record.height) ||
    !record.width ||
    !record.height
  ) {
    return false;
  }
  const pixelBytes = record.width * record.height * 4;
  return (
    pixelBytes > 0 &&
    Math.max(record.width, record.height) === maxEdge &&
    record.sizeBytes === pixelBytes * 6 &&
    record.sizeBytes <= MAX_CACHE_ENTRY_BYTES &&
    record.albedo instanceof Uint8ClampedArray &&
    record.albedo.byteLength === pixelBytes &&
    record.heightMap instanceof Uint8ClampedArray &&
    record.heightMap.byteLength === pixelBytes &&
    record.normal instanceof Uint8ClampedArray &&
    record.normal.byteLength === pixelBytes &&
    record.roughness instanceof Uint8ClampedArray &&
    record.roughness.byteLength === pixelBytes &&
    record.metallic instanceof Uint8ClampedArray &&
    record.metallic.byteLength === pixelBytes &&
    record.ambientOcclusion instanceof Uint8ClampedArray &&
    record.ambientOcclusion.byteLength === pixelBytes &&
    typeof record.roughnessValue === "number" &&
    Number.isFinite(record.roughnessValue) &&
    typeof record.metallicValue === "number" &&
    Number.isFinite(record.metallicValue) &&
    Array.isArray(record.warnings) &&
    record.warnings.every((warning) => typeof warning === "string")
  );
}

function evaluationFromRecord(
  record: GeneratedMapCacheRecord,
): MaterialEvaluation {
  return {
    width: record.width,
    height: record.height,
    albedo: record.albedo,
    heightMap: record.heightMap,
    normal: record.normal,
    roughness: record.roughness,
    metallic: record.metallic,
    ambientOcclusion: record.ambientOcclusion,
    roughnessValue: record.roughnessValue,
    metallicValue: record.metallicValue,
    warnings: record.warnings,
  };
}

async function trimCacheTo(
  keepCount: number,
  protectedKey?: string,
) {
  const database = await openMaterialDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      GENERATED_MAP_CACHE_STORE,
      "readwrite",
    );
    const store = transaction.objectStore(GENERATED_MAP_CACHE_STORE);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      let remaining = Math.max(0, countRequest.result - keepCount);
      if (!remaining) return;
      const cursorRequest = store.index("createdAt").openKeyCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || !remaining) return;
        if (cursor.primaryKey !== protectedKey) {
          store.delete(cursor.primaryKey);
          remaining -= 1;
        }
        cursor.continue();
      };
    };
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(
        transaction.error ?? new Error("The generated-map cache could not be trimmed."),
      );
    };
    transaction.onabort = () => {
      database.close();
      reject(
        transaction.error ?? new Error("The generated-map cache could not be trimmed."),
      );
    };
  });
}

async function writeCacheRecord(record: GeneratedMapCacheRecord) {
  const database = await openMaterialDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(
      GENERATED_MAP_CACHE_STORE,
      "readwrite",
    );
    transaction.objectStore(GENERATED_MAP_CACHE_STORE).put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(
        transaction.error ?? new Error("The generated maps could not be cached."),
      );
    };
    transaction.onabort = () => {
      database.close();
      reject(
        transaction.error ?? new Error("The generated maps could not be cached."),
      );
    };
  });
}

export async function getPersistentGeneratedMaps(
  source: SourceTextureAsset,
  settings: MapGenerationSettings,
  maxEdge: number,
) {
  try {
    const key = await generatedMapCacheKey(source, settings, maxEdge);
    const database = await openMaterialDatabase();
    return await new Promise<MaterialEvaluation | null>((resolve, reject) => {
      const transaction = database.transaction(
        GENERATED_MAP_CACHE_STORE,
        "readonly",
      );
      const request = transaction
        .objectStore(GENERATED_MAP_CACHE_STORE)
        .get(key);
      let result: MaterialEvaluation | null = null;
      request.onsuccess = () => {
        if (isValidCacheRecord(request.result, key, maxEdge)) {
          result = evaluationFromRecord(request.result);
        }
      };
      transaction.oncomplete = () => {
        database.close();
        resolve(result);
      };
      transaction.onerror = () => {
        database.close();
        reject(
          transaction.error ?? new Error("Generated maps could not be read."),
        );
      };
      transaction.onabort = () => {
        database.close();
        reject(
          transaction.error ?? new Error("Generated maps could not be read."),
        );
      };
    });
  } catch {
    return null;
  }
}

export async function storePersistentGeneratedMaps(
  source: SourceTextureAsset,
  settings: MapGenerationSettings,
  maxEdge: number,
  evaluation: MaterialEvaluation,
) {
  try {
    const sizeBytes = evaluationSizeBytes(evaluation);
    if (!sizeBytes || sizeBytes > MAX_CACHE_ENTRY_BYTES) return;
    const key = await generatedMapCacheKey(source, settings, maxEdge);
    const record: GeneratedMapCacheRecord = {
      key,
      cacheFormatVersion: CACHE_FORMAT_VERSION,
      generationAlgorithmVersion: GENERATION_ALGORITHM_VERSION,
      maxEdge,
      createdAt: Date.now(),
      sizeBytes,
      ...evaluation,
    };
    await trimCacheTo(MAX_PERSISTENT_CACHE_ENTRIES - 1, key);
    try {
      await writeCacheRecord(record);
    } catch {
      await trimCacheTo(0, key);
      await writeCacheRecord(record);
    }
  } catch {
    // Persistent caching is an optimization and must never block generation.
  }
}
