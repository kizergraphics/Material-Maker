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
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { importMaterialPack } from "../core/material-persistence";
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
  const { evaluation, isGenerating } = useMaterialEvaluation(project, 256);

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
            <button key={item.id} className={channel === item.id ? "is-active" : ""} onClick={() => setChannel(item.id)}>
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
              ["Base color", "sRGB", "#a88466"],
              ["Height", "Linear", "#7d7d7d"],
              ["Normal", "Linear", "#657dce"],
              ["Roughness", "Linear", "#8d8d8d"],
              ["Metallic", "Linear", "#d0d0d0"],
              ["Ambient occlusion", "Linear", "#b8b8b8"],
            ].map(([label, space, color]) => (
              <div key={label}><span style={{ background: color }} /><strong>{label}</strong><code>{space}</code></div>
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
