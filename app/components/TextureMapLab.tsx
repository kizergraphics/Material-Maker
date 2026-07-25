"use client";

import {
  Download,
  GitBranch,
  ImagePlus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, type DragEvent } from "react";
import {
  canvasToBlob,
  pixelsToCanvas,
  type MaterialEvaluation,
} from "../core/material-evaluator";
import { downloadBlob } from "../core/material-persistence";
import type {
  ExportResolution,
  MapGenerationSettings,
  PreviewChannel,
  SourceTextureAsset,
  TextureMapChannel,
} from "../core/material-types";
import { pixelsForChannel } from "../core/texture-generator";

export const textureChannels: Array<{
  id: TextureMapChannel;
  label: string;
  space: string;
  description: string;
}> = [
  { id: "baseColor", label: "Albedo", space: "sRGB", description: "Source color" },
  { id: "height", label: "Height", space: "Linear", description: "Luminance depth" },
  { id: "normal", label: "Normal", space: "Linear", description: "Tangent-space detail" },
  { id: "roughness", label: "Roughness", space: "Linear", description: "Microsurface response" },
  { id: "metallic", label: "Metallic", space: "Linear", description: "Metal mask" },
  { id: "ao", label: "Ambient occlusion", space: "Linear", description: "Cavity shading" },
];

export function TextureMapCanvas({
  evaluation,
  channel,
  className,
}: {
  evaluation: MaterialEvaluation;
  channel: TextureMapChannel;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const pixels = pixelsForChannel(evaluation, channel);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = evaluation.width;
    canvas.height = evaluation.height;
    context.putImageData(
      new ImageData(
        new Uint8ClampedArray(pixels),
        evaluation.width,
        evaluation.height,
      ),
      0,
      0,
    );
  }, [evaluation.height, evaluation.width, pixels]);
  return <canvas ref={ref} className={className} aria-hidden="true" />;
}

export function TextureMapWorkbench({
  evaluation,
  source,
  settings,
  selectedChannel,
  isGenerating,
  error,
  onSelectChannel,
  onChooseSource,
  onRemoveSource,
  onDropSource,
  onSendToGraph,
}: {
  evaluation: MaterialEvaluation;
  source: SourceTextureAsset;
  settings: MapGenerationSettings;
  selectedChannel: PreviewChannel;
  isGenerating: boolean;
  error: string | null;
  onSelectChannel: (channel: TextureMapChannel) => void;
  onChooseSource: () => void;
  onRemoveSource: () => void;
  onDropSource: (file: File) => void;
  onSendToGraph: () => void;
}) {
  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) onDropSource(file);
  };

  return (
    <section
      className="map-lab-panel"
      aria-label="Generated texture maps"
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <header className="map-lab-header">
        <div>
          <span className="eyebrow">Image-to-material pipeline</span>
          <h2>Generated map set</h2>
          <p>{source.name} · {source.width}×{source.height}px</p>
        </div>
        <div>
          <span className={`generation-state${isGenerating ? " is-active" : ""}`}>
            <RefreshCw size={12} /> {isGenerating ? "Updating maps" : error ?? "Maps ready"}
          </span>
          <button className="button button--primary" onClick={onSendToGraph} disabled={isGenerating}>
            <GitBranch size={14} /> Send maps to graph
          </button>
          <button className="button button--ghost" onClick={onChooseSource}>
            <ImagePlus size={14} /> Replace albedo
          </button>
          <button className="icon-button" onClick={onRemoveSource} aria-label="Remove albedo texture">
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="map-card-grid">
        {textureChannels.map((item) => (
          <button
            key={item.id}
            className={`map-card${selectedChannel === item.id ? " is-selected" : ""}${settings[item.id].enabled ? "" : " is-disabled"}`}
            onClick={() => onSelectChannel(item.id)}
            aria-label={`${item.label} map, ${settings[item.id].enabled ? "enabled" : "disabled"}`}
          >
            <span className="map-card__image">
              <TextureMapCanvas evaluation={evaluation} channel={item.id} />
              <span>{item.space}</span>
            </span>
            <span className="map-card__copy">
              <strong>{item.label}</strong>
              <em>{settings[item.id].enabled ? item.description : "Disabled for this material"}</em>
            </span>
            <SlidersHorizontal size={14} />
          </button>
        ))}
      </div>

      <div className="map-lab-footer">
        <ShieldCheck size={14} />
        <span>Drag another PNG, JPEG, or WebP anywhere here to replace the source. Processing stays in this browser.</span>
      </div>
    </section>
  );
}

