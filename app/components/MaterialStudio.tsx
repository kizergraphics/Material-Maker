"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  BoxIcon,
  BookOpen,
  Check,
  Circle,
  CircleDot,
  CloudOff,
  Command,
  Download,
  FileImage,
  FileArchive,
  GitBranch,
  Grid3X3,
  Layers3,
  Maximize2,
  Menu,
  MonitorUp,
  MoreHorizontal,
  Plus,
  Redo2,
  RotateCw,
  Search,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  createMaterialPack,
  deleteProjectLocal,
  downloadBlob,
  getCachedProjectMapBlob,
  getCachedProjectMapBlobs,
  importMaterialPack,
  loadProjectsLocal,
  saveProjectLocal,
} from "../core/material-persistence";
import {
  compileMaterialGraph,
  validateMaterialConnection,
} from "../core/material-graph-compiler";
import { useMaterialStore } from "../core/material-store";
import {
  evaluateNodeMap,
  type MaterialEvaluation,
} from "../core/material-evaluator";
import {
  projectForGraphWorker,
  type GraphEvaluationWorkerRequest,
  type GraphEvaluationWorkerResponse,
} from "../core/graph-evaluation-worker-types";
import {
  importSourceTexture,
  pixelsForChannel,
} from "../core/texture-generator";
import { useMaterialEvaluation } from "../core/use-material-evaluation";
import {
  NODE_LIBRARY,
  getMaterialNodeDefinition,
  type MaterialNodeKind,
  type NodeValueMap,
} from "../core/material-node-registry";
import {
  type MaterialGraphNode,
  type MaterialProject,
  type PreviewChannel,
  type PreviewShape,
  type TextureMapChannel,
} from "../core/material-types";
import { browserWorkerUrl } from "../core/worker-url";
import {
  DeferredMaterialPreview,
  DeferredTextureMapInspector,
  DeferredTextureMapWorkbench,
  prewarmDeferredMaterialTools,
} from "./DeferredMaterialTools";
import { MaterialNode } from "./MaterialNode";

const nodeTypes: NodeTypes = { materialNode: MaterialNode };

const channelLabels: Array<{ id: PreviewChannel; label: string }> = [
  { id: "material", label: "Material" },
  { id: "baseColor", label: "Albedo" },
  { id: "height", label: "Height" },
  { id: "normal", label: "Normal" },
  { id: "roughness", label: "Rough" },
  { id: "metallic", label: "Metal" },
  { id: "ao", label: "AO" },
];

const shapeIcons: Record<PreviewShape, typeof Circle> = {
  sphere: Circle,
  cube: BoxIcon,
  plane: Square,
};

const generatedMapChannels: TextureMapChannel[] = [
  "baseColor",
  "height",
  "normal",
  "roughness",
  "metallic",
  "ao",
];
const GRAPH_THUMBNAIL_DELAY_MS = 50;

const mapDownloadNames: Record<TextureMapChannel, string> = {
  baseColor: "base-color",
  height: "height",
  normal: "normal",
  roughness: "roughness",
  metallic: "metallic",
  ao: "ambient-occlusion",
};

function safeDownloadName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "material";
}

function createThumbnail(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const source = document.createElement("canvas");
  source.width = width;
  source.height = height;
  const sourceContext = source.getContext("2d");
  const thumbnail = document.createElement("canvas");
  thumbnail.width = 96;
  thumbnail.height = 96;
  const thumbnailContext = thumbnail.getContext("2d");
  if (!sourceContext || !thumbnailContext) return "";
  sourceContext.putImageData(
    new ImageData(new Uint8ClampedArray(pixels), width, height),
    0,
    0,
  );
  thumbnailContext.drawImage(source, 0, 0, 96, 96);
  return thumbnail.toDataURL("image/webp", 0.82);
}

function createMapThumbnails(evaluation: MaterialEvaluation) {
  return Object.fromEntries(generatedMapChannels.map((channel) => {
    return [
      channel,
      createThumbnail(
        pixelsForChannel(evaluation, channel),
        evaluation.width,
        evaluation.height,
      ),
    ];
  })) as Partial<Record<TextureMapChannel, string>>;
}

type GraphThumbnailCacheEntry = {
  signature: string;
  pixels?: Uint8ClampedArray;
  width: number;
  height: number;
  thumbnail: string;
};

function nodeValueSignature(node: MaterialGraphNode) {
  return Object.entries(node.data.values)
    .filter(([key]) => key !== "thumbnail")
    .sort(([left], [right]) => left.localeCompare(right));
}

function graphNodeSignature(
  nodeId: string,
  nodesById: Map<string, MaterialGraphNode>,
  edges: MaterialProject["edges"],
  signatures: Map<string, string>,
  stack = new Set<string>(),
): string {
  const cached = signatures.get(nodeId);
  if (cached) return cached;
  const node = nodesById.get(nodeId);
  if (!node) return `missing:${nodeId}`;
  if (stack.has(nodeId)) return `cycle:${nodeId}`;

  stack.add(nodeId);
  const inputs = edges
    .map((edge, index) => ({ edge, index }))
    .filter(({ edge }) => edge.target === nodeId)
    .map(({ edge, index }) => [
      index,
      edge.targetHandle ?? "",
      edge.sourceHandle ?? "",
      graphNodeSignature(edge.source, nodesById, edges, signatures, stack),
    ]);
  stack.delete(nodeId);

  const signature = JSON.stringify([
    node.data.kind,
    nodeValueSignature(node),
    inputs,
  ]);
  signatures.set(nodeId, signature);
  return signature;
}

