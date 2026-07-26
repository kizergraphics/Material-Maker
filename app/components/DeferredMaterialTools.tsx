"use client";

import {
  lazy,
  Suspense,
  type ComponentProps,
  type ReactNode,
} from "react";

const MaterialPreview = lazy(() =>
  import("./MaterialPreview").then((module) => ({
    default: module.MaterialPreview,
  })),
);

const loadTextureMapLab = () => import("./TextureMapLab");

const TextureMapCanvas = lazy(() =>
  loadTextureMapLab().then((module) => ({
    default: module.TextureMapCanvas,
  })),
);

const TextureMapInspector = lazy(() =>
  loadTextureMapLab().then((module) => ({
    default: module.TextureMapInspector,
  })),
);

const TextureMapWorkbench = lazy(() =>
  loadTextureMapLab().then((module) => ({
    default: module.TextureMapWorkbench,
  })),
);

function DeferredToolFallback({
  className,
  label,
  children,
}: {
  className: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <div className={`deferred-tool-loading ${className}`} role="status">
      <span className="deferred-tool-loading__spinner" aria-hidden="true" />
      <span>{label}</span>
      {children}
    </div>
  );
}

export function DeferredMaterialPreview(
  props: ComponentProps<typeof MaterialPreview>,
) {
  return (
    <Suspense
      fallback={(
        <DeferredToolFallback
          className={`material-preview material-preview--loading ${props.className ?? ""}`}
          label="Loading 3D preview"
        />
      )}
    >
      <MaterialPreview {...props} />
    </Suspense>
  );
}

export function DeferredTextureMapCanvas(
  props: ComponentProps<typeof TextureMapCanvas>,
) {
  return (
    <Suspense
      fallback={(
        <span
          className={`texture-map-canvas--loading ${props.className ?? ""}`}
          aria-label="Loading map thumbnail"
        />
      )}
    >
      <TextureMapCanvas {...props} />
    </Suspense>
  );
}

export function DeferredTextureMapInspector(
  props: ComponentProps<typeof TextureMapInspector>,
) {
  return (
    <Suspense
      fallback={(
        <DeferredToolFallback
          className="deferred-tool-loading--inspector"
          label="Loading map controls"
        />
      )}
    >
      <TextureMapInspector {...props} />
    </Suspense>
  );
}

export function DeferredTextureMapWorkbench(
  props: ComponentProps<typeof TextureMapWorkbench>,
) {
  return (
    <Suspense
      fallback={(
        <section className="map-lab-panel">
          <DeferredToolFallback
            className="deferred-tool-loading--workbench"
            label="Loading Map Lab"
          />
        </section>
      )}
    >
      <TextureMapWorkbench {...props} />
    </Suspense>
  );
}