function MapRangeField({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
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
      <output>{value.toFixed(step < 1 ? 2 : 0)}{suffix}</output>
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="map-toggle-field">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <i aria-hidden="true" />
    </label>
  );
}

const mapTitles: Record<PreviewChannel, string> = {
  material: "Full material",
  baseColor: "Albedo",
  height: "Height",
  normal: "Normal",
  roughness: "Roughness",
  metallic: "Metallic",
  ao: "Ambient occlusion",
};

export function TextureMapInspector({
  channel,
  settings,
  exportResolution,
  evaluation,
  projectName,
  isGenerating = false,
  onUpdate,
  onChangeStart = () => undefined,
  onReset,
  onSetExportResolution,
  note = "Every control is non-destructive and saved with this local project.",
}: {
  channel: PreviewChannel;
  settings: MapGenerationSettings;
  exportResolution: ExportResolution;
  evaluation: MaterialEvaluation;
  projectName: string;
  isGenerating?: boolean;
  onUpdate: (map: keyof MapGenerationSettings, values: Record<string, number | boolean>) => void;
  onChangeStart?: () => void;
  onReset: () => void;
  onSetExportResolution: (resolution: ExportResolution) => void;
  note?: string;
}) {
  const downloadCurrent = async () => {
    if (channel === "material" || isGenerating) return;
    const canvas = pixelsToCanvas(
      pixelsForChannel(evaluation, channel),
      evaluation.width,
      evaluation.height,
    );
    const safeName = projectName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "material";
    downloadBlob(await canvasToBlob(canvas), `${safeName}-${channel}.png`);
  };

  const update = (map: keyof MapGenerationSettings, key: string, value: number | boolean) => {
    if (key === "enabled") onChangeStart();
    onUpdate(map, { [key]: value });
  };

  return (
    <div
      className="map-inspector"
      onPointerDownCapture={(event) => {
        const target = event.target as HTMLInputElement;
        if (target.type === "range") onChangeStart();
      }}
      onKeyDownCapture={(event) => {
        const target = event.target as HTMLInputElement;
        if (
          target.type === "range" &&
          (
            event.key.startsWith("Arrow") ||
            event.key === "PageUp" ||
            event.key === "PageDown" ||
            event.key === "Home" ||
            event.key === "End"
          )
        ) {
          onChangeStart();
        }
      }}
    >
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">Map controls</span>
          <h3>{mapTitles[channel]}</h3>
        </div>
        <span className="node-kind-tag node-kind-tag--filter">Live</span>
      </div>

      {channel === "material" ? (
        <>
          <div className="map-overview">
            <WandSparkles size={18} />
            <div><strong>Six maps generated</strong><span>Select a map tab or card to tune it independently.</span></div>
          </div>
          <label className="resolution-field">
            <span>Export resolution</span>
            <select
              value={exportResolution}
              onChange={(event) => onSetExportResolution(Number(event.target.value) as ExportResolution)}
            >
              <option value={512}>512 max edge</option>
              <option value={1024}>1024 max edge</option>
              <option value={2048}>2048 max edge</option>
            </select>
          </label>
          <button className="button button--ghost map-reset-button" onClick={onReset}>
            <RefreshCw size={13} /> Reset generation settings
          </button>
        </>
      ) : null}

      {channel === "baseColor" ? (
        <>
          <ToggleField label="Use this map" checked={settings.baseColor.enabled} onChange={(value) => update("baseColor", "enabled", value)} />
          <MapRangeField label="Brightness" value={settings.baseColor.brightness} min={-0.5} max={0.5} step={0.01} onChange={(value) => update("baseColor", "brightness", value)} />
          <MapRangeField label="Contrast" value={settings.baseColor.contrast} min={0.2} max={2.5} step={0.01} onChange={(value) => update("baseColor", "contrast", value)} />
          <MapRangeField label="Saturation" value={settings.baseColor.saturation} min={0} max={2} step={0.01} onChange={(value) => update("baseColor", "saturation", value)} />
          <MapRangeField label="Hue" value={settings.baseColor.hue} min={-180} max={180} step={1} suffix="°" onChange={(value) => update("baseColor", "hue", value)} />
        </>
      ) : null}

      {channel === "height" ? (
        <>
          <ToggleField label="Use this map" checked={settings.height.enabled} onChange={(value) => update("height", "enabled", value)} />
          <MapRangeField label="Contrast" value={settings.height.contrast} min={0.1} max={3} step={0.01} onChange={(value) => update("height", "contrast", value)} />
          <MapRangeField label="Midpoint" value={settings.height.bias} min={-0.5} max={0.5} step={0.01} onChange={(value) => update("height", "bias", value)} />
          <MapRangeField label="Blur" value={settings.height.blur} min={0} max={8} step={1} suffix="px" onChange={(value) => update("height", "blur", value)} />
          <ToggleField label="Invert height" checked={settings.height.invert} onChange={(value) => update("height", "invert", value)} />
        </>
      ) : null}

      {channel === "normal" ? (
        <>
          <ToggleField label="Use this map" checked={settings.normal.enabled} onChange={(value) => update("normal", "enabled", value)} />
          <MapRangeField label="Strength" value={settings.normal.strength} min={0} max={8} step={0.01} onChange={(value) => update("normal", "strength", value)} />
          <MapRangeField label="Detail" value={settings.normal.detail} min={0.25} max={4} step={0.01} onChange={(value) => update("normal", "detail", value)} />
          <ToggleField label="Flip green / Y" checked={settings.normal.invertY} onChange={(value) => update("normal", "invertY", value)} />
        </>
      ) : null}

      {channel === "roughness" ? (
        <>
          <ToggleField label="Use this map" checked={settings.roughness.enabled} onChange={(value) => update("roughness", "enabled", value)} />
          <MapRangeField label="Base value" value={settings.roughness.base} min={0} max={1} step={0.01} onChange={(value) => update("roughness", "base", value)} />
          <MapRangeField label="Variation" value={settings.roughness.variation} min={-1.5} max={1.5} step={0.01} onChange={(value) => update("roughness", "variation", value)} />
          <ToggleField label="Invert roughness" checked={settings.roughness.invert} onChange={(value) => update("roughness", "invert", value)} />
        </>
      ) : null}

      {channel === "metallic" ? (
        <>
          <ToggleField label="Use this map" checked={settings.metallic.enabled} onChange={(value) => update("metallic", "enabled", value)} />
          <MapRangeField label="Base value" value={settings.metallic.base} min={0} max={1} step={0.01} onChange={(value) => update("metallic", "base", value)} />
          <MapRangeField label="Variation" value={settings.metallic.variation} min={-1.5} max={1.5} step={0.01} onChange={(value) => update("metallic", "variation", value)} />
          <ToggleField label="Invert metallic" checked={settings.metallic.invert} onChange={(value) => update("metallic", "invert", value)} />
          <p className="map-caution">Color alone cannot identify metal reliably. Use the base value as the source of truth.</p>
        </>
      ) : null}

      {channel === "ao" ? (
        <>
          <ToggleField label="Use this map" checked={settings.ao.enabled} onChange={(value) => update("ao", "enabled", value)} />
          <MapRangeField label="Strength" value={settings.ao.strength} min={0} max={4} step={0.01} onChange={(value) => update("ao", "strength", value)} />
          <MapRangeField label="Radius" value={settings.ao.radius} min={1} max={16} step={1} suffix="px" onChange={(value) => update("ao", "radius", value)} />
          <MapRangeField label="Lift" value={settings.ao.bias} min={-0.3} max={0.3} step={0.01} onChange={(value) => update("ao", "bias", value)} />
        </>
      ) : null}

      {channel !== "material" ? (
        <button
          className="button button--ghost map-download-button"
          onClick={() => void downloadCurrent()}
          disabled={isGenerating}
        >
          <Download size={13} /> Download {mapTitles[channel]} PNG
        </button>
      ) : null}

      <div className="inspector-note">
        <ShieldCheck size={14} />
        <span>{note}</span>
      </div>
    </div>
  );
}