type PendingGraphThumbnail = {
  nodeId: string;
  signature: string;
};

function planGraphNodeThumbnails(
  nodes: MaterialGraphNode[],
  edges: MaterialProject["edges"],
  evaluation: MaterialEvaluation,
  cache: Map<string, GraphThumbnailCacheEntry>,
) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const signatures = new Map<string, string>();
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  for (const nodeId of cache.keys()) {
    if (!liveNodeIds.has(nodeId)) cache.delete(nodeId);
  }

  const thumbnails: Record<string, string> = {};
  const pending: PendingGraphThumbnail[] = [];

  for (const node of nodes) {
    const mapChannel = node.data.values.mapChannel;
    if (
      node.data.kind === "textureMap" &&
      mapChannel &&
      generatedMapChannels.includes(mapChannel)
    ) {
      const pixels = pixelsForChannel(evaluation, mapChannel);
      const signature = `generated:${mapChannel}`;
      const cached = cache.get(node.id);
      if (
        cached?.signature === signature &&
        cached.pixels === pixels &&
        cached.width === evaluation.width &&
        cached.height === evaluation.height
      ) {
        thumbnails[node.id] = cached.thumbnail;
        continue;
      }
      const thumbnail = createThumbnail(
        pixels,
        evaluation.width,
        evaluation.height,
      );
      cache.set(node.id, {
        signature,
        pixels,
        width: evaluation.width,
        height: evaluation.height,
        thumbnail,
      });
      thumbnails[node.id] = thumbnail;
      continue;
    }

    if (node.data.kind === "output") {
      const signature = "output:albedo";
      const cached = cache.get(node.id);
      if (
        cached?.signature === signature &&
        cached.pixels === evaluation.albedo &&
        cached.width === evaluation.width &&
        cached.height === evaluation.height
      ) {
        thumbnails[node.id] = cached.thumbnail;
        continue;
      }
      const thumbnail = createThumbnail(
        evaluation.albedo,
        evaluation.width,
        evaluation.height,
      );
      cache.set(node.id, {
        signature,
        pixels: evaluation.albedo,
        width: evaluation.width,
        height: evaluation.height,
        thumbnail,
      });
      thumbnails[node.id] = thumbnail;
      continue;
    }

    const signature = graphNodeSignature(
      node.id,
      nodesById,
      edges,
      signatures,
    );
    const cached = cache.get(node.id);
    if (cached?.signature === signature) {
      thumbnails[node.id] = cached.thumbnail;
      continue;
    }
    thumbnails[node.id] = cached?.thumbnail ?? "";
    pending.push({ nodeId: node.id, signature });
  }

  return { thumbnails, pending };
}

function evaluateGraphNodeMapsInWorker(
  worker: Worker,
  nodes: MaterialGraphNode[],
  edges: MaterialProject["edges"],
  nodeIds: string[],
) {
  return new Promise<Record<string, Uint8ClampedArray>>((resolve, reject) => {
    worker.onmessage = (
      event: MessageEvent<GraphEvaluationWorkerResponse>,
    ) => {
      const response = event.data;
      if (response.requestId !== 1) return;
      if (response.type === "error") {
        reject(new Error(response.message));
        return;
      }
      if (response.type !== "node-maps-evaluated") return;
      resolve(response.maps);
    };
    worker.onerror = () => {
      reject(new Error("The graph thumbnail worker failed."));
    };
    const request: GraphEvaluationWorkerRequest = {
      type: "evaluate-node-maps",
      requestId: 1,
      project: projectForGraphWorker(nodes, edges),
      nodeIds,
      size: 64,
    };
    worker.postMessage(request);
  });
}

const nodeHelp = [
  { name: "Base color", purpose: "Sets the surface color. Use it as a solid starting layer or as one side of a blend." },
  { name: "Value noise", purpose: "Creates repeatable procedural variation. Use Scale for feature size and Seed for a new pattern." },
  { name: "Levels", purpose: "Remaps dark, mid, and bright values. Use it to sharpen masks or control how much of a noise pattern appears." },
  { name: "Blend", purpose: "Mixes two inputs. Connect a base surface to Base and scratches, dirt, or noise to Blend." },
  { name: "Split channels", purpose: "Breaks a color stream into red, green, blue, and alpha scalar outputs for masks or packed-map workflows." },
  { name: "Roughness", purpose: "Controls reflection sharpness. Low values look polished; high values look matte or chalky." },
  { name: "Metallic", purpose: "Separates metal from non-metal. Use 1 for bare metal and 0 for paint, stone, wood, or plastic." },
  { name: "Normal from height", purpose: "Turns grayscale height detail into surface direction. Increase Strength carefully to avoid inflated detail." },
  { name: "Generated map", purpose: "Represents a map sent from Map Lab. Enabled generated maps connect directly to the matching material input." },
  { name: "PBR material", purpose: "The final output. Connect color, normal, roughness, metallic, height, and AO here for preview and export." },
];

function GraphHelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <aside className="graph-help-panel" aria-label="Graph node help">
      <header>
        <div><span className="eyebrow">Graph guide</span><h2>Nodes & recipes</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close graph help"><X size={15} /></button>
      </header>
      <p className="graph-help-intro">Connect nodes from left to right. Drag from an output dot to a labeled input on another node.</p>
      <div className="graph-help-node-list">
        {nodeHelp.map((item) => <section key={item.name}><strong>{item.name}</strong><p>{item.purpose}</p></section>)}
      </div>
      <div className="graph-help-recipes">
        <span className="eyebrow">Quick recipes</span>
        <section><strong>Weathered metal</strong><p>Color + Noise → Blend → Base color. Noise → Levels → Normal. Add high Metallic and medium Roughness.</p></section>
        <section><strong>Painted surface</strong><p>Blend a paint color with subtle noise. Keep Metallic at 0 and use Roughness around 0.55–0.8.</p></section>
        <section><strong>Image workflow</strong><p>Create maps in Map Lab, choose which maps are enabled, then use “Send maps to graph.”</p></section>
      </div>
    </aside>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-field">
      <span className="range-field__label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value.toFixed(step < 1 ? 2 : 0)}</output>
    </label>
  );
}

function NodeInspector({ node }: { node: MaterialGraphNode | null }) {
  const updateNodeValue = useMaterialStore((state) => state.updateNodeValue);
  if (!node) {
    return (
      <div className="inspector-empty">
        <SlidersHorizontal size={20} />
        <strong>No node selected</strong>
        <span>Select a node to edit its parameters.</span>
      </div>
    );
  }

  const update = (values: Partial<NodeValueMap>) => updateNodeValue(node.id, values);
  const values = node.data.values;
  const definition = getMaterialNodeDefinition(node.data.kind);

  return (
    <div className="inspector-form">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">Selected node</span>
          <h3>{node.data.label}</h3>
        </div>
        <span className={`node-kind-tag node-kind-tag--${node.data.category}`}>
          {node.data.kind}
        </span>
      </div>

      {definition.parameters.map((parameter) =>
        parameter.control === "color" ? (
          <label className="color-field" key={parameter.key}>
            <span>{parameter.label}</span>
            <span className="color-field__control">
              <input
                type="color"
                value={
                  typeof values[parameter.key] === "string"
                    ? values[parameter.key]
                    : parameter.defaultValue
                }
                onChange={(event) =>
                  update({ [parameter.key]: event.target.value })
                }
              />
              <code>
                {typeof values[parameter.key] === "string"
                  ? values[parameter.key]
                  : parameter.defaultValue}
              </code>
            </span>
          </label>
        ) : (
          <RangeField
            key={parameter.key}
            label={parameter.label}
            value={
              (values[parameter.key] as number | undefined) ??
              parameter.defaultValue
            }
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={(value) => update({ [parameter.key]: value })}
          />
        ),
      )}

      {node.data.kind === "textureMap" ? (
        <div className="map-overview">
          <FileImage size={17} />
          <div><strong>Generated {node.data.values.mapChannel}</strong><span>This node stays linked to the current Image-to-Material settings.</span></div>
        </div>
      ) : null}

      {node.data.kind === "output" ? (
        <div className="output-map-list">
          {[
            ["Base color", "sRGB"],
            ["Normal", "Linear"],
            ["Roughness", "Linear"],
            ["Metallic", "Linear"],
            ["Height", "Linear"],
            ["Ambient occlusion", "Linear"],
          ].map(([label, space]) => (
            <div key={label}>
              <span><CircleDot size={12} />{label}</span>
              <code>{space}</code>
            </div>
          ))}
        </div>
      ) : null}

      <div className="inspector-note">
        <ShieldCheck size={14} />
        <span>Deterministic · MaterialX-portable subset</span>
      </div>
    </div>
  );
}

