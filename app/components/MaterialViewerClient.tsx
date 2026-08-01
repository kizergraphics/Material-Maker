"use client";

import {
  ArrowLeft,
  Box,
  Check,
  Circle,
  FileArchive,
  Grid3X3,
  Layers3,
  LockKeyhole,
  RotateCw,
  Save,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import {
  deleteProjectLocal,
  getCachedProjectMapBlob,
  importMaterialPack,
  loadProjectsLocal,
  saveProjectLocal,
} from "../core/material-persistence";
import { useMaterialEvaluation } from "../core/use-material-evaluation";
import { getMaterialNodeDefinition } from "../core/material-node-registry";
import {
  DEFAULT_MAP_SETTINGS,
  createStarterProject,
  type MapGenerationSettings,
  type MaterialGraphNode,
  type MaterialProject,
  type NodeValueMap,
  type PreviewChannel,
  type PreviewShape,
  type TextureMapChannel,
} from "../core/material-types";
import {
  DeferredMaterialPreview,
  DeferredTextureMapCanvas,
  DeferredTextureMapInspector,
} from "./DeferredMaterialTools";

const channels: Array<{ id: PreviewChannel; label: string }> = [
  { id: "material", label: "Beauty" },
  { id: "baseColor", label: "Base color" },
  { id: "height", label: "Height" },
  { id: "normal", label: "Normal" },
  { id: "roughness", label: "Roughness" },
  { id: "metallic", label: "Metallic" },
  { id: "ao", label: "AO" },
];

const textureChannels: Array<{
  id: TextureMapChannel;
  label: string;
  space: string;
}> = [
  { id: "baseColor", label: "Albedo", space: "sRGB" },
  { id: "height", label: "Height", space: "Linear" },
  { id: "normal", label: "Normal", space: "Linear" },
  { id: "roughness", label: "Roughness", space: "Linear" },
  { id: "metallic", label: "Metallic", space: "Linear" },
  { id: "ao", label: "Ambient occlusion", space: "Linear" },
];

type ViewerPreviewResolution = 256 | 512 | 1024 | 2048;

const viewerPreviewResolutions: Array<{
  value: ViewerPreviewResolution;
  label: string;
}> = [
  { value: 256, label: "256 px" },
  { value: 512, label: "512 px" },
  { value: 1024, label: "1K" },
  { value: 2048, label: "2K" },
];

function ViewerRangeField({
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

function ViewerNodeEditor({
  node,
  onUpdate,
}: {
  node: MaterialGraphNode;
  onUpdate: (values: Partial<NodeValueMap>) => void;
}) {
  const values = node.data.values;
  const definition = getMaterialNodeDefinition(node.data.kind);
  return (
    <div className="viewer-node-editor">
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
                  onUpdate({ [parameter.key]: event.target.value })
                }
              />
              <code>
                {typeof values[parameter.key] === "string"
                  ? values[parameter.key]
                  : parameter.defaultValue}
              </code>
            </span>
          </label>
        ) : parameter.control === "select" ? (
          <label className="select-field" key={parameter.key}>
            <span>{parameter.label}</span>
            <select
              value={
                typeof values[parameter.key] === "string"
                  ? values[parameter.key]
                  : parameter.defaultValue
              }
              onChange={(event) =>
                onUpdate({ [parameter.key]: event.target.value })
              }
            >
              {parameter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <ViewerRangeField
            key={parameter.key}
            label={parameter.label}
            value={
              (values[parameter.key] as number | undefined) ??
              parameter.defaultValue
            }
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={(value) => onUpdate({ [parameter.key]: value })}
          />
        ),
      )}
    </div>
  );
}

