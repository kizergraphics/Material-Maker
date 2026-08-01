export const MATERIAL_NODE_KINDS = [
  "color",
  "value",
  "noise",
  "checker",
  "voronoi",
  "gradient",
  "brick",
  "levels",
  "colorRamp",
  "invert",
  "threshold",
  "transform2d",
  "math",
  "blend",
  "maskedBlend",
  "channels",
  "combineChannels",
  "roughness",
  "metallic",
  "normal",
  "textureMap",
  "output",
] as const;

export type MaterialNodeKind = (typeof MATERIAL_NODE_KINDS)[number];

export const MATERIAL_NODE_CATEGORIES = [
  "input",
  "generator",
  "filter",
  "blend",
  "output",
] as const;

export type MaterialNodeCategory = (typeof MATERIAL_NODE_CATEGORIES)[number];

export const MATERIAL_TEXTURE_CHANNELS = [
  "baseColor",
  "height",
  "normal",
  "roughness",
  "metallic",
  "ao",
] as const;

export type TextureMapChannel = (typeof MATERIAL_TEXTURE_CHANNELS)[number];

export const MATERIAL_MATH_OPERATIONS = [
  "add",
  "subtract",
  "multiply",
  "divide",
  "minimum",
  "maximum",
  "power",
  "absolute",
] as const;

export type MaterialMathOperation = (typeof MATERIAL_MATH_OPERATIONS)[number];

export const MATERIAL_GRADIENT_MODES = [
  "linear",
  "radial",
  "angular",
] as const;

export type MaterialGradientMode = (typeof MATERIAL_GRADIENT_MODES)[number];
export type NodeSelectValue = MaterialMathOperation | MaterialGradientMode;

export type NodeValueMap = {
  color?: string;
  colorA?: string;
  colorB?: string;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
  contrast?: number;
  seed?: number;
  minimum?: number;
  maximum?: number;
  gamma?: number;
  opacity?: number;
  value?: number;
  strength?: number;
  midpoint?: number;
  threshold?: number;
  softness?: number;
  columns?: number;
  rows?: number;
  mortar?: number;
  stagger?: number;
  operation?: NodeSelectValue;
  gradientMode?: NodeSelectValue;
  mapChannel?: TextureMapChannel;
  enabled?: boolean;
  thumbnail?: string;
};

export type NodeValueKey = keyof NodeValueMap;
export type MaterialPortType = "color" | "scalar" | "normal" | "texture" | "dynamic";
export type MaterialNodeSample = [number, number, number, number];

export type MaterialPortDefinition = {
  id: string;
  label: string;
  type: MaterialPortType;
  required?: boolean;
};

export type MaterialNodeParameterDefinition =
  | {
      control: "color";
      key: "color" | "colorA" | "colorB";
      label: string;
      defaultValue: string;
    }
  | {
      control: "range";
      key:
        | "scale"
        | "contrast"
        | "seed"
        | "minimum"
        | "maximum"
        | "gamma"
        | "opacity"
        | "value"
        | "strength"
        | "midpoint"
        | "threshold"
        | "softness"
        | "scaleX"
        | "scaleY"
        | "offsetX"
        | "offsetY"
        | "rotation"
        | "columns"
        | "rows"
        | "mortar"
        | "stagger";
      label: string;
      defaultValue: number;
      min: number;
      max: number;
      step: number;
    }
  | {
      control: "select";
      key: "operation" | "gradientMode";
      label: string;
      defaultValue: NodeSelectValue;
      options: readonly {
        value: NodeSelectValue;
        label: string;
      }[];
    };

export type MaterialNodeMigration = {
  fromVersion: number;
  toVersion: number;
  parameterRenames?: Readonly<Record<string, NodeValueKey>>;
  addedDefaults?: Readonly<Partial<NodeValueMap>>;
  inputPortRenames?: Readonly<Record<string, string>>;
  outputPortRenames?: Readonly<Record<string, string>>;
};

export type MaterialNodeEvaluationContext = {
  u: number;
  v: number;
  values: NodeValueMap;
  sampleInput: (portId: string) => MaterialNodeSample;
  sampleInputAt: (
    portId: string,
    u: number,
    v: number,
  ) => MaterialNodeSample;
  isInputConnected: (portId: string) => boolean;
  sampleTextureMap: (channel: TextureMapChannel) => MaterialNodeSample;
};

export type MaterialNodeOutputMap = Readonly<
  Record<string, MaterialNodeSample>
>;

export type MaterialNodeEvaluationResult =
  | MaterialNodeSample
  | MaterialNodeOutputMap;