function StudioWorkspace() {
  const reactFlow = useReactFlow();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const albedoInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState("");
  const [saveState, setSaveState] = useState<"loading" | "idle" | "saved" | "saving" | "error">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [downloadingMaps, setDownloadingMaps] = useState(false);
  const [isCompactMenuOpen, setCompactMenuOpen] = useState(false);
  const [rendererLabel, setRendererLabel] = useState("WebGL2 renderer");
  const [workspaceView, setWorkspaceView] = useState<"graph" | "maps">("graph");
  const [savedProjects, setSavedProjects] = useState<MaterialProject[]>([]);
  const [isHelpOpen, setHelpOpen] = useState(false);
  const [graphNodeThumbnails, setGraphNodeThumbnails] = useState<Record<string, string>>({});
  const graphThumbnailCacheRef = useRef(
    new Map<string, GraphThumbnailCacheEntry>(),
  );

  const projectId = useMaterialStore((state) => state.projectId);
  const projectName = useMaterialStore((state) => state.projectName);
  const nodes = useMaterialStore((state) => state.nodes);
  const edges = useMaterialStore((state) => state.edges);
  const preview = useMaterialStore((state) => state.preview);
  const sourceTexture = useMaterialStore((state) => state.sourceTexture);
  const mapSettings = useMaterialStore((state) => state.mapSettings);
  const exportResolution = useMaterialStore((state) => state.exportResolution);
  const selectedNodeId = useMaterialStore((state) => state.selectedNodeId);
  const hydrated = useMaterialStore((state) => state.hydrated);
  const hasActiveProject = useMaterialStore((state) => state.hasActiveProject);
  const pastLength = useMaterialStore((state) => state.past.length);
  const futureLength = useMaterialStore((state) => state.future.length);
  const setProjectName = useMaterialStore((state) => state.setProjectName);
  const onNodesChange = useMaterialStore((state) => state.onNodesChange);
  const onEdgesChange = useMaterialStore((state) => state.onEdgesChange);
  const onConnect = useMaterialStore((state) => state.onConnect);
  const addNode = useMaterialStore((state) => state.addNode);
  const syncGeneratedMapsToGraph = useMaterialStore((state) => state.syncGeneratedMapsToGraph);
  const setSelectedNode = useMaterialStore((state) => state.setSelectedNode);
  const checkpoint = useMaterialStore((state) => state.checkpoint);
  const undo = useMaterialStore((state) => state.undo);
  const redo = useMaterialStore((state) => state.redo);
  const setShape = useMaterialStore((state) => state.setShape);
  const setChannel = useMaterialStore((state) => state.setChannel);
  const togglePreview = useMaterialStore((state) => state.togglePreview);
  const replaceProject = useMaterialStore((state) => state.replaceProject);
  const closeProject = useMaterialStore((state) => state.closeProject);
  const newProject = useMaterialStore((state) => state.newProject);
  const setHydrated = useMaterialStore((state) => state.setHydrated);
  const setSourceTexture = useMaterialStore((state) => state.setSourceTexture);
  const removeSourceTexture = useMaterialStore((state) => state.removeSourceTexture);
  const updateMapSettings = useMaterialStore((state) => state.updateMapSettings);
  const resetMapSettings = useMaterialStore((state) => state.resetMapSettings);
  const setExportResolution = useMaterialStore((state) => state.setExportResolution);

  const {
    evaluation,
    sourceEvaluation,
    isGenerating,
    error: generationError,
  } = useMaterialEvaluation(
    { nodes, edges, sourceTexture, mapSettings },
    256,
  );
  const mapLabEvaluation = sourceEvaluation ?? evaluation;
  const compiledGraph = useMemo(
    () => compileMaterialGraph({ nodes, edges }),
    [edges, nodes],
  );
  const graphNodes = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      deletable: node.data.kind !== "output",
      data: {
        ...node.data,
        validationIssues:
          compiledGraph.diagnosticsByNode
            .get(node.id)
            ?.map((diagnostic) => diagnostic.message) ?? [],
        values: {
          ...node.data.values,
          thumbnail: graphNodeThumbnails[node.id] || node.data.values.thumbnail,
        },
      },
    }));
  }, [compiledGraph, graphNodeThumbnails, nodes, selectedNodeId]);
  const graphConnectionStatus = useMemo(() => {
    const error = compiledGraph.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    if (error) {
      return {
        title: "Graph needs attention",
        detail: error.message,
        ready: false,
      };
    }
    const warning = compiledGraph.diagnostics[0];
    if (warning) {
      return {
        title: "Graph is incomplete",
        detail: warning.message,
        ready: false,
      };
    }
    return {
      title: "Live graph",
      detail: "Connected changes update the preview",
      ready: true,
    };
  }, [compiledGraph]);
  const isValidMaterialConnection = useCallback(
    (connection: Parameters<typeof validateMaterialConnection>[1]) =>
      validateMaterialConnection({ nodes, edges }, connection).valid,
    [edges, nodes],
  );

  useEffect(() => {
    if (workspaceView !== "graph") return;
    let active = true;
    let worker: Worker | null = null;
    let timer = 0;
    const frame = window.requestAnimationFrame(() => {
      const plan = planGraphNodeThumbnails(
        nodes,
        edges,
        mapLabEvaluation,
        graphThumbnailCacheRef.current,
      );
      if (!plan.pending.length) {
        if (active) setGraphNodeThumbnails(plan.thumbnails);
        return;
      }

      timer = window.setTimeout(() => {
        const nodeIds = plan.pending.map(({ nodeId }) => nodeId);
        const evaluateOnMainThread = () =>
          Object.fromEntries(
            nodeIds.map((nodeId) => [
              nodeId,
              evaluateNodeMap(
                { nodes, edges },
                nodeId,
                64,
                sourceEvaluation,
              ),
            ]),
          );
        let request: Promise<Record<string, Uint8ClampedArray>>;
        if (typeof Worker === "undefined" || sourceEvaluation) {
          request = Promise.resolve(evaluateOnMainThread());
        } else {
          request = Promise.resolve()
            .then(() => {
              worker = new Worker(
                browserWorkerUrl(
                  new URL(
                    "../workers/graph-evaluation.worker.ts",
                    import.meta.url,
                  ),
                ),
                { type: "module", name: "forge-graph-thumbnails" },
              );
              return evaluateGraphNodeMapsInWorker(
                worker,
                nodes,
                edges,
                nodeIds,
              );
            })
            .catch(() => evaluateOnMainThread());
        }

        void request
          .then((maps) => {
            if (!active) return;
            for (const { nodeId, signature } of plan.pending) {
              const pixels = maps[nodeId];
              if (!pixels) continue;
              const thumbnail = createThumbnail(pixels, 64, 64);
              graphThumbnailCacheRef.current.set(nodeId, {
                signature,
                width: 64,
                height: 64,
                thumbnail,
              });
              plan.thumbnails[nodeId] = thumbnail;
            }
            setGraphNodeThumbnails(plan.thumbnails);
          })
          .finally(() => {
            worker?.terminate();
            worker = null;
          });
      }, GRAPH_THUMBNAIL_DELAY_MS);
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      worker?.terminate();
    };
  }, [
    edges,
    mapLabEvaluation,
    nodes,
    sourceEvaluation,
    workspaceView,
  ]);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const selectedMapChannel =
    selectedNode?.data.kind === "textureMap"
      ? selectedNode.data.values.mapChannel ?? null
      : null;
  const selectGraphNode = useCallback(
    (node: MaterialGraphNode) => {
      setSelectedNode(node.id);
      if (node.data.kind === "textureMap" && node.data.values.mapChannel) {
        setChannel(node.data.values.mapChannel);
      }
    },
    [setChannel, setSelectedNode],
  );

  const filteredLibrary = useMemo(() => {
    const query = search.trim().toLowerCase();
    return NODE_LIBRARY.filter(
      (item) =>
        !query ||
        item.label.toLowerCase().includes(query) ||
        item.category.toLowerCase().includes(query),
    );
  }, [search]);

  useEffect(() => {
    let active = true;
    if ("gpu" in navigator) setRendererLabel("WebGPU available");
    loadProjectsLocal()
      .then(async (projects) => {
        if (!active) return;
        const savedMaterials = projects.filter((project) => project.id !== "oxidized-alloy");
        if (savedMaterials.length !== projects.length) {
          await deleteProjectLocal("oxidized-alloy");
        }
        if (!active) return;
        setSavedProjects(savedMaterials);
        setHydrated(true);
        setSaveState("idle");
      })
      .catch(() => {
        if (!active) return;
        setHydrated(true);
        setSaveState("error");
      });
    return () => {
      active = false;
    };
  }, [setHydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const connection = (
      navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
      }
    ).connection;
    if (
      connection?.saveData ||
      connection?.effectiveType === "slow-2g" ||
      connection?.effectiveType === "2g"
    ) {
      return;
    }

    let timeout = 0;
    let idleCallback = 0;
    const prewarm = () => {
      void prewarmDeferredMaterialTools();
    };
    const requestIdleCallback = (
      window as Partial<Window>
    ).requestIdleCallback;
    if (requestIdleCallback) {
      idleCallback = requestIdleCallback.call(window, prewarm, {
        timeout: 4000,
      });
    } else {
      timeout = window.setTimeout(prewarm, 1500);
    }
    return () => {
      if (idleCallback) window.cancelIdleCallback(idleCallback);
      window.clearTimeout(timeout);
    };
  }, [hydrated]);

  useEffect(() => {
    if (sourceTexture) setWorkspaceView("maps");
    else setWorkspaceView("graph");
  }, [sourceTexture]);

  useEffect(() => {
    if (!hydrated || !hasActiveProject) return;
    setSaveState("saving");
    const timeout = window.setTimeout(() => {
      saveProjectLocal(useMaterialStore.getState().toProject())
        .then(async () => {
          setSaveState("saved");
          setSavedProjects(await loadProjectsLocal());
        })
        .catch(() => setSaveState("error"));
    }, 700);
    return () => window.clearTimeout(timeout);
  }, [edges, exportResolution, hasActiveProject, hydrated, mapSettings, nodes, preview, projectName, sourceTexture]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!useMaterialStore.getState().hasActiveProject) return;
        setSaveState("saving");
        saveProjectLocal(useMaterialStore.getState().toProject())
          .then(async () => {
            setSaveState("saved");
            setSavedProjects(await loadProjectsLocal());
            setNotice("Project saved locally");
          })
          .catch(() => setSaveState("error"));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const handleExport = useCallback(async () => {
    if (!useMaterialStore.getState().hasActiveProject) return;
    setExporting(true);
    try {
      const pack = await createMaterialPack(useMaterialStore.getState().toProject());
      downloadBlob(pack.blob, pack.filename);
      setNotice(`${pack.filename} exported`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, []);

  const handleDownloadAllMaps = useCallback(async () => {
    const state = useMaterialStore.getState();
    if (!state.hasActiveProject || !state.sourceTexture) return;
    const enabledChannels = generatedMapChannels.filter(
      (channel) => state.mapSettings[channel].enabled,
    );
    if (!enabledChannels.length) {
      setNotice("Enable at least one map before downloading");
      return;
    }

    setDownloadingMaps(true);
    try {
      const project = state.toProject();
      const { blobs } = await getCachedProjectMapBlobs(
        project,
        enabledChannels,
      );
      const prefix = safeDownloadName(project.name);
      for (const { channel, blob } of blobs) {
        downloadBlob(blob, `${prefix}-${mapDownloadNames[channel]}.png`);
      }
      setNotice(
        `${enabledChannels.length} enabled map${enabledChannels.length === 1 ? "" : "s"} downloaded`,
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Maps could not be downloaded",
      );
    } finally {
      setDownloadingMaps(false);
    }
  }, []);

  const saveToLibrary = useCallback(async () => {
    if (!useMaterialStore.getState().hasActiveProject) return;
    setSaveState("saving");
    try {
      const project = useMaterialStore.getState().toProject();
      await saveProjectLocal(project);
      setSavedProjects(await loadProjectsLocal());
      setSaveState("saved");
      setNotice(`${project.name} saved to Library`);
    } catch (error) {
      setSaveState("error");
      setNotice(error instanceof Error ? error.message : "Material could not be saved");
    }
  }, []);

  const prepareProjectMapDownload = useCallback(
    async (channel: TextureMapChannel) => {
      const state = useMaterialStore.getState();
      if (!state.hasActiveProject || !state.sourceTexture) {
        throw new Error("Open a source texture before downloading maps.");
      }
      return getCachedProjectMapBlob(state.toProject(), channel);
    },
    [],
  );

  const persistGraphImmediately = useCallback(() => {
    const state = useMaterialStore.getState();
    if (!state.hasActiveProject) return;
    setSaveState("saving");
    void saveProjectLocal(state.toProject())
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("error"));
  }, []);

  const connectGraphNodes = useCallback(
    (connection: Connection) => {
      onConnect(connection);
      persistGraphImmediately();
    },
    [onConnect, persistGraphImmediately],
  );

  const openViewer = useCallback(async () => {
    if (!useMaterialStore.getState().hasActiveProject) {
      window.location.assign("/viewer");
      return;
    }
    setSaveState("saving");
    try {
      await saveProjectLocal(useMaterialStore.getState().toProject());
      window.location.assign("/viewer");
    } catch {
      setSaveState("error");
      setNotice("Save this material before opening the viewer");
    }
  }, []);

  const handleImport = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const project = await importMaterialPack(file);
      replaceProject(project);
      setSaveState("saved");
      setNotice(`${project.name} opened locally`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Import failed");
    }
  }, [replaceProject]);

  const openAlbedoFile = useCallback(async (file: File) => {
    setNotice("Reading albedo and preparing maps…");
    try {
      const source = await importSourceTexture(file);
      setSourceTexture(source);
      setWorkspaceView("maps");
      setNotice(`Generated six editable maps from ${source.name}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The albedo image could not be opened.");
    }
  }, [setSourceTexture]);

  const handleAlbedoImport = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void openAlbedoFile(file);
  }, [openAlbedoFile]);

  const sendMapsToGraph = useCallback(() => {
    syncGeneratedMapsToGraph(createMapThumbnails(mapLabEvaluation));
    setWorkspaceView("graph");
    setNotice("Generated maps added and connected in Graph Lab");
    window.setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 280 }), 0);
  }, [mapLabEvaluation, reactFlow, syncGeneratedMapsToGraph]);

  const addLibraryNode = (kind: MaterialNodeKind) => {
    const index = nodes.length;
    addNode(kind, {
      x: -220 + (index % 4) * 38,
      y: -30 + (index % 6) * 42,
    });
  };

  const openSavedProject = (project: MaterialProject) => {
    replaceProject(project);
    setSaveState("saved");
    setNotice(`${project.name} opened`);
  };

  const deleteSavedProject = async (project: MaterialProject) => {
    if (!window.confirm(`Delete “${project.name}” from this device?`)) return;
    try {
      await deleteProjectLocal(project.id);
      setSavedProjects((projects) => projects.filter((item) => item.id !== project.id));
      if (project.id === projectId) {
        closeProject();
        setSaveState("idle");
      }
      setNotice(`${project.name} deleted`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Material could not be deleted");
    }
  };

  const saveLabel =
    saveState === "saved"
      ? "Saved locally"
      : saveState === "saving"
        ? "Saving…"
        : saveState === "error"
          ? "Storage unavailable"
          : saveState === "idle"
            ? "No material open"
            : "Opening library…";

  return (
    <main className="studio-shell">
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-brand__mark" aria-hidden="true">
            <Layers3 size={19} strokeWidth={1.8} />
          </span>
          <span>FORGE</span>
          <em>Material Studio</em>
        </div>

        <nav className="studio-nav" aria-label="Primary navigation">
          <Link href="/" className="is-active">Studio</Link>
          <Link href="/viewer" onClick={(event) => { event.preventDefault(); void openViewer(); }}>Viewer</Link>
          <button className={isHelpOpen ? "is-active" : ""} onClick={() => setHelpOpen((value) => !value)}><BookOpen size={13} /> Help</button>
        </nav>

        <div className="studio-header__actions">
          <span className={`save-state save-state--${saveState}`}>
            {saveState === "saved" ? <Check size={13} /> : <CloudOff size={13} />}
            {saveLabel}
          </span>
          <button className="button button--ghost header-import" onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} />
            Import
          </button>
          <button
            className="button button--ghost header-download-maps"
            onClick={() => void handleDownloadAllMaps()}
            disabled={!sourceTexture || isGenerating || downloadingMaps}
          >
            {downloadingMaps ? <RotateCw className="spin" size={15} /> : <Download size={15} />}
            {downloadingMaps ? "Preparing mapsâ€¦" : "Download all maps"}
          </button>
          <button className="button button--ghost header-save" onClick={() => void saveToLibrary()} disabled={!hasActiveProject}>
            <Save size={14} /> Save to Library
          </button>
          <button className="button button--primary" onClick={handleExport} disabled={!hasActiveProject || exporting}>
            {exporting ? <RotateCw className="spin" size={15} /> : <Download size={15} />}
            {exporting ? "Baking…" : "Bake & export"}
          </button>
          <button
            className="icon-button compact-menu-button"
            aria-label="Open project menu"
            aria-expanded={isCompactMenuOpen}
            onClick={() => setCompactMenuOpen((value) => !value)}
          >
            <Menu size={17} />
          </button>
        </div>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".mmpack,application/zip"
          onChange={handleImport}
        />
        <input
          ref={albedoInputRef}
          className="visually-hidden"
          type="file"
          accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
          onChange={handleAlbedoImport}
        />
        {isCompactMenuOpen ? (
          <div className="compact-menu">
            <button onClick={() => fileInputRef.current?.click()}><Upload size={14} /> Import package</button>
            <button onClick={() => void handleDownloadAllMaps()} disabled={!sourceTexture || isGenerating || downloadingMaps}>
              <Download size={14} /> Download all maps
            </button>
            <button onClick={() => void saveToLibrary()} disabled={!hasActiveProject}><Save size={14} /> Save to Library</button>
            <button onClick={handleExport} disabled={!hasActiveProject}><Download size={14} /> Export package</button>
            <button onClick={() => setHelpOpen(true)}><BookOpen size={14} /> Graph help</button>
            <Link href="/viewer" onClick={(event) => { event.preventDefault(); void openViewer(); }}><MonitorUp size={14} /> Open viewer</Link>
          </div>
        ) : null}
      </header>

      <div className="project-toolbar">
        <div className="project-title-block">
          <button className="icon-button" aria-label="Open project browser"><FileArchive size={16} /></button>
          <span className="breadcrumb">Local library <span>/</span></span>
          {hasActiveProject ? (
            <>
              <input
                aria-label="Project name"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
              <button className="icon-button" aria-label="More project options"><MoreHorizontal size={16} /></button>
            </>
          ) : (
            <span className="project-title-empty">No material selected</span>
          )}
        </div>
        {hasActiveProject ? <div className="history-controls">
          <div className="workspace-view-switch" aria-label="Workspace view">
            <button className={workspaceView === "graph" ? "is-active" : ""} onClick={() => setWorkspaceView("graph")}>Graph</button>
            <button
              className={workspaceView === "maps" ? "is-active" : ""}
              onClick={() => sourceTexture ? setWorkspaceView("maps") : albedoInputRef.current?.click()}
            >Map Lab</button>
          </div>
          <span className="toolbar-divider" />
          <button className="icon-button" aria-label="Undo" onClick={undo} disabled={!pastLength}><Undo2 size={15} /></button>
          <button className="icon-button" aria-label="Redo" onClick={redo} disabled={!futureLength}><Redo2 size={15} /></button>
          <span className="toolbar-divider" />
          <span className="graph-stat"><Command size={13} /> {nodes.length} nodes · {edges.length} links</span>
        </div> : null}
      </div>

      <section className={`studio-workspace${hasActiveProject ? "" : " studio-workspace--empty"}`}>
        <aside className="library-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Project assets</span>
              <h2>Library</h2>
            </div>
            <button className="icon-button" aria-label="Create material" onClick={newProject}><Plus size={15} /></button>
          </div>

          {hasActiveProject ? (
            <div className="active-material-card">
              <div className="material-orb" aria-hidden="true" />
              <div>
                <strong>{projectName || "Untitled Material"}</strong>
                <span>Active · PBR metal/rough</span>
              </div>
              <Check size={14} />
            </div>
          ) : (
            <div className="active-material-card active-material-card--empty">
              <FileArchive size={17} aria-hidden="true" />
              <div>
                <strong>No material selected</strong>
                <span>Choose a saved material below</span>
              </div>
            </div>
          )}

          <div className="library-section-heading saved-material-heading">
            <span>Saved materials</span>
            <span>{savedProjects.length}</span>
          </div>
          <div className="saved-material-list" aria-label="Saved materials">
            {savedProjects.length ? savedProjects.map((project) => (
              <div key={project.id} className={hasActiveProject && project.id === projectId ? "is-active" : ""}>
                <button onClick={() => openSavedProject(project)}>
                  <span className="saved-material-swatch" aria-hidden="true" />
                  <span><strong>{project.name}</strong><em>{project.sourceTexture ? "Image material" : "Graph material"}</em></span>
                </button>
                <button className="saved-material-delete" onClick={() => void deleteSavedProject(project)} aria-label={`Delete ${project.name}`}>
                  <Trash2 size={13} />
                </button>
              </div>
            )) : <p>Create a material and it will appear here.</p>}
          </div>

          {hasActiveProject ? <>
          {sourceTexture ? (
            <button className="albedo-source-card is-loaded" onClick={() => setWorkspaceView("maps")}>
              <img src={sourceTexture.dataUrl} alt="" />
              <span>
                <em>Source albedo</em>
                <strong>{sourceTexture.name}</strong>
                <small>{sourceTexture.width}×{sourceTexture.height}</small>
              </span>
              <SlidersHorizontal size={14} />
            </button>
          ) : (
            <button className="albedo-source-card" onClick={() => albedoInputRef.current?.click()}>
              <span className="albedo-source-card__icon"><FileImage size={18} /></span>
              <span>
                <strong>Add albedo texture</strong>
                <small>Generate 6 editable PBR maps</small>
              </span>
              <Plus size={14} />
            </button>
          )}

          <div className="library-section-heading">
            <span>Node library</span>
            <span>{filteredLibrary.length}</span>
          </div>
          <label className="node-search">
            <Search size={14} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search nodes"
              aria-label="Search node library"
            />
            {search ? <button onClick={() => setSearch("")} aria-label="Clear search"><X size={12} /></button> : null}
          </label>

          <div className="node-library-list">
            {filteredLibrary.map((item) => (
              <button key={item.kind} onClick={() => addLibraryNode(item.kind)}>
                <span className={`node-library-icon node-library-icon--${item.category}`}>
                  {item.kind === "noise" ? <Sparkles size={14} /> : item.kind === "blend" ? <Layers3 size={14} /> : item.kind === "normal" ? <WandSparkles size={14} /> : <CircleDot size={14} />}
                </span>
                <span><strong>{item.label}</strong><em>{item.category}</em></span>
                <Plus size={13} />
              </button>
            ))}
          </div>
          </> : null}

          <div className="library-footer">
            <ShieldCheck size={14} />
            <span>Files stay on this device</span>
          </div>
        </aside>

        {hasActiveProject ? <>
        {workspaceView === "maps" && sourceTexture ? (
          <DeferredTextureMapWorkbench
            evaluation={mapLabEvaluation}
            source={sourceTexture}
            settings={mapSettings}
            selectedChannel={preview.channel}
            isGenerating={isGenerating}
            error={generationError}
            onSelectChannel={(channel: TextureMapChannel) => setChannel(channel)}
            onChooseSource={() => albedoInputRef.current?.click()}
            onRemoveSource={removeSourceTexture}
            onDropSource={(file) => void openAlbedoFile(file)}
            onSendToGraph={sendMapsToGraph}
          />
        ) : (
        <section className="graph-panel" aria-label="Material node graph">
          <ReactFlow
            nodes={graphNodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connectGraphNodes}
            onNodeClick={(_, node) => selectGraphNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            onNodeDragStart={checkpoint}
            onNodeDragStop={persistGraphImmediately}
            fitView
            fitViewOptions={{ padding: 0.22, minZoom: 0.55, maxZoom: 1.1 }}
            minZoom={0.28}
            maxZoom={1.7}
            snapToGrid
            snapGrid={[12, 12]}
            deleteKeyCode={["Backspace", "Delete"]}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              style: { stroke: "#6a7682", strokeWidth: 1.5 },
            }}
            isValidConnection={isValidMaterialConnection}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#303840" />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) => node.data?.category === "output" ? "#d7904c" : "#65717d"}
              maskColor="rgba(9, 12, 15, .74)"
            />
          </ReactFlow>
          <div className={`graph-callout${graphConnectionStatus.ready ? "" : " is-guidance"}`}>
            <span className="graph-callout__dot" />
            <div>
              <strong>{graphConnectionStatus.title}</strong>
              <span>{graphConnectionStatus.detail}</span>
            </div>
            {sourceTexture ? <button className="button button--ghost" onClick={sendMapsToGraph}><GitBranch size={12} /> Place Map Lab maps</button> : null}
          </div>
        </section>
        )}

        <aside className="preview-panel">
          <div className="preview-panel__header">
            <div>
              <span className="eyebrow">Real-time render</span>
              <h2>Preview</h2>
            </div>
            <div className="shape-picker" aria-label="Preview mesh">
              {(["sphere", "cube", "plane"] as PreviewShape[]).map((shape) => {
                const ShapeIcon = shapeIcons[shape];
                return (
                  <button
                    key={shape}
                    className={preview.shape === shape ? "is-active" : ""}
                    onClick={() => setShape(shape)}
                    aria-label={`Preview on ${shape}`}
                    title={`Preview on ${shape}`}
                  ><ShapeIcon size={14} /></button>
                );
              })}
            </div>
          </div>

          <DeferredMaterialPreview
            evaluation={
              workspaceView === "maps" ? mapLabEvaluation : evaluation
            }
            shape={preview.shape}
            channel={preview.channel}
            showGrid={preview.showGrid}
            autoRotate={preview.autoRotate}
            mapSettings={mapSettings}
          />

          <div className="channel-tabs" aria-label="Preview channel">
            {channelLabels.map((item) => (
              <button
                key={item.id}
                className={`${preview.channel === item.id ? "is-active" : ""}${item.id !== "material" && !mapSettings[item.id].enabled ? " is-disabled" : ""}`}
                onClick={() => {
                  setSelectedNode(null);
                  setChannel(item.id);
                }}
              >{item.label}</button>
            ))}
          </div>

          <div className="preview-options">
            <button className={preview.showGrid ? "is-active" : ""} onClick={() => togglePreview("showGrid")}><Grid3X3 size={13} /> Ground</button>
            <button className={preview.autoRotate ? "is-active" : ""} onClick={() => togglePreview("autoRotate")}><RotateCw size={13} /> Rotate</button>
            <button className={preview.tiled ? "is-active" : ""} onClick={() => togglePreview("tiled")}><Maximize2 size={13} /> Tile 1×</button>
          </div>

          <div className="inspector-panel">
            {workspaceView === "graph" && selectedNode && !selectedMapChannel ? (
              <NodeInspector node={selectedNode} />
            ) : sourceTexture ? (
              <DeferredTextureMapInspector
                channel={preview.channel}
                settings={mapSettings}
                exportResolution={exportResolution}
                projectName={projectName}
                isGenerating={isGenerating}
                onDownloadMap={prepareProjectMapDownload}
                onUpdate={updateMapSettings}
                onChangeStart={checkpoint}
                onReset={resetMapSettings}
                onSetExportResolution={setExportResolution}
              />
            ) : (
              <NodeInspector node={selectedNode} />
            )}
          </div>
        </aside>
        </> : (
          <section className="material-empty-state" aria-label="No material selected">
            <span className="material-empty-state__icon"><FileArchive size={25} /></span>
            <strong>Select a material to begin</strong>
            <p>Choose a saved material from the Library to load its graph, maps, settings, and preview.</p>
            <button className="button button--primary" onClick={newProject}><Plus size={14} /> Create new material</button>
          </section>
        )}
      </section>

      <footer className="studio-statusbar">
        <span><span className="status-dot" /> {rendererLabel}</span>
        <span>Metallic / roughness · Linear workflow</span>
        <span><ShieldCheck size={12} /> Local-only session</span>
      </footer>

      {notice ? <div className="studio-toast" role="status"><Check size={14} />{notice}</div> : null}
      {isHelpOpen ? <GraphHelpPanel onClose={() => setHelpOpen(false)} /> : null}
    </main>
  );
}

export function MaterialStudio() {
  return (
    <ReactFlowProvider>
      <StudioWorkspace />
    </ReactFlowProvider>
  );
}