export function MaterialViewerClient() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [project, setProject] = useState<MaterialProject>(() => createStarterProject());
  const [channel, setChannel] = useState<PreviewChannel>("material");
  const [shape, setShape] = useState<PreviewShape>("sphere");
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("Example material loaded");
  const [savedProjects, setSavedProjects] = useState<MaterialProject[]>([]);
  const [editorNodeId, setEditorNodeId] = useState("");
  const [previewResolution, setPreviewResolution] =
    useState<ViewerPreviewResolution>(256);
  const evaluationMaxEdge = project.sourceTexture ? previewResolution : 256;
  const { evaluation, isGenerating } = useMaterialEvaluation(
    project,
    evaluationMaxEdge,
  );
  const previewResolutionLabel =
    viewerPreviewResolutions.find(
      (resolution) => resolution.value === previewResolution,
    )?.label ?? `${previewResolution} px`;
  const editableNodes = useMemo(
    () => project.nodes.filter(
      (node) => node.data.kind !== "output" && node.data.kind !== "textureMap",
    ),
    [project.nodes],
  );
  const editorNode = editableNodes.find((node) => node.id === editorNodeId)
    ?? editableNodes.find((node) => node.data.kind === "roughness")
    ?? editableNodes[0];

  useEffect(() => {
    let active = true;
    loadProjectsLocal()
      .then((projects) => {
        if (!active) return;
        setSavedProjects(projects);
        if (projects[0]) {
          setProject(projects[0]);
          setNotice(`${projects[0].name} loaded from your library`);
        }
      })
      .catch(() => setNotice("Saved materials are unavailable in this browser"));
    return () => {
      active = false;
    };
  }, []);

  const openFile = async (file: File) => {
    try {
      const imported = await importMaterialPack(file);
      setProject(imported);
      setChannel("material");
      setShape(imported.preview.shape);
      setShowGrid(imported.preview.showGrid);
      setAutoRotate(imported.preview.autoRotate);
      setNotice(`${imported.name} opened locally`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The package could not be opened.");
    }
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void openFile(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void openFile(file);
  };

  const selectSavedProject = (projectId: string) => {
    const selected = savedProjects.find((item) => item.id === projectId);
    if (!selected) return;
    setProject(selected);
    setChannel("material");
    setShape(selected.preview.shape);
    setShowGrid(selected.preview.showGrid);
    setAutoRotate(selected.preview.autoRotate);
    setNotice(`${selected.name} selected`);
  };

  const updateNodeValue = (nodeId: string, values: Partial<NodeValueMap>) => {
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      nodes: current.nodes.map((node) => (
        node.id === nodeId
          ? {
              ...node,
              data: {
                ...node.data,
                values: { ...node.data.values, ...values },
              },
            }
          : node
      )),
    }));
    setNotice("Tweak applied in the viewer");
  };

  const updateMapSettings = (
    map: keyof MapGenerationSettings,
    values: Record<string, number | boolean>,
  ) => {
    setProject((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      mapSettings: {
        ...current.mapSettings,
        [map]: { ...current.mapSettings[map], ...values },
      } as MapGenerationSettings,
    }));
    setNotice("Map updated in the viewer");
  };

  const changePreviewResolution = (value: string) => {
    const resolution = Number(value) as ViewerPreviewResolution;
    if (
      !viewerPreviewResolutions.some((option) => option.value === resolution)
    ) {
      return;
    }
    setPreviewResolution(resolution);
    const label =
      viewerPreviewResolutions.find((option) => option.value === resolution)
        ?.label ?? `${resolution} px`;
    setNotice(`Regenerating maps at ${label}`);
  };

  const saveTweaks = async () => {
    try {
      const updated = { ...project, updatedAt: new Date().toISOString() };
      await saveProjectLocal(updated);
      setProject(updated);
      setSavedProjects(await loadProjectsLocal());
      setNotice(`${updated.name} tweaks saved locally`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Tweaks could not be saved");
    }
  };

  const deleteSelectedProject = async () => {
    const selected = savedProjects.find((item) => item.id === project.id);
    if (!selected || !window.confirm(`Delete “${selected.name}” from this device?`)) return;
    try {
      await deleteProjectLocal(selected.id);
      const remaining = savedProjects.filter((item) => item.id !== selected.id);
      setSavedProjects(remaining);
      setProject(remaining[0] ?? createStarterProject());
      setChannel("material");
      setNotice(`${selected.name} deleted`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Material could not be deleted");
    }
  };

  return (
    <main
      className={`viewer-shell${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="viewer-header">
        <div className="studio-brand">
          <span className="studio-brand__mark"><Layers3 size={19} /></span>
          <span>FORGE</span>
          <em>Web Viewer</em>
        </div>
        <div className="viewer-header__privacy"><LockKeyhole size={13} /> No files are uploaded</div>
        <div className="viewer-header__actions">
          <Link className="button button--ghost" href="/"><ArrowLeft size={15} /> Studio</Link>
          <button className="button button--primary" onClick={() => inputRef.current?.click()}><Upload size={15} /> Open .mmpack</button>
        </div>
        <input ref={inputRef} className="visually-hidden" type="file" accept=".mmpack,application/zip" onChange={onInput} />
      </header>

      <section className="viewer-stage">
        <DeferredMaterialPreview
          evaluation={evaluation}
          shape={shape}
          channel={channel}
          showGrid={showGrid}
          autoRotate={autoRotate}
          mapSettings={project.mapSettings}
          className="material-preview--viewer"
        />

        <div className="viewer-topline">
          <div>
            <span className="eyebrow">Local material package</span>
            <h1>{project.name}</h1>
          </div>
          <span className="viewer-status">
            <Check size={13} />
            {project.sourceTexture
              ? isGenerating
                ? `Generating ${previewResolutionLabel} maps`
                : `${evaluation.width}\u00d7${evaluation.height} maps ready`
              : "Ready to inspect"}
          </span>
        </div>

        <div className="viewer-channel-rail" aria-label="Material channel">
          {channels.map((item) => (
            <button key={item.id} className={`${channel === item.id ? "is-active" : ""}${item.id !== "material" && !project.mapSettings[item.id].enabled ? " is-disabled" : ""}`} onClick={() => setChannel(item.id)}>
              <span />{item.label}
            </button>
          ))}
        </div>

        <div className="viewer-toolbar">
          <div className="viewer-shapes">
            {([
              ["sphere", Circle],
              ["cube", Box],
              ["plane", Square],
            ] as Array<[PreviewShape, typeof Circle]>).map(([id, Icon]) => (
              <button key={id} className={shape === id ? "is-active" : ""} onClick={() => setShape(id)} aria-label={`Use ${id} preview`}><Icon size={15} /></button>
            ))}
          </div>
          <span />
          <button className={showGrid ? "is-active" : ""} onClick={() => setShowGrid((value) => !value)}><Grid3X3 size={14} /> Ground</button>
          <button className={autoRotate ? "is-active" : ""} onClick={() => setAutoRotate((value) => !value)}><RotateCw size={14} /> Rotate</button>
        </div>
      </section>

      <aside className="viewer-inspector">
        <section className="viewer-library-picker">
          <span className="eyebrow">My materials</span>
          <div>
            <select
              aria-label="Choose a saved material"
              value={savedProjects.some((item) => item.id === project.id) ? project.id : ""}
              onChange={(event) => selectSavedProject(event.target.value)}
              disabled={!savedProjects.length}
            >
              {!savedProjects.length ? <option value="">No saved materials yet</option> : null}
              {savedProjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <button
              className="icon-button"
              onClick={() => void deleteSelectedProject()}
              disabled={!savedProjects.some((item) => item.id === project.id)}
              aria-label={`Delete ${project.name}`}
            ><Trash2 size={14} /></button>
          </div>
          <p>Saved locally from Material Studio</p>
        </section>

        <div className="viewer-package-card">
          <span className="viewer-package-card__icon"><FileArchive size={19} /></span>
          <div><span>Package</span><strong>{project.name}</strong></div>
          <code>v{project.schemaVersion}</code>
        </div>
        <button className="button button--ghost viewer-save-button" onClick={() => void saveTweaks()}>
          <Save size={13} /> Save viewer tweaks
        </button>

        <section className="viewer-maps-section">
          <span className="eyebrow">Generated outputs</span>
          <h2>Maps</h2>
          <label className="viewer-resolution-picker">
            <span>
              <strong>Preview resolution</strong>
              <small>
                {project.sourceTexture
                  ? "Regenerate the live maps up to a 2K max edge."
                  : "High-resolution regeneration requires an image material."}
              </small>
            </span>
            <select
              aria-label="Preview map resolution"
              value={previewResolution}
              onChange={(event) => changePreviewResolution(event.target.value)}
              disabled={!project.sourceTexture}
            >
              {viewerPreviewResolutions.map((resolution) => (
                <option key={resolution.value} value={resolution.value}>
                  {resolution.label}
                </option>
              ))}
            </select>
          </label>
          <div className="viewer-map-grid">
            {textureChannels.map((item) => (
              <button
                key={item.id}
                className={`${channel === item.id ? "is-active" : ""}${project.mapSettings[item.id].enabled ? "" : " is-disabled"}`}
                onClick={() => setChannel(item.id)}
                aria-label={`Edit ${item.label} map`}
              >
                <span className="viewer-map-thumbnail">
                  <DeferredTextureMapCanvas evaluation={evaluation} channel={item.id} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <code>{project.mapSettings[item.id].enabled ? item.space : "Off"}</code>
                </span>
              </button>
            ))}
          </div>
        </section>

        {project.sourceTexture ? (
          <section className="viewer-editor-section">
            <DeferredTextureMapInspector
              channel={channel}
              settings={project.mapSettings}
              exportResolution={project.exportResolution}
              sourceDimensions={project.sourceTexture}
              projectName={project.name}
              isGenerating={isGenerating}
              onDownloadMap={(mapChannel) =>
                getCachedProjectMapBlob(project, mapChannel)
              }
              onUpdate={updateMapSettings}
              onReset={() => {
                setProject((current) => ({
                  ...current,
                  updatedAt: new Date().toISOString(),
                  mapSettings: structuredClone(DEFAULT_MAP_SETTINGS),
                }));
                setNotice("Map settings reset");
              }}
              onSetExportResolution={(exportResolution) => {
                setProject((current) => ({
                  ...current,
                  exportResolution,
                  updatedAt: new Date().toISOString(),
                }));
              }}
              note="Tweak values live, then save a local copy when you want to keep them."
            />
          </section>
        ) : (
          <section className="viewer-editor-section">
            <span className="eyebrow">Live controls</span>
            <h2>Graph values</h2>
            {editorNode ? (
              <>
                <label className="viewer-node-picker">
                  <span>Node</span>
                  <select
                    aria-label="Choose a graph value to tweak"
                    value={editorNode.id}
                    onChange={(event) => setEditorNodeId(event.target.value)}
                  >
                    {editableNodes.map((node) => (
                      <option key={node.id} value={node.id}>{node.data.label}</option>
                    ))}
                  </select>
                </label>
                <ViewerNodeEditor
                  node={editorNode}
                  onUpdate={(values) => updateNodeValue(editorNode.id, values)}
                />
              </>
            ) : <p className="viewer-editor-empty">This material has no editable graph values.</p>}
          </section>
        )}

        <section className="viewer-privacy-card">
          <ShieldCheck size={18} />
          <div><strong>Private by design</strong><span>This viewer reads the package in memory. Nothing leaves your browser.</span></div>
        </section>

        <div className="viewer-notice" role="status">{notice}</div>
      </aside>

      {dragging ? (
        <div className="viewer-drop-overlay"><Upload size={28} /><strong>Drop material package</strong><span>It will open locally in this viewer</span></div>
      ) : null}
    </main>
  );
}