export type MaterialNodeDefinition = {
  kind: MaterialNodeKind;
  version: number;
  migrations?: readonly MaterialNodeMigration[];
  label: string;
  category: MaterialNodeCategory;
  description: string;
  userCreatable: boolean;
  inputs: readonly MaterialPortDefinition[];
  outputs: readonly MaterialPortDefinition[];
  parameters: readonly MaterialNodeParameterDefinition[];
  defaultValues: NodeValueMap;
  summarize: (values: NodeValueMap) => string;
  evaluate?: (
    context: MaterialNodeEvaluationContext,
  ) => MaterialNodeEvaluationResult;
};

const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));

const textureMapFallbacks: Record<TextureMapChannel, MaterialNodeSample> = {
  baseColor: [0.5, 0.5, 0.5, 1],
  height: [0.5, 0.5, 0.5, 1],
  normal: [0.5, 0.5, 1, 1],
  roughness: [0.6, 0.6, 0.6, 1],
  metallic: [0, 0, 0, 1],
  ao: [1, 1, 1, 1],
};

function hexToColor(hex: string | undefined): MaterialNodeSample {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return [0.5, 0.5, 0.5, 1];
  return [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
    1,
  ];
}

function hash2d(x: number, y: number, seed: number) {
  let value = (x * 374761393 + y * 668265263 + seed * 69069) | 0;
  value = (value ^ (value >>> 13)) * 1274126177;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

const smooth = (value: number) => value * value * (3 - 2 * value);

const fade = (value: number) =>
  value * value * value * (value * (value * 6 - 15) + 10);

const gradientDirections = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
] as const;

function gradientDot(
  gridX: number,
  gridY: number,
  offsetX: number,
  offsetY: number,
  seed: number,
) {
  const direction =
    gradientDirections[
      Math.floor(hash2d(gridX, gridY, seed) * gradientDirections.length) %
        gradientDirections.length
    ];
  return direction[0] * offsetX + direction[1] * offsetY;
}

function tileableGradientNoise(
  u: number,
  v: number,
  scale: number,
  seed: number,
) {
  const frequency = Math.max(1, Math.round(scale));
  const x = u * frequency;
  const y = v * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const wrappedX0 = ((x0 % frequency) + frequency) % frequency;
  const wrappedY0 = ((y0 % frequency) + frequency) % frequency;
  const wrappedX1 = (((x0 + 1) % frequency) + frequency) % frequency;
  const wrappedY1 = (((y0 + 1) % frequency) + frequency) % frequency;
  const offsetX = x - x0;
  const offsetY = y - y0;
  const tx = fade(offsetX);
  const ty = fade(offsetY);
  const a = gradientDot(
    wrappedX0,
    wrappedY0,
    offsetX,
    offsetY,
    seed,
  );
  const b = gradientDot(wrappedX1, wrappedY0, offsetX - 1, offsetY, seed);
  const c = gradientDot(wrappedX0, wrappedY1, offsetX, offsetY - 1, seed);
  const d = gradientDot(
    wrappedX1,
    wrappedY1,
    offsetX - 1,
    offsetY - 1,
    seed,
  );
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return clamp((top + (bottom - top) * ty) * 1.5, -1, 1);
}

function tileableCloudNoise(u: number, v: number, scale: number, seed: number) {
  const baseFrequency = Math.max(1, Math.round(scale));
  const warpFrequency = Math.max(1, Math.round(baseFrequency / 2));
  const warpStrength = 0.7 / baseFrequency;
  const warpedU =
    u +
    tileableGradientNoise(u, v, warpFrequency, seed + 101) * warpStrength;
  const warpedV =
    v +
    tileableGradientNoise(u, v, warpFrequency, seed + 307) * warpStrength;

  let amplitude = 1;
  let totalAmplitude = 0;
  let total = 0;

  for (let octave = 0; octave < 5; octave += 1) {
    total +=
      tileableGradientNoise(
        warpedU,
        warpedV,
        baseFrequency * 2 ** octave,
        seed + octave * 53,
      ) * amplitude;
    totalAmplitude += amplitude;
    amplitude *= 0.52;
  }

  return smooth(clamp(total / totalAmplitude * 0.5 + 0.5));
}

function tileableVoronoi(u: number, v: number, scale: number, seed: number) {
  const frequency = Math.max(1, Math.round(scale));
  const x = u * frequency;
  const y = v * frequency;
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  let nearest = Number.POSITIVE_INFINITY;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const candidateX = cellX + offsetX;
      const candidateY = cellY + offsetY;
      const wrappedX = ((candidateX % frequency) + frequency) % frequency;
      const wrappedY = ((candidateY % frequency) + frequency) % frequency;
      const pointX = candidateX + hash2d(wrappedX, wrappedY, seed);
      const pointY = candidateY + hash2d(wrappedX, wrappedY, seed + 7919);
      nearest = Math.min(nearest, Math.hypot(pointX - x, pointY - y));
    }
  }

  return clamp(nearest * Math.SQRT2);
}

