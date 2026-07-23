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
  ShieldCheck,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  deleteProjectLocal,
  importMaterialPack,
  loadProjectsLocal,
} from "../core/material-persistence";
import { useMaterialEvaluation } from "../core/use-material-evaluation";
import {
  createStarterProject,
  type MaterialProject,
  type PreviewChannel,
  type PreviewShape,
} from "../core/material-types";
import { MaterialPreview } from "./MaterialPreview";

const channels: Array<{ id: PreviewChannel; label: string }> = [
  { id: "material", label: "Beauty" },
  { id: "baseColor", label: "Base color" },
  { id: "height", label: "Height" },
  { id: "normal", label: "Normal" },
  { id: "roughness", label: "Roughness" },
  { id: "metallic", label: "Metallic" },
  { id: "ao", label: "AO" },
];

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
  const { evaluation, isGenerating } = useMaterialEvaluation(project, 256);

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
    setNotice(`${selected.name} selected`);
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
        <MaterialPreview
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
          <span className="viewer-status"><Check size={13} /> {isGenerating ? "Generating maps" : "Ready to inspect"}</span>
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

        <section>
          <span className="eyebrow">Material response</span>
          <h2>Surface</h2>
          <div className="viewer-metric">
            <span>Roughness</span>
            <div><i style={{ width: `${evaluation.roughnessValue * 100}%` }} /></div>
            <code>{evaluation.roughnessValue.toFixed(2)}</code>
          </div>
          <div className="viewer-metric">
            <span>Metallic</span>
            <div><i style={{ width: `${evaluation.metallicValue * 100}%` }} /></div>
            <code>{evaluation.metallicValue.toFixed(2)}</code>
          </div>
        </section>

        <section>
          <span className="eyebrow">Package contents</span>
          <h2>Maps</h2>
          <div className="viewer-map-list">
            {[
              ["baseColor", "Base color", "sRGB", "#a88466"],
              ["height", "Height", "Linear", "#7d7d7d"],
              ["normal", "Normal", "Linear", "#657dce"],
              ["roughness", "Roughness", "Linear", "#8d8d8d"],
              ["metallic", "Metallic", "Linear", "#d0d0d0"],
              ["ao", "Ambient occlusion", "Linear", "#b8b8b8"],
            ].map(([id, label, space, color]) => (
              <div key={id} className={project.mapSettings[id as keyof MaterialProject["mapSettings"]].enabled ? "" : "is-disabled"}><span style={{ background: color }} /><strong>{label}</strong><code>{project.mapSettings[id as keyof MaterialProject["mapSettings"]].enabled ? space : "Off"}</code></div>
            ))}
          </div>
        </section>

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
