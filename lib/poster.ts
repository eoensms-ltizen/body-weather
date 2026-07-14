import { mergeBounds, routesInBounds } from "./atlas";
import { renderPosterBasemap } from "./poster-map";
import type { AtlasRouteFeature, RouteBounds, RoutePoint } from "./types";

export type PosterTheme = "night" | "aurora" | "paper";
export type PosterRatio = "16:9" | "4:5" | "9:16";
export type PosterColorMode = "memory" | "sport" | "season" | "achievement";

export interface PosterConfig {
  title: string;
  subtitle: string;
  theme: PosterTheme;
  ratio: PosterRatio;
  colorMode: PosterColorMode;
  showStats: boolean;
  showBaseMap: boolean;
  privacyMasked: boolean;
  activityCount: number;
  distanceLabel: string;
  periodLabel: string;
  cropBounds?: RouteBounds | null;
  preview?: boolean;
}

export interface PosterRenderResult {
  blob: Blob;
  width: number;
  height: number;
  includedRoutes: number;
  privacyMasked: boolean;
  baseMapRendered: boolean;
}

export interface PosterMapFrame {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PosterProjection {
  project: (point: Pick<RoutePoint, "latitude" | "longitude">) => [number, number];
  viewportBounds: RouteBounds;
  contentWidth: number;
  contentHeight: number;
}

const THEME = {
  night: { top: "#04151d", bottom: "#071018", grid: "rgba(111, 233, 218, .08)", text: "#f0f6ed", muted: "#94aaa7", glow: "#69f1d1" },
  aurora: { top: "#06202b", bottom: "#190c2d", grid: "rgba(232, 138, 255, .08)", text: "#fbf7ff", muted: "#b8a9c9", glow: "#67e8d4" },
  paper: { top: "#efe9dc", bottom: "#d8d0bf", grid: "rgba(30, 70, 70, .09)", text: "#102b2b", muted: "#5b6d68", glow: "#164e56" },
} as const;

function dimensions(ratio: PosterRatio, preview = false): [number, number] {
  const size: Record<PosterRatio, [number, number]> = {
    "16:9": [3840, 2160],
    "4:5": [2160, 2700],
    "9:16": [2160, 3840],
  };
  const [width, height] = size[ratio];
  if (!preview) return [width, height];
  const scale = 960 / Math.max(width, height);
  return [Math.round(width * scale), Math.round(height * scale)];
}

function seasonColor(date: string): string {
  const month = Number(date.slice(5, 7));
  if (month <= 2 || month === 12) return "#7dd3fc";
  if (month <= 5) return "#86efac";
  if (month <= 8) return "#facc15";
  return "#fb7185";
}

function sportColor(type: string): string {
  const lower = type.toLowerCase();
  if (lower.includes("run")) return "#fb7185";
  if (lower.includes("ride") || lower.includes("cycl")) return "#67e8d4";
  if (lower.includes("walk") || lower.includes("hik")) return "#facc15";
  return "#c4b5fd";
}

function routeColor(route: AtlasRouteFeature, mode: PosterColorMode, glow: string, achievementIds: Set<string>): string {
  if (mode === "sport") return sportColor(route.activity.type);
  if (mode === "season") return seasonColor(route.activity.localDate);
  if (mode === "achievement") return achievementIds.has(route.id) ? "#f5c451" : "#42636a";
  return glow;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("POSTER_BLOB_FAILED")), "image/png"));
}

const MAX_MERCATOR_LATITUDE = 85.05112878;

function mercatorY(latitude: number): number {
  const clamped = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, latitude));
  const radians = clamped * Math.PI / 180;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2)) * 180 / Math.PI;
}

function inverseMercatorY(value: number): number {
  return Math.atan(Math.sinh(value * Math.PI / 180)) * 180 / Math.PI;
}

export function createPosterProjection(bounds: RouteBounds, frame: PosterMapFrame, paddingRatio = 0.055): PosterProjection {
  const frameWidth = Math.max(1, frame.right - frame.left);
  const frameHeight = Math.max(1, frame.bottom - frame.top);
  const padding = Math.max(0, Math.min(0.3, paddingRatio));
  const innerWidth = frameWidth * (1 - padding * 2);
  const innerHeight = frameHeight * (1 - padding * 2);
  const west = bounds.west;
  const east = bounds.east;
  const southY = mercatorY(bounds.south);
  const northY = mercatorY(bounds.north);
  const xSpan = Math.max(0.0001, east - west);
  const ySpan = Math.max(0.0001, northY - southY);
  const scale = Math.min(innerWidth / xSpan, innerHeight / ySpan);
  const centerLongitude = (west + east) / 2;
  const centerMercatorY = (southY + northY) / 2;
  const centerX = (frame.left + frame.right) / 2;
  const centerY = (frame.top + frame.bottom) / 2;

  return {
    project: (point) => [
      centerX + (point.longitude - centerLongitude) * scale,
      centerY - (mercatorY(point.latitude) - centerMercatorY) * scale,
    ],
    viewportBounds: {
      west: centerLongitude - frameWidth / (scale * 2),
      east: centerLongitude + frameWidth / (scale * 2),
      south: inverseMercatorY(centerMercatorY - frameHeight / (scale * 2)),
      north: inverseMercatorY(centerMercatorY + frameHeight / (scale * 2)),
    },
    contentWidth: xSpan * scale,
    contentHeight: ySpan * scale,
  };
}