function rotateUv(u: number, v: number, degrees: number) {
  const angle = degrees * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const x = u - 0.5;
  const y = v - 0.5;
  return [
    x * cosine - y * sine + 0.5,
    x * sine + y * cosine + 0.5,
  ] as const;
}

function luminance(sample: MaterialNodeSample) {
  return sample[0] * 0.2126 + sample[1] * 0.7152 + sample[2] * 0.0722;
}

function mixColor(
  a: MaterialNodeSample,
  b: MaterialNodeSample,
  amount: number,
): MaterialNodeSample {
  const t = clamp(amount);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

const singleOutput = (type: MaterialPortType, id = "out") =>
  [{ id, label: "Output", type }] as const;

export const MATERIAL_NODE_DEFINITIONS: readonly MaterialNodeDefinition[] = [
  {
    kind: "color",
    version: 1,
    label: "Base color",
    category: "input",
    description: "A color value in sRGB space.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("color"),
    parameters: [
      { control: "color", key: "color", label: "Color", defaultValue: "#76706a" },
    ],
    defaultValues: { color: "#76706a" },
    summarize: (values) => values.color ?? "#808080",
    evaluate: ({ values }) => hexToColor(values.color),
  },
  {
    kind: "value",
    version: 1,
    label: "Value",
    category: "input",
    description: "A reusable scalar value for masks, math, and material channels.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "value", label: "Value", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    defaultValues: { value: 0.5 },
    summarize: (values) => (values.value ?? 0.5).toFixed(2),
    evaluate: ({ values }) => {
      const value = clamp(values.value ?? 0.5);
      return [value, value, value, 1];
    },
  },
  {
    kind: "noise",
    version: 1,
    label: "Cloud noise",
    category: "generator",
    description: "Layered, tileable cloud noise with soft organic detail.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "scale", label: "Scale", defaultValue: 8, min: 1, max: 32, step: 1 },
      { control: "range", key: "contrast", label: "Contrast", defaultValue: 0.62, min: 0, max: 1, step: 0.01 },
      { control: "range", key: "seed", label: "Seed", defaultValue: 14, min: 1, max: 100, step: 1 },
    ],
    defaultValues: { scale: 8, contrast: 0.62, seed: 14 },
    summarize: (values) =>
      `${values.scale ?? 8}× tile · seed ${values.seed ?? 1}`,
    evaluate: ({ u, v, values }) => {
      const raw = tileableCloudNoise(
        u,
        v,
        values.scale ?? 8,
        Math.round(values.seed ?? 1),
      );
      const contrast = 0.45 + (values.contrast ?? 0.5) * 2.1;
      const tonal = clamp((raw - 0.5) * contrast + 0.5);
      return [tonal, tonal, tonal, 1];
    },
  },
  {
    kind: "checker",
    version: 1,
    label: "Checker",
    category: "generator",
    description: "A crisp, tileable checker mask.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "scale", label: "Tiles", defaultValue: 8, min: 2, max: 64, step: 2 },
      { control: "range", key: "rotation", label: "Rotation", defaultValue: 0, min: -180, max: 180, step: 90 },
    ],
    defaultValues: { scale: 8, rotation: 0 },
    summarize: (values) => `${values.scale ?? 8} tiles`,
    evaluate: ({ u, v, values }) => {
      const [rotatedU, rotatedV] = rotateUv(u, v, values.rotation ?? 0);
      const scale = Math.max(2, Math.round(values.scale ?? 8));
      const value = (Math.floor(rotatedU * scale) + Math.floor(rotatedV * scale)) & 1;
      return [value, value, value, 1];
    },
  },
  {
    kind: "voronoi",
    version: 1,
    label: "Voronoi cells",
    category: "generator",
    description: "Tileable cellular distances for stone, scales, and cracked masks.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "scale", label: "Cells", defaultValue: 8, min: 2, max: 48, step: 1 },
      { control: "range", key: "seed", label: "Seed", defaultValue: 17, min: 1, max: 100, step: 1 },
      { control: "range", key: "contrast", label: "Contrast", defaultValue: 1, min: 0.25, max: 3, step: 0.01 },
    ],
    defaultValues: { scale: 8, seed: 17, contrast: 1 },
    summarize: (values) => `${values.scale ?? 8} cells · seed ${values.seed ?? 17}`,
    evaluate: ({ u, v, values }) => {
      const distance = tileableVoronoi(
        u,
        v,
        values.scale ?? 8,
        Math.round(values.seed ?? 17),
      );
      const value = clamp((distance - 0.5) * (values.contrast ?? 1) + 0.5);
      return [value, value, value, 1];
    },
  },
  {
    kind: "gradient",
    version: 1,
    label: "Gradient",
    category: "generator",
    description: "Linear, radial, or angular grayscale gradients.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      {
        control: "select",
        key: "gradientMode",
        label: "Type",
        defaultValue: "linear",
        options: [
          { value: "linear", label: "Linear" },
          { value: "radial", label: "Radial" },
          { value: "angular", label: "Angular" },
        ],
      },
      { control: "range", key: "rotation", label: "Rotation", defaultValue: 0, min: -180, max: 180, step: 1 },
      { control: "range", key: "scale", label: "Scale", defaultValue: 1, min: 0.25, max: 8, step: 0.01 },
    ],
    defaultValues: { gradientMode: "linear", rotation: 0, scale: 1 },
    summarize: (values) => `${values.gradientMode ?? "linear"} · ${(values.rotation ?? 0).toFixed(0)}°`,
    evaluate: ({ u, v, values }) => {
      const [rotatedU, rotatedV] = rotateUv(u, v, values.rotation ?? 0);
      const scale = Math.max(0.01, values.scale ?? 1);
      const x = (rotatedU - 0.5) * scale;
      const y = (rotatedV - 0.5) * scale;
      const mode = values.gradientMode ?? "linear";
      const value = mode === "radial"
        ? clamp(Math.hypot(x, y) * 2)
        : mode === "angular"
          ? ((Math.atan2(y, x) / (Math.PI * 2) + 1) % 1)
          : clamp(x + 0.5);
      return [value, value, value, 1];
    },
  },
  {
    kind: "brick",
    version: 1,
    label: "Brick",
    category: "generator",
    description: "A tileable running-bond brick mask with adjustable mortar.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "columns", label: "Columns", defaultValue: 8, min: 2, max: 32, step: 1 },
      { control: "range", key: "rows", label: "Rows", defaultValue: 6, min: 2, max: 32, step: 2 },
      { control: "range", key: "mortar", label: "Mortar", defaultValue: 0.08, min: 0, max: 0.3, step: 0.01 },
      { control: "range", key: "stagger", label: "Stagger", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
    ],
    defaultValues: { columns: 8, rows: 6, mortar: 0.08, stagger: 0.5 },
    summarize: (values) => `${values.columns ?? 8}×${Math.max(2, Math.round((values.rows ?? 6) / 2) * 2)} running bond`,
    evaluate: ({ u, v, values }) => {
      const columns = Math.max(2, Math.round(values.columns ?? 8));
      const rows = Math.max(2, Math.round((values.rows ?? 6) / 2) * 2);
      const mortar = clamp(values.mortar ?? 0.08, 0, 0.45);
      const row = Math.floor(v * rows);
      const shiftedU = u * columns + (row & 1 ? values.stagger ?? 0.5 : 0);
      const localX = ((shiftedU % 1) + 1) % 1;
      const localY = ((v * rows) % 1 + 1) % 1;
      const edge = Math.min(localX, 1 - localX, localY, 1 - localY);
      const value = edge >= mortar * 0.5 ? 1 : 0;
      return [value, value, value, 1];
    },
  },
  {
    kind: "levels",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        parameterRenames: {
          min: "minimum",
          max: "maximum",
        },
        addedDefaults: {
          minimum: 0.18,
          maximum: 0.88,
          gamma: 1.08,
        },
      },
    ],
    label: "Levels",
    category: "filter",
    description: "Remap the tonal range of an input.",
    userCreatable: true,
    inputs: [{ id: "in", label: "Input", type: "dynamic", required: true }],
    outputs: singleOutput("dynamic"),
    parameters: [
      { control: "range", key: "minimum", label: "Black point", defaultValue: 0.18, min: 0, max: 0.95, step: 0.01 },
      { control: "range", key: "maximum", label: "White point", defaultValue: 0.88, min: 0.05, max: 1, step: 0.01 },
      { control: "range", key: "gamma", label: "Gamma", defaultValue: 1.08, min: 0.2, max: 3, step: 0.01 },
    ],
    defaultValues: { minimum: 0.18, maximum: 0.88, gamma: 1.08 },
    summarize: (values) =>
      `${(values.minimum ?? 0).toFixed(2)} — ${(values.maximum ?? 1).toFixed(2)}`,
    evaluate: ({ values, sampleInput }) => {
      const input = sampleInput("in");
      const minimum = values.minimum ?? 0;
      const maximum = Math.max(minimum + 0.001, values.maximum ?? 1);
      const gamma = Math.max(0.05, values.gamma ?? 1);
      const remap = (channel: number) =>
        Math.pow(clamp((channel - minimum) / (maximum - minimum)), 1 / gamma);
      return [remap(input[0]), remap(input[1]), remap(input[2]), input[3]];
    },
  },
  {
    kind: "colorRamp",
    version: 1,
    label: "Color ramp",
    category: "filter",
    description: "Maps a scalar input between two colors.",
    userCreatable: true,
    inputs: [{ id: "in", label: "Factor", type: "scalar", required: true }],
    outputs: singleOutput("color"),
    parameters: [
      { control: "color", key: "colorA", label: "Low color", defaultValue: "#17191d" },
      { control: "color", key: "colorB", label: "High color", defaultValue: "#e8d7b4" },
      { control: "range", key: "midpoint", label: "Midpoint", defaultValue: 0.5, min: 0.05, max: 0.95, step: 0.01 },
    ],
    defaultValues: { colorA: "#17191d", colorB: "#e8d7b4", midpoint: 0.5 },
    summarize: (values) => `${values.colorA ?? "#17191d"} → ${values.colorB ?? "#e8d7b4"}`,
    evaluate: ({ values, sampleInput }) => {
      const factor = clamp(sampleInput("in")[0]);
      const midpoint = clamp(values.midpoint ?? 0.5, 0.001, 0.999);
      const remapped = factor < midpoint
        ? factor / midpoint * 0.5
        : 0.5 + (factor - midpoint) / (1 - midpoint) * 0.5;
      return mixColor(hexToColor(values.colorA), hexToColor(values.colorB), remapped);
    },
  },
  {
    kind: "invert",
    version: 1,
    label: "Invert",
    category: "filter",
    description: "Inverts color or scalar values while preserving alpha.",
    userCreatable: true,
    inputs: [{ id: "in", label: "Input", type: "dynamic", required: true }],
    outputs: singleOutput("dynamic"),
    parameters: [],
    defaultValues: {},
    summarize: () => "1 − input",
    evaluate: ({ sampleInput }) => {
      const input = sampleInput("in");
      return [1 - input[0], 1 - input[1], 1 - input[2], input[3]];
    },
  },
  {
    kind: "threshold",
    version: 1,
    label: "Threshold",
    category: "filter",
    description: "Converts an input into a hard or softly feathered mask.",
    userCreatable: true,
    inputs: [{ id: "in", label: "Input", type: "dynamic", required: true }],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "threshold", label: "Threshold", defaultValue: 0.5, min: 0, max: 1, step: 0.01 },
      { control: "range", key: "softness", label: "Softness", defaultValue: 0, min: 0, max: 0.5, step: 0.01 },
    ],
    defaultValues: { threshold: 0.5, softness: 0 },
    summarize: (values) => `${(values.threshold ?? 0.5).toFixed(2)} threshold`,
    evaluate: ({ values, sampleInput }) => {
      const input = luminance(sampleInput("in"));
      const threshold = values.threshold ?? 0.5;
      const softness = Math.max(0, values.softness ?? 0);
      const value = softness <= 0
        ? Number(input >= threshold)
        : smooth(clamp((input - (threshold - softness)) / (softness * 2)));
      return [value, value, value, 1];
    },
  },
  {
    kind: "transform2d",
    version: 1,
    label: "Transform 2D",
    category: "filter",
    description: "Tiles, offsets, and rotates an upstream texture or pattern.",
    userCreatable: true,
    inputs: [{ id: "in", label: "Input", type: "dynamic", required: true }],
    outputs: singleOutput("dynamic"),
    parameters: [
      { control: "range", key: "scaleX", label: "Tile X", defaultValue: 1, min: 0.25, max: 16, step: 0.01 },
      { control: "range", key: "scaleY", label: "Tile Y", defaultValue: 1, min: 0.25, max: 16, step: 0.01 },
      { control: "range", key: "offsetX", label: "Offset X", defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { control: "range", key: "offsetY", label: "Offset Y", defaultValue: 0, min: -1, max: 1, step: 0.01 },
      { control: "range", key: "rotation", label: "Rotation", defaultValue: 0, min: -180, max: 180, step: 1 },
    ],
    defaultValues: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, rotation: 0 },
    summarize: (values) => `${(values.scaleX ?? 1).toFixed(2)}×${(values.scaleY ?? 1).toFixed(2)} · ${(values.rotation ?? 0).toFixed(0)}°`,
    evaluate: ({ u, v, values, sampleInputAt }) => {
      const [rotatedU, rotatedV] = rotateUv(u, v, -(values.rotation ?? 0));
      const sampleU = (rotatedU - 0.5) * (values.scaleX ?? 1) + 0.5 + (values.offsetX ?? 0);
      const sampleV = (rotatedV - 0.5) * (values.scaleY ?? 1) + 0.5 + (values.offsetY ?? 0);
      return sampleInputAt("in", sampleU, sampleV);
    },
  },
  {
    kind: "math",
    version: 1,
    label: "Math",
    category: "filter",
    description: "Performs common arithmetic on scalar or color inputs.",
    userCreatable: true,
    inputs: [
      { id: "a", label: "A", type: "dynamic", required: true },
      { id: "b", label: "B", type: "dynamic" },
    ],
    outputs: singleOutput("dynamic"),
    parameters: [
      {
        control: "select",
        key: "operation",
        label: "Operation",
        defaultValue: "multiply",
        options: [
          { value: "add", label: "Add" },
          { value: "subtract", label: "Subtract" },
          { value: "multiply", label: "Multiply" },
          { value: "divide", label: "Divide" },
          { value: "minimum", label: "Minimum" },
          { value: "maximum", label: "Maximum" },
          { value: "power", label: "Power" },
          { value: "absolute", label: "Absolute" },
        ],
      },
    ],
    defaultValues: { operation: "multiply" },
    summarize: (values) => values.operation ?? "multiply",
    evaluate: ({ values, sampleInput, isInputConnected }) => {
      const a = sampleInput("a");
      const b = isInputConnected("b") ? sampleInput("b") : [1, 1, 1, 1];
      const operation = values.operation ?? "multiply";
      const calculate = (left: number, right: number) => {
        if (operation === "add") return left + right;
        if (operation === "subtract") return left - right;
        if (operation === "divide") return Math.abs(right) < 1e-6 ? 0 : left / right;
        if (operation === "minimum") return Math.min(left, right);
        if (operation === "maximum") return Math.max(left, right);
        if (operation === "power") return Math.pow(Math.max(0, left), right);
        if (operation === "absolute") return Math.abs(left);
        return left * right;
      };
      return [
        calculate(a[0], b[0]),
        calculate(a[1], b[1]),
        calculate(a[2], b[2]),
        a[3],
      ];
    },
  },
  {
    kind: "blend",
    version: 1,
    label: "Blend",
    category: "blend",
    description: "Mix two color or scalar streams.",
    userCreatable: true,
    inputs: [
      { id: "a", label: "Base", type: "dynamic", required: true },
      { id: "b", label: "Blend", type: "dynamic", required: true },
    ],
    outputs: singleOutput("dynamic"),
    parameters: [
      { control: "range", key: "opacity", label: "Opacity", defaultValue: 0.54, min: 0, max: 1, step: 0.01 },
    ],
    defaultValues: { opacity: 0.54 },
    summarize: (values) =>
      `${Math.round((values.opacity ?? 0.5) * 100)}% opacity`,
    evaluate: ({ values, sampleInput }) => {
      const a = sampleInput("a");
      const b = sampleInput("b");
      const opacity = clamp(values.opacity ?? 0.5);
      return [
        a[0] + (b[0] - a[0]) * opacity,
        a[1] + (b[1] - a[1]) * opacity,
        a[2] + (b[2] - a[2]) * opacity,
        1,
      ];
    },
  },
  {
    kind: "maskedBlend",
    version: 1,
    label: "Masked blend",
    category: "blend",
    description: "Mixes two streams using a third stream as the mask.",
    userCreatable: true,
    inputs: [
      { id: "a", label: "Base", type: "dynamic", required: true },
      { id: "b", label: "Blend", type: "dynamic", required: true },
      { id: "mask", label: "Mask", type: "scalar", required: true },
    ],
    outputs: singleOutput("dynamic"),
    parameters: [
      { control: "range", key: "opacity", label: "Opacity", defaultValue: 1, min: 0, max: 1, step: 0.01 },
    ],
    defaultValues: { opacity: 1 },
    summarize: (values) => `${Math.round((values.opacity ?? 1) * 100)}% masked`,
    evaluate: ({ values, sampleInput }) => mixColor(
      sampleInput("a"),
      sampleInput("b"),
      sampleInput("mask")[0] * (values.opacity ?? 1),
    ),
  },
  {
    kind: "channels",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        outputPortRenames: {
          red: "r",
          green: "g",
          blue: "b",
          alpha: "a",
        },
      },
    ],
    label: "Split channels",
    category: "filter",
    description: "Split a color stream into independent scalar channels.",
    userCreatable: true,
    inputs: [
      { id: "in", label: "Color", type: "dynamic", required: true },
    ],
    outputs: [
      { id: "r", label: "Red", type: "scalar" },
      { id: "g", label: "Green", type: "scalar" },
      { id: "b", label: "Blue", type: "scalar" },
      { id: "a", label: "Alpha", type: "scalar" },
    ],
    parameters: [],
    defaultValues: {},
    summarize: () => "R · G · B · A",
    evaluate: ({ sampleInput }) => {
      const [red, green, blue, alpha] = sampleInput("in");
      return {
        r: [red, red, red, 1],
        g: [green, green, green, 1],
        b: [blue, blue, blue, 1],
        a: [alpha, alpha, alpha, 1],
      };
    },
  },
  {
    kind: "combineChannels",
    version: 1,
    label: "Combine channels",
    category: "filter",
    description: "Combines scalar red, green, blue, and alpha inputs into color.",
    userCreatable: true,
    inputs: [
      { id: "r", label: "Red", type: "scalar", required: true },
      { id: "g", label: "Green", type: "scalar", required: true },
      { id: "b", label: "Blue", type: "scalar", required: true },
      { id: "a", label: "Alpha", type: "scalar" },
    ],
    outputs: singleOutput("color"),
    parameters: [],
    defaultValues: {},
    summarize: () => "R · G · B · A",
    evaluate: ({ sampleInput, isInputConnected }) => [
      sampleInput("r")[0],
      sampleInput("g")[0],
      sampleInput("b")[0],
      isInputConnected("a") ? sampleInput("a")[0] : 1,
    ],
  },
  {
    kind: "roughness",
    version: 1,
    label: "Roughness",
    category: "input",
    description: "Linear surface roughness.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "value", label: "Roughness", defaultValue: 0.58, min: 0, max: 1, step: 0.01 },
    ],
    defaultValues: { value: 0.58 },
    summarize: (values) => (values.value ?? 0.5).toFixed(2),
    evaluate: ({ values }) => {
      const value = clamp(values.value ?? 0.5);
      return [value, value, value, 1];
    },
  },
  {
    kind: "metallic",
    version: 1,
    label: "Metallic",
    category: "input",
    description: "Metal-versus-dielectric response.",
    userCreatable: true,
    inputs: [],
    outputs: singleOutput("scalar"),
    parameters: [
      { control: "range", key: "value", label: "Metalness", defaultValue: 0.82, min: 0, max: 1, step: 0.01 },
    ],
    defaultValues: { value: 0.82 },
    summarize: (values) => (values.value ?? 0.5).toFixed(2),
    evaluate: ({ values }) => {
      const value = clamp(values.value ?? 0.5);
      return [value, value, value, 1];
    },
  },
  {
    kind: "normal",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        parameterRenames: {
          intensity: "strength",
        },
        addedDefaults: {
          strength: 1.35,
        },
        inputPortRenames: {
          source: "height",
        },
      },
    ],
    label: "Normal from height",
    category: "filter",
    description: "Derive a tangent-space normal map.",
    userCreatable: true,
    inputs: [{ id: "height", label: "Height", type: "scalar", required: true }],
    outputs: singleOutput("normal", "normal"),
    parameters: [
      { control: "range", key: "strength", label: "Strength", defaultValue: 1.35, min: 0, max: 4, step: 0.01 },
    ],
    defaultValues: { strength: 1.35 },
    summarize: (values) => `${(values.strength ?? 1).toFixed(2)} strength`,
    evaluate: ({ sampleInput }) => sampleInput("height"),
  },
  {
    kind: "textureMap",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        addedDefaults: {
          mapChannel: "baseColor",
        },
      },
    ],
    label: "Generated map",
    category: "input",
    description: "A generated map linked to the current source texture.",
    userCreatable: false,
    inputs: [],
    outputs: singleOutput("texture"),
    parameters: [],
    defaultValues: { mapChannel: "baseColor", enabled: true },
    summarize: (values) =>
      `${values.mapChannel ?? "texture"}${values.enabled === false ? " · disabled" : " · generated"}`,
    evaluate: ({ values, sampleTextureMap }) => {
      const channel = values.mapChannel ?? "baseColor";
      return values.enabled === false
        ? textureMapFallbacks[channel]
        : sampleTextureMap(channel);
    },
  },
  {
    kind: "output",
    version: 2,
    migrations: [
      {
        fromVersion: 1,
        toVersion: 2,
        inputPortRenames: {
          albedo: "baseColor",
          ambientOcclusion: "ao",
          metalness: "metallic",
        },
      },
    ],
    label: "PBR material",
    category: "output",
    description: "The final physically based material channels.",
    userCreatable: false,
    inputs: [
      { id: "baseColor", label: "Base color", type: "color", required: true },
      { id: "normal", label: "Normal", type: "normal" },
      { id: "roughness", label: "Roughness", type: "scalar" },
      { id: "metallic", label: "Metallic", type: "scalar" },
      { id: "height", label: "Height", type: "scalar" },
      { id: "ao", label: "AO", type: "scalar" },
    ],
    outputs: [],
    parameters: [],
    defaultValues: {},
    summarize: () => "Metallic / roughness",
  },
];

