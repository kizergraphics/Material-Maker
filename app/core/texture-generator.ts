import type { MaterialEvaluation } from "./material-evaluator";
import type {
  MapGenerationSettings,
  SourceTextureAsset,
  TextureMapChannel,
} from "./material-types";

const MAX_SOURCE_BYTES = 48 * 1024 * 1024;
const MAX_SOURCE_EDGE = 16384;
const MAX_SOURCE_PIXELS = 64 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The albedo image could not be decoded."));
    image.src = dataUrl;
  });
}

export async function importSourceTexture(file: File): Promise<SourceTextureAsset> {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose an albedo image smaller than 48 MB.");
  }
  if (!SUPPORTED_IMAGE_TYPES.includes(file.type as (typeof SUPPORTED_IMAGE_TYPES)[number])) {
    throw new Error("Use a PNG, JPEG, or WebP albedo image.");
  }
  const dataUrl = await blobToDataUrl(file);
  const image = await loadImage(dataUrl);
  if (!image.naturalWidth || !image.naturalHeight) {
    throw new Error("The albedo image has invalid dimensions.");
  }
  if (image.naturalWidth > MAX_SOURCE_EDGE || image.naturalHeight > MAX_SOURCE_EDGE) {
    throw new Error("The albedo image cannot exceed 16,384 pixels on either edge.");
  }
  if (image.naturalWidth * image.naturalHeight > MAX_SOURCE_PIXELS) {
    throw new Error("Choose an albedo image with fewer than 64 megapixels.");
  }
  return {
    name: file.name.slice(0, 240),
    mimeType: file.type as SourceTextureAsset["mimeType"],
    dataUrl,
    width: image.naturalWidth,
    height: image.naturalHeight,
    sizeBytes: file.size,
  };
}

function targetDimensions(source: SourceTextureAsset, maxEdge: number) {
  const scale = maxEdge / Math.max(source.width, source.height);
  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

async function readSourcePixels(source: SourceTextureAsset, maxEdge: number) {
  const image = await loadImage(source.dataUrl);
  const { width, height } = targetDimensions(source, maxEdge);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Canvas image processing is unavailable.");
  context.drawImage(image, 0, 0, width, height);
  return { pixels: context.getImageData(0, 0, width, height).data, width, height };
}

function boxBlur(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
) {
  const amount = Math.max(0, Math.round(radius));
  if (!amount) return new Float32Array(input);
  const horizontal = new Float32Array(input.length);
  const result = new Float32Array(input.length);
  const diameter = amount * 2 + 1;

  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    for (let offset = -amount; offset <= amount; offset += 1) {
      const x = (offset + width) % width;
      sum += input[y * width + x];
    }
    for (let x = 0; x < width; x += 1) {
      horizontal[y * width + x] = sum / diameter;
      const removeX = (x - amount + width) % width;
      const addX = (x + amount + 1) % width;
      sum += input[y * width + addX] - input[y * width + removeX];
    }
  }

  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let offset = -amount; offset <= amount; offset += 1) {
      const y = (offset + height) % height;
      sum += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y += 1) {
      result[y * width + x] = sum / diameter;
      const removeY = (y - amount + height) % height;
      const addY = (y + amount + 1) % height;
      sum += horizontal[addY * width + x] - horizontal[removeY * width + x];
    }
  }
  return result;
}

function writeGray(target: Uint8ClampedArray, offset: number, value: number) {
  const byte = Math.round(clamp(value) * 255);
  target[offset] = byte;
  target[offset + 1] = byte;
  target[offset + 2] = byte;
  target[offset + 3] = 255;
}