export function posterDimensions(ratio: PosterRatio, preview = false): [number, number] {
  return dimensions(ratio, preview);
}

export function filterPosterRoutes(routes: AtlasRouteFeature[], hiddenIds: ReadonlySet<string>): AtlasRouteFeature[] {
  return routes.filter((route) => !hiddenIds.has(route.id));
}

export async function renderPoster(
  routes: AtlasRouteFeature[],
  achievementActivityIds: string[],
  config: PosterConfig,
): Promise<PosterRenderResult> {
  if (!config.privacyMasked) throw new Error("POSTER_PRIVACY_MASK_REQUIRED");
  if (typeof document === "undefined") throw new Error("POSTER_BROWSER_REQUIRED");
  const [width, height] = dimensions(config.ratio, config.preview);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("POSTER_CANVAS_UNAVAILABLE");
  const palette = THEME[config.theme];
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, palette.top);
  gradient.addColorStop(1, palette.bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const grid = Math.max(32, Math.round(width / 28));
  context.strokeStyle = palette.grid;
  context.lineWidth = Math.max(1, width / 2400);
  for (let x = -height; x < width + height; x += grid) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x + height, height);
    context.stroke();
  }

  const includedRoutes = config.cropBounds ? routesInBounds(routes, config.cropBounds) : routes;
  const bounds = config.cropBounds ?? mergeBounds(includedRoutes.map((route) => route.bounds));
  let baseMapRendered = false;
  if (bounds) {
    const mapTop = height * 0.16;
    const mapBottom = height * 0.78;
    const mapLeft = width * 0.08;
    const mapRight = width * 0.92;
    const frame = { left: mapLeft, top: mapTop, right: mapRight, bottom: mapBottom };
    const projection = createPosterProjection(bounds, frame);
    const project = projection.project;
    const achievementIds = new Set(achievementActivityIds);
    context.save();
    context.beginPath();
    context.rect(mapLeft, mapTop, mapRight - mapLeft, mapBottom - mapTop);
    context.clip();
    if (config.showBaseMap) {
      const baseMap = await renderPosterBasemap(projection.viewportBounds, mapRight - mapLeft, mapBottom - mapTop);
      if (baseMap) {
        context.drawImage(baseMap, mapLeft, mapTop, mapRight - mapLeft, mapBottom - mapTop);
        context.fillStyle = config.theme === "paper" ? "rgba(239, 233, 220, .2)" : "rgba(2, 12, 17, .4)";
        context.fillRect(mapLeft, mapTop, mapRight - mapLeft, mapBottom - mapTop);
        baseMapRendered = true;
      }
    }
    includedRoutes.forEach((route) => {
      const points = config.preview ? route.lod.low : route.lod.medium;
      if (points.length < 2) return;
      const color = routeColor(route, config.colorMode, palette.glow, achievementIds);
      context.beginPath();
      points.forEach((point, index) => {
        const [x, y] = project(point);
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      context.strokeStyle = color;
      context.globalAlpha = config.colorMode === "memory" ? 0.46 : 0.7;
      context.lineWidth = Math.max(1.2, width / 1600);
      context.shadowColor = color;
      context.shadowBlur = Math.max(3, width / 360);
      context.stroke();
    });
    context.restore();
    if (baseMapRendered) {
      context.save();
      context.fillStyle = palette.muted;
      context.globalAlpha = 0.76;
      context.textAlign = "right";
      context.font = `500 ${Math.max(8, Math.round(width * 0.0045))}px "Arial", "Malgun Gothic", sans-serif`;
      context.fillText("Map data © OpenStreetMap contributors · OpenFreeMap", mapRight, mapBottom + Math.max(11, height * 0.012));
      context.restore();
    }
  }
  context.globalAlpha = 1;
  context.shadowBlur = 0;

  const margin = width * 0.07;
  context.fillStyle = palette.text;
  context.font = `700 ${Math.round(width * 0.05)}px "Arial", "Malgun Gothic", sans-serif`;
  context.fillText(config.title.slice(0, 36), margin, height * 0.1);
  context.fillStyle = palette.muted;
  context.font = `500 ${Math.round(width * 0.018)}px "Arial", "Malgun Gothic", sans-serif`;
  context.fillText(config.subtitle.slice(0, 68), margin, height * 0.135);

  if (config.showStats) {
    context.fillStyle = palette.text;
    context.font = `600 ${Math.round(width * 0.02)}px "Arial", "Malgun Gothic", sans-serif`;
    context.fillText(`${config.activityCount.toLocaleString("ko-KR")} ACTIVITIES`, margin, height * 0.87);
    context.fillText(config.distanceLabel.toUpperCase(), margin, height * 0.91);
    context.fillStyle = palette.muted;
    context.font = `500 ${Math.round(width * 0.015)}px "Arial", "Malgun Gothic", sans-serif`;
    context.fillText(config.periodLabel, margin, height * 0.945);
    context.textAlign = "right";
    context.fillText("BODY WEATHER · PRIVATE EXPERIENCE ATLAS", width - margin, height * 0.945);
    context.textAlign = "left";
  }

  const blob = await canvasBlob(canvas);
  return { blob, width, height, includedRoutes: includedRoutes.length, privacyMasked: true, baseMapRendered };
}
