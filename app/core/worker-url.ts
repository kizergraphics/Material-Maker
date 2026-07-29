export function browserWorkerUrl(assetUrl: URL) {
  if (assetUrl.protocol !== "file:" || typeof window === "undefined") {
    return assetUrl;
  }
  return new URL(
    `${assetUrl.pathname}${assetUrl.search}${assetUrl.hash}`,
    window.location.origin,
  );
}
