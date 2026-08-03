"use client";

import { DEFAULT_PREVIEW_SCENE_SETTINGS } from "../core/material-types";
import type {
  PreviewLightSettings,
  PreviewSceneSettings,
} from "../core/material-types";

function SceneRangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onChangeStart,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onChangeStart?: () => void;
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
        onPointerDown={onChangeStart}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value.toFixed(step < 1 ? 2 : 0)}</output>
    </label>
  );
}

export function PreviewSceneControls({
  settings,
  materialName,
  libraryMaterials = [],
  onUpdate,
  onChangeStart,
}: {
  settings: PreviewSceneSettings;
  materialName?: string;
  libraryMaterials?: Array<{ id: string; name: string }>;
  onUpdate: (values: Partial<PreviewSceneSettings>) => void;
  onChangeStart?: () => void;
}) {
  const updateGround = (values: Partial<PreviewSceneSettings["ground"]>) =>
    onUpdate({ ground: { ...settings.ground, ...values } });
  const updateLight = (
    light: keyof PreviewSceneSettings["lights"],
    values: Partial<PreviewLightSettings>,
  ) => onUpdate({
    lights: {
      ...settings.lights,
      [light]: { ...settings.lights[light], ...values },
    },
  });
  const selectedFloorMaterial = settings.ground.material === "library"
    && settings.ground.materialProjectId
    ? `library:${settings.ground.materialProjectId}`
    : settings.ground.material;
  const selectedLibraryMaterial = libraryMaterials.find(
    (material) => material.id === settings.ground.materialProjectId,
  );

  return (
    <div className="inspector-form preview-scene-inspector">
      <div className="inspector-heading">
        <div>
          <span className="eyebrow">Preview environment</span>
          <h3>Scene &amp; Floor</h3>
        </div>
        <button
          className="button button--ghost preview-scene-inspector__reset"
          onClick={() => {
            onChangeStart?.();
            onUpdate(structuredClone(DEFAULT_PREVIEW_SCENE_SETTINGS));
          }}
        >Reset</button>
      </div>

      <section className="preview-scene-inspector__section">
        <h4>Position</h4>
        <SceneRangeField
          label="Model height"
          value={settings.modelHeight}
          min={-2.5}
          max={2.5}
          step={0.05}
          onChangeStart={onChangeStart}
          onChange={(modelHeight) => onUpdate({ modelHeight })}
        />
        <SceneRangeField
          label="Floor height"
          value={settings.groundHeight}
          min={-3.5}
          max={1}
          step={0.05}
          onChangeStart={onChangeStart}
          onChange={(groundHeight) => onUpdate({ groundHeight })}
        />
      </section>

      <section className="preview-scene-inspector__section">
        <h4>Floor material</h4>
        <p className="preview-floor-material-note">
          This floor is shared by every material and saved on this device.
        </p>
        <label className="select-field preview-floor-material-select">
          <span>Material</span>
          <select
            aria-label="Floor material"
            value={selectedFloorMaterial}
            onChange={(event) => {
              onChangeStart?.();
              const value = event.target.value;
              updateGround(value.startsWith("library:")
                ? {
                    material: "library",
                    materialProjectId: value.slice("library:".length),
                  }
                : {
                    material: value === "active" ? "active" : "studio",
                    materialProjectId: null,
                  });
            }}
          >
            <option value="studio">Reflective studio floor</option>
            <option value="active">
              {materialName ? `Current material — ${materialName}` : "Current material"}
            </option>
            {libraryMaterials.length ? (
              <optgroup label="Saved materials">
                {libraryMaterials.map((material) => (
                  <option key={material.id} value={`library:${material.id}`}>
                    {material.name}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {settings.ground.material === "library" && !selectedLibraryMaterial ? (
              <option value={selectedFloorMaterial}>Missing saved material</option>
            ) : null}
          </select>
        </label>
        {settings.ground.material === "studio" ? (
          <label className="color-field">
            <span>Color</span>
            <span className="color-field__control">
              <input
                type="color"
                value={settings.ground.color}
                onPointerDown={onChangeStart}
                onChange={(event) => updateGround({ color: event.target.value })}
              />
              <code>{settings.ground.color}</code>
            </span>
          </label>
        ) : (
          <p className="preview-floor-material-note">
            {settings.ground.material === "library"
              ? `${selectedLibraryMaterial?.name ?? "The saved material"} is applied independently to the floor.`
              : "The current material is applied to the floor."}
            {" "}The controls below override its surface response so reflections remain adjustable.
          </p>
        )}
        <SceneRangeField
          label="Floor roughness"
          value={settings.ground.roughness}
          min={0}
          max={1}
          step={0.01}
          onChangeStart={onChangeStart}
          onChange={(roughness) => updateGround({ roughness })}
        />
        <SceneRangeField
          label="Floor metallic"
          value={settings.ground.metallic}
          min={0}
          max={1}
          step={0.01}
          onChangeStart={onChangeStart}
          onChange={(metallic) => updateGround({ metallic })}
        />
        <SceneRangeField
          label="Reflection"
          value={settings.ground.reflection}
          min={0}
          max={1.5}
          step={0.01}
          onChangeStart={onChangeStart}
          onChange={(reflection) => updateGround({ reflection })}
        />
      </section>

      <section className="preview-scene-inspector__section">
        <h4>Light rig</h4>
        <SceneRangeField
          label="Environment"
          value={settings.environmentIntensity}
          min={0}
          max={2}
          step={0.05}
          onChangeStart={onChangeStart}
          onChange={(environmentIntensity) => onUpdate({ environmentIntensity })}
        />
        {(["key", "fill", "rim"] as const).map((light) => (
          <div className="preview-light-control" key={light}>
            <span className="preview-light-control__name">{light} light</span>
            <SceneRangeField
              label="Intensity"
              value={settings.lights[light].intensity}
              min={0}
              max={6}
              step={0.05}
              onChangeStart={onChangeStart}
              onChange={(intensity) => updateLight(light, { intensity })}
            />
            <label className="color-field">
              <span>Color</span>
              <span className="color-field__control">
                <input
                  type="color"
                  value={settings.lights[light].color}
                  onPointerDown={onChangeStart}
                  onChange={(event) => updateLight(light, { color: event.target.value })}
                />
                <code>{settings.lights[light].color}</code>
              </span>
            </label>
          </div>
        ))}
      </section>
    </div>
  );
}
