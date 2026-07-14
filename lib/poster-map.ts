import type { RouteBounds } from "./types";

const MAP_STYLE_URL = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/fiord";
const MAX_RENDER_EDGE = 3072;
const CACHE_LIMIT = 4;
const cache = new Map<string, Promise<HTMLCanvasElement | null>>();

function waitForMapEvent(map: import("maplibre-gl").Map, event: "load" | "idle", timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(result);
    };
    const timeout = window.setTimeout(() => finish(false), timeoutMs);
    map.once(event, () => finish(true));
  });
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, "image/png");
    } catch {
      resolve(null);
    }
  });
}

async function render(bounds: RouteBounds, width: number, height: number): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const scale = Math.min(1, MAX_RENDER_EDGE / Math.max(width, height));
  const renderWidth = Math.max(320, Math.round(width * scale));
  const renderHeight = Math.max(240, Math.round(height * scale));
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "fixed",
    left: "-10000px",
    top: "0",
    width: `${renderWidth}px`,
    height: `${renderHeight}px`,
    pointerEvents: "none",
  });
  document.body.appendChild(container);

  let map: import("maplibre-gl").Map | null = null;
  let mapError = "";
  try {
    const maplibregl = (await import("maplibre-gl")).default;
    map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL,
      bounds: [[bounds.west, bounds.south], [bounds.east, bounds.north]],
      fitBoundsOptions: { padding: 0, animate: false },
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      fadeDuration: 0,
    });
    map.on("error", (event) => { mapError ||= event.error?.message ?? "MAPLIBRE_ERROR"; });
    if (!(await waitForMapEvent(map, "load", 10_000))) throw new Error(`POSTER_MAP_LOAD_TIMEOUT${mapError ? `: ${mapError}` : ""}`);
    await waitForMapEvent(map, "idle", 5_000);
    map.triggerRepaint();
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    const blob = await canvasBlob(map.getCanvas());
    if (!blob) throw new Error("POSTER_MAP_SNAPSHOT_FAILED");
    const bitmap = await createImageBitmap(blob);
    const safeCanvas = document.createElement("canvas");
    safeCanvas.width = renderWidth;
    safeCanvas.height = renderHeight;
    const context = safeCanvas.getContext("2d");
    if (!context) {
      bitmap.close();
      throw new Error("POSTER_MAP_CANVAS_UNAVAILABLE");
    }
    context.drawImage(bitmap, 0, 0, renderWidth, renderHeight);
    bitmap.close();
    return safeCanvas;
  } catch (error) {
    console.warn("Poster map fell back to the route background.", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return null;
  } finally {
    map?.remove();
    container.remove();
  }
}

export function renderPosterBasemap(bounds: RouteBounds, width: number, height: number): Promise<HTMLCanvasElement | null> {
  const key = [bounds.west, bounds.south, bounds.east, bounds.north, width, height]
    .map((value) => Number(value).toFixed(4))
    .join(":");
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = render(bounds, width, height);
  cache.set(key, pending);
  pending.then((result) => { if (!result && cache.get(key) === pending) cache.delete(key); });
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  return pending;
}