function applyHue(r: number, g: number, b: number, degrees: number) {
  if (!degrees) return [r, g, b] as const;
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    clamp((0.213 + cos * 0.787 - sin * 0.213) * r + (0.715 - cos * 0.715 - sin * 0.715) * g + (0.072 - cos * 0.072 + sin * 0.928) * b),
    clamp((0.213 - cos * 0.213 + sin * 0.143) * r + (0.715 + cos * 0.285 + sin * 0.14) * g + (0.072 - cos * 0.072 - sin * 0.283) * b),
    clamp((0.213 - cos * 0.213 - sin * 0.787) * r + (0.715 - cos * 0.715 + sin * 0.715) * g + (0.072 + cos * 0.928 + sin * 0.072) * b),
  ] as const;
}

export interface PreparedSourceTexture {
  source: Uint8ClampedArray;
  luminance: Float32Array;
  width: number;
  height: number;
  scale: number;
}

export const textureMapChannels: TextureMapChannel[] = [
  "baseColor",
  "height",
  "normal",
  "roughness",
  "metallic",
  "ao",
];

const generationWarnings = [
  "Metallic maps cannot be identified reliably from color alone; verify the metallic controls for your material.",
];

export function prepareSourcePixels(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): PreparedSourceTexture {
  const pixelCount = width * height;
  const luminance = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const sourceR = source[offset] / 255;
    const sourceG = source[offset + 1] / 255;
    const sourceB = source[offset + 2] / 255;
    luminance[index] = sourceR * 0.2126 + sourceG * 0.7152 + sourceB * 0.0722;
  }
  return { source, luminance, width, height, scale };
}

export async function prepareSourceTexture(
  source: SourceTextureAsset,
  maxEdge: number,
): Promise<PreparedSourceTexture> {
  const decoded = await readSourcePixels(source, maxEdge);
  return prepareSourcePixels(
    decoded.pixels,
    decoded.width,
    decoded.height,
    maxEdge / 256,
  );
}

