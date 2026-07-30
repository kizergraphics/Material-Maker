export const MATERIAL_NODE_KINDS = [
  "color",
  "noise",
  "levels",
  "blend",
  "channels",
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

export type NodeValueMap = {
  color?: string;
  scale?: number;
  contrast?: number;
  seed?: number;
  minimum?: number;
  maximum?: number;
  gamma?: number;
  opacity?: number;
  value?: number;
  strength?: number;
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
      key: "color";
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
        | "strength";
      label: string;
      defaultValue: number;
      min: number;
      max: number;
      step: number;
    };

export type MaterialNodeMigration = {
  fromVersion: number;
  toVersion: number;
  parameterRenames?: Readonly<Record<string, NodeValueKey>>;
  inputPortRenames?: Readonly<Record<string, string>>;
  outputPortRenames?: Readonly<Record<string, string>>;
};

export type MaterialNodeEvaluationContext = {
  u: number;
  v: number;
  values: NodeValueMap;
  sampleInput: (portId: string) => MaterialNodeSample;
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

function tileableNoise(u: number, v: number, scale: number, seed: number) {
  const frequency = Math.max(1, Math.round(scale));
  const x = u * frequency;
  const y = v * frequency;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = (x0 + 1) % frequency;
  const y1 = (y0 + 1) % frequency;
  const wrappedX0 = ((x0 % frequency) + frequency) % frequency;
  const wrappedY0 = ((y0 % frequency) + frequency) % frequency;
  const tx = smooth(x - Math.floor(x));
  const ty = smooth(y - Math.floor(y));
  const a = hash2d(wrappedX0, wrappedY0, seed);
  const b = hash2d(x1, wrappedY0, seed);
  const c = hash2d(wrappedX0, y1, seed);
  const d = hash2d(x1, y1, seed);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
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
    kind: "noise",
    version: 1,
    label: "Value noise",
    category: "generator",
    description: "Deterministic tileable value noise.",
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
      const raw = tileableNoise(
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
    version: 1,
    label: "Generated map",
    category: "input",
    description: "A generated map linked to the current source texture.",
    userCreatable: false,
    inputs: [],
    outputs: singleOutput("texture"),
    parameters: [],
    defaultValues: { enabled: true },
    summarize: (values) =>
      `${values.mapChannel ?? "texture"}${values.enabled === false ? " · disabled" : " · generated"}`,
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
      if (!(to in values) && from in values) values[to] = values[from];
      delete values[from];
    }
    accumulatePortRenames(inputPortRenames, migration.inputPortRenames);
    accumulatePortRenames(outputPortRenames, migration.outputPortRenames);
    version = migration.toVersion;
  }

  return {
    version,
    values: values as NodeValueMap,
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
    values: {
      ...definition.defaultValues,
      ...overrides.values,
    },
  };
}