const definitionsByKind = new Map(
  MATERIAL_NODE_DEFINITIONS.map((definition) => [definition.kind, definition]),
);

export function getMaterialNodeDefinition(kind: MaterialNodeKind) {
  const definition = definitionsByKind.get(kind);
  if (!definition) throw new Error(`Unknown material node kind: ${kind}`);
  return definition;
}

export const NODE_LIBRARY = MATERIAL_NODE_DEFINITIONS.filter(
  (definition) => definition.userCreatable,
);

export function normalizeMaterialNodeValues(
  kind: MaterialNodeKind,
  storedValues: Readonly<Record<string, unknown>>,
): NodeValueMap {
  const definition = getMaterialNodeDefinition(kind);
  const normalized: NodeValueMap = {};

  for (const parameter of definition.parameters) {
    const value = storedValues[parameter.key];
    if (parameter.control === "color") {
      normalized[parameter.key] =
        typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
          ? value
          : parameter.defaultValue;
      continue;
    }

    if (parameter.control === "select") {
      normalized[parameter.key] =
        typeof value === "string" &&
        parameter.options.some((option) => option.value === value)
          ? (value as NodeSelectValue)
          : parameter.defaultValue;
      continue;
    }

    const number =
      typeof value === "number" && Number.isFinite(value)
        ? value
        : parameter.defaultValue;
    normalized[parameter.key] = clamp(number, parameter.min, parameter.max);
  }

  if (kind === "textureMap") {
    const mapChannel = storedValues.mapChannel;
    normalized.mapChannel =
      typeof mapChannel === "string" &&
      MATERIAL_TEXTURE_CHANNELS.includes(mapChannel as TextureMapChannel)
        ? (mapChannel as TextureMapChannel)
        : "baseColor";
    normalized.enabled =
      typeof storedValues.enabled === "boolean"
        ? storedValues.enabled
        : true;
    if (typeof storedValues.thumbnail === "string") {
      normalized.thumbnail = storedValues.thumbnail;
    }
  }

  return normalized;
}