export function generateDerivedMap(
  prepared: PreparedSourceTexture,
  settings: MapGenerationSettings,
  channel: TextureMapChannel,
): Partial<MaterialEvaluation> {
  const { source, luminance, width, height, scale } = prepared;
  const pixelCount = width * height;

  if (channel === "baseColor") {
    const albedo = new Uint8ClampedArray(pixelCount * 4);
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      const sourceR = source[offset] / 255;
      const sourceG = source[offset + 1] / 255;
      const sourceB = source[offset + 2] / 255;
      let r = sourceR;
      let g = sourceG;
      let b = sourceB;
      [r, g, b] = applyHue(r, g, b, settings.baseColor.hue);
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      r = luma + (r - luma) * settings.baseColor.saturation;
      g = luma + (g - luma) * settings.baseColor.saturation;
      b = luma + (b - luma) * settings.baseColor.saturation;
      r =
        (r - 0.5) * settings.baseColor.contrast +
        0.5 +
        settings.baseColor.brightness;
      g =
        (g - 0.5) * settings.baseColor.contrast +
        0.5 +
        settings.baseColor.brightness;
      b =
        (b - 0.5) * settings.baseColor.contrast +
        0.5 +
        settings.baseColor.brightness;
      albedo[offset] = Math.round(clamp(r) * 255);
      albedo[offset + 1] = Math.round(clamp(g) * 255);
      albedo[offset + 2] = Math.round(clamp(b) * 255);
      albedo[offset + 3] = source[offset + 3];
    }
    return { albedo };
  }

  if (channel === "height") {
    const heightMap = new Uint8ClampedArray(pixelCount * 4);
    const blurredHeight = boxBlur(
      luminance,
      width,
      height,
      settings.height.blur * Math.max(1, scale),
    );
    for (let index = 0; index < pixelCount; index += 1) {
      let value =
        (blurredHeight[index] - 0.5) * settings.height.contrast +
        0.5 +
        settings.height.bias;
      if (settings.height.invert) value = 1 - value;
      writeGray(heightMap, index * 4, value);
    }
    return { heightMap };
  }

  if (channel === "normal") {
    const normal = new Uint8ClampedArray(pixelCount * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        const offset = index * 4;
        const left = luminance[y * width + ((x - 1 + width) % width)];
        const right = luminance[y * width + ((x + 1) % width)];
        const down = luminance[((y - 1 + height) % height) * width + x];
        const up = luminance[((y + 1) % height) * width + x];
        let nx =
          (left - right) *
          settings.normal.strength *
          settings.normal.detail *
          2;
        let ny =
          (down - up) *
          settings.normal.strength *
          settings.normal.detail *
          2;
        if (settings.normal.invertY) ny *= -1;
        let nz = 1;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        normal[offset] = Math.round((nx * 0.5 + 0.5) * 255);
        normal[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
        normal[offset + 2] = Math.round(nz * 255);
        normal[offset + 3] = 255;
      }
    }
    return { normal };
  }

  if (channel === "roughness") {
    const roughness = new Uint8ClampedArray(pixelCount * 4);
    let roughnessTotal = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      let rough =
        settings.roughness.base +
        (luminance[index] - 0.5) * settings.roughness.variation;
      if (settings.roughness.invert) rough = 1 - rough;
      rough = clamp(rough);
      roughnessTotal += rough;
      writeGray(roughness, offset, rough);
    }
    return { roughness, roughnessValue: roughnessTotal / pixelCount };
  }

  if (channel === "metallic") {
    const metallic = new Uint8ClampedArray(pixelCount * 4);
    let metallicTotal = 0;
    for (let index = 0; index < pixelCount; index += 1) {
      const offset = index * 4;
      let metal =
        settings.metallic.base +
        (luminance[index] - 0.5) * settings.metallic.variation;
      if (settings.metallic.invert) metal = 1 - metal;
      metal = clamp(metal);
      metallicTotal += metal;
      writeGray(metallic, offset, metal);
    }
    return { metallic, metallicValue: metallicTotal / pixelCount };
  }

  const ambientOcclusion = new Uint8ClampedArray(pixelCount * 4);
  const aoBlur = boxBlur(
    luminance,
    width,
    height,
    settings.ao.radius * Math.max(1, scale),
  );
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const cavity = Math.max(0, aoBlur[index] - luminance[index]);
    const ao = clamp(
      1 - cavity * settings.ao.strength * 5 + settings.ao.bias,
    );
    writeGray(ambientOcclusion, offset, ao);
  }
  return { ambientOcclusion };
}

export function generatePreparedMaps(
  prepared: PreparedSourceTexture,
  settings: MapGenerationSettings,
): MaterialEvaluation {
  const generated = Object.assign(
    {},
    ...textureMapChannels.map((channel) =>
      generateDerivedMap(prepared, settings, channel),
    ),
  ) as Pick<
    MaterialEvaluation,
    | "albedo"
    | "heightMap"
    | "normal"
    | "roughness"
    | "metallic"
    | "ambientOcclusion"
    | "roughnessValue"
    | "metallicValue"
  >;
  return {
    width: prepared.width,
    height: prepared.height,
    ...generated,
    warnings: generationWarnings,
  };
}

export function generateDerivedMaps(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  settings: MapGenerationSettings,
  scale = 1,
): MaterialEvaluation {
  return generatePreparedMaps(
    prepareSourcePixels(source, width, height, scale),
    settings,
  );
}

export async function evaluateSourceTexture(
  source: SourceTextureAsset,
  settings: MapGenerationSettings,
  maxEdge: number,
) {
  return generatePreparedMaps(
    await prepareSourceTexture(source, maxEdge),
    settings,
  );
}

export function pixelsForChannel(
  evaluation: MaterialEvaluation,
  channel: TextureMapChannel,
) {
  if (channel === "baseColor") return evaluation.albedo;
  if (channel === "height") return evaluation.heightMap;
  if (channel === "normal") return evaluation.normal;
  if (channel === "roughness") return evaluation.roughness;
  if (channel === "metallic") return evaluation.metallic;
  return evaluation.ambientOcclusion;
}
