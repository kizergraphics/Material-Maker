import type {
  GeneratedMapsPayload,
  MaterialGenerationWorkerRequest,
  MaterialGenerationWorkerResponse,
} from "../core/material-generation-worker-types";
import type { SourceTextureAsset } from "../core/material-types";
import {
  generateDerivedMap,
  generatePreparedMaps,
  prepareSourcePixels,
  textureMapChannels,
  type PreparedSourceTexture,
} from "../core/texture-generator";

type WorkerScope = {
  onmessage: ((event: MessageEvent<MaterialGenerationWorkerRequest>) => void) | null;
  postMessage: (
    message: MaterialGenerationWorkerResponse,
    transfer?: Transferable[],
  ) => void;
};

const scope = globalThis as unknown as WorkerScope;
let sourceTexture: SourceTextureAsset | null = null;
let preparedByEdge = new Map<number, Promise<PreparedSourceTexture>>();

function targetDimensions(source: SourceTextureAsset, maxEdge: number) {
  const scale = maxEdge / Math.max(source.width, source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

async function prepareInWorker(
  source: SourceTextureAsset,
  maxEdge: number,
): Promise<PreparedSourceTexture> {
  const response = await fetch(source.dataUrl);
  if (!response.ok) throw new Error("The source texture could not be read.");
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const { width, height } = targetDimensions(source, maxEdge);
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Worker canvas processing is unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);
    return prepareSourcePixels(
      context.getImageData(0, 0, width, height).data,
      width,
      height,
      maxEdge / 256,
    );
  } finally {
    bitmap.close();
  }
}

function getPrepared(maxEdge: number) {
  if (!sourceTexture) {
    return Promise.reject(new Error("The source texture is not initialized."));
  }
  const cached = preparedByEdge.get(maxEdge);
  if (cached) return cached;
  const prepared = prepareInWorker(sourceTexture, maxEdge);
  preparedByEdge.set(maxEdge, prepared);
  return prepared;
}

function transferablesFor(payload: GeneratedMapsPayload) {
  const transferables: Transferable[] = [];
  for (const value of Object.values(payload.result)) {
    if (value instanceof Uint8ClampedArray) {
      transferables.push(value.buffer);
    }
  }
  return transferables;
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "initialize") {
    sourceTexture = message.source;
    preparedByEdge = new Map();
    return;
  }

  void getPrepared(message.maxEdge)
    .then((prepared) => {
      const full = message.channels.length === textureMapChannels.length;
      const result = full
        ? generatePreparedMaps(prepared, message.settings)
        : Object.assign(
            {},
            ...message.channels.map((channel) =>
              generateDerivedMap(prepared, message.settings, channel),
            ),
          );
      const payload: GeneratedMapsPayload = {
        result,
        width: prepared.width,
        height: prepared.height,
        full,
      };
      scope.postMessage(
        {
          type: "generated",
          requestId: message.requestId,
          ...payload,
        },
        transferablesFor(payload),
      );
    })
    .catch((reason) => {
      scope.postMessage({
        type: "error",
        requestId: message.requestId,
        message:
          reason instanceof Error ? reason.message : "Map generation failed.",
      });
    });
};