export type MigratedMaterialNodeState = {
  version: number;
  values: NodeValueMap;
  inputPortRenames: Readonly<Record<string, string>>;
  outputPortRenames: Readonly<Record<string, string>>;
};

function accumulatePortRenames(
  accumulated: Record<string, string>,
  renames: Readonly<Record<string, string>> | undefined,
) {
  if (!renames) return;
  for (const [from, to] of Object.entries(renames)) {
    for (const [original, current] of Object.entries(accumulated)) {
      if (current === from) accumulated[original] = to;
    }
    accumulated[from] = to;
  }
}

export function migrateMaterialNodeState(
  kind: MaterialNodeKind,
  storedVersion: number | undefined,
  storedValues: Readonly<Record<string, unknown>>,
): MigratedMaterialNodeState {
  const definition = getMaterialNodeDefinition(kind);
  let version = storedVersion ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${definition.label} has an invalid node version.`);
  }
  if (version > definition.version) {
    throw new Error(
      `${definition.label} node version ${version} is newer than supported version ${definition.version}.`,
    );
  }

  const values: Record<string, unknown> = { ...storedValues };
  const inputPortRenames: Record<string, string> = {};
  const outputPortRenames: Record<string, string> = {};
  const migrationsByVersion = new Map(
    (definition.migrations ?? []).map((migration) => [
      migration.fromVersion,
      migration,
    ]),
  );

  while (version < definition.version) {
    const migration = migrationsByVersion.get(version);
    if (!migration || migration.toVersion <= version) {
      throw new Error(
        `${definition.label} cannot migrate from node version ${version}.`,
      );
    }
    for (const [from, to] of Object.entries(
      migration.parameterRenames ?? {},
    )) {
      if (!Object.hasOwn(values, to) && Object.hasOwn(values, from)) {
        values[to] = values[from];
      }
      delete values[from];
    }
    for (const [key, defaultValue] of Object.entries(
      migration.addedDefaults ?? {},
    )) {
      if (!Object.hasOwn(values, key) && defaultValue !== undefined) {
        values[key] = defaultValue;
      }
    }
    accumulatePortRenames(inputPortRenames, migration.inputPortRenames);
    accumulatePortRenames(outputPortRenames, migration.outputPortRenames);
    version = migration.toVersion;
  }

  return {
    version,
    values: normalizeMaterialNodeValues(kind, values),
    inputPortRenames,
    outputPortRenames,
  };
}

export function createMaterialNodeData(
  kind: MaterialNodeKind,
  overrides: {
    label?: string;
    values?: Partial<NodeValueMap>;
  } = {},
) {
  const definition = getMaterialNodeDefinition(kind);
  return {
    label: overrides.label ?? definition.label,
    kind,
    category: definition.category,
    version: definition.version,
    values: normalizeMaterialNodeValues(kind, {
      ...definition.defaultValues,
      ...overrides.values,
    }),
  };
}
