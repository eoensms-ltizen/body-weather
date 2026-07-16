import type { Achievement, AtlasRouteFeature, DailyWellness, PlaceCluster } from "./types";
import { measurePremiereRoutePath, type PremiereCameraTuning, type PremierePaceMode } from "./premiere-camera";

export type PremiereLength = "memory-cut" | "three-minute" | "full-chronicle";
export type PremiereCameraMode = "position" | "direction" | "overview";
export type PremiereSeason = "spring" | "summer" | "autumn" | "winter";
export type PremiereSceneKind = "prelude" | "ride" | "jump" | "montage" | "finale";

export interface PremiereSettings {
  length: PremiereLength;
  cameraMode: PremiereCameraMode;
  showActivityCard: boolean;
  showRecords: boolean;
  showSeason: boolean;
  showRecovery: boolean;
}

export interface PremiereRideMeta {
  season: PremiereSeason;
  recoveryScore: number | null;
  recoverySignals: number;
  firstVisit: boolean;
  achievementId: string | null;
  achievementEvidence: Achievement["evidence"] | null;
  echoRouteIds: string[];
  paceMode: PremierePaceMode;
}

export interface PremiereScene {
  id: string;
  kind: PremiereSceneKind;
  durationMs: number;
  startMs: number;
  endMs: number;
  revealStart: number;
  revealEnd: number;
  routeId?: string;
  routeIds?: string[];
  fromRouteId?: string;
  toRouteId?: string;
  jumpDistanceKm?: number;
  gapDays?: number;
  jumpKind?: "nearby" | "regional" | "long-gap";
  rideMeta?: PremiereRideMeta;
}

export interface PremiereStory {
  settings: PremiereSettings;
  orderedRouteIds: string[];
  highlightRouteIds: string[];
  scenes: PremiereScene[];
  totalDurationMs: number;
  startDate: string;
  endDate: string;
}

export interface PremiereFrame {
  sceneIndex: number;
  sceneId: string;
  kind: PremiereSceneKind;
  progress: number;
  travelProgress: number;
  imprintProgress: number;
  revealedCount: number;
  routeId?: string;
  fromRouteId?: string;
  toRouteId?: string;
  jumpKind?: PremiereScene["jumpKind"];
  gapDays?: number;
  rideMeta?: PremiereRideMeta;
}

export interface PremiereMapState {
  active: true;
  orderedRouteIds: string[];
  frame: PremiereFrame;
  cameraMode: PremiereCameraMode;
  playbackSpeed: number;
  cameraTuning: PremiereCameraTuning;
  freeLook: boolean;
  showRecords: boolean;
  showSeason: boolean;
  showRecovery: boolean;
  reducedMotion: boolean;
}

type DraftScene = Omit<PremiereScene, "startMs" | "endMs">;

const DAY_MS = 86_400_000;
export const PREMIERE_RIDE_TRAVEL_SHARE = 0.82;
const PREMIERE_IMPRINT_REVEAL_AT = 0.62;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function measured(metric: { value: number | null; status: string } | undefined): number | null {
  return metric?.status === "measured" || metric?.status === "derived" ? metric.value : null;
}

function seasonForDate(date: string): PremiereSeason {
  const month = Number(date.slice(5, 7));
  if (month <= 2 || month === 12) return "winter";
  if (month <= 5) return "spring";
  if (month <= 8) return "summer";
  return "autumn";
}

function recoveryForDate(date: string, wellnessByDate: ReadonlyMap<string, DailyWellness>): { score: number | null; signals: number } {
  const day = wellnessByDate.get(date);
  if (!day) return { score: null, signals: 0 };
  const values = [
    measured(day.sleep?.score),
    measured(day.bodyBatteryHigh),
    measured(day.averageStress) === null ? null : 100 - measured(day.averageStress)!,
  ].filter((value): value is number => value !== null && Number.isFinite(value));
  if (!values.length) return { score: null, signals: 0 };
  return { score: Math.round(clamp(values.reduce((sum, value) => sum + value, 0) / values.length, 0, 100)), signals: values.length };
}

function haversineKm(a: AtlasRouteFeature["centroid"], b: AtlasRouteFeature["centroid"]): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(b[1] - a[1]);
  const longitudeDelta = toRadians(b[0] - a[0]);
  const latitudeA = toRadians(a[1]);
  const latitudeB = toRadians(b[1]);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function dayGap(from: AtlasRouteFeature, to: AtlasRouteFeature): number {
  const start = Date.parse(`${from.activity.localDate}T12:00:00Z`);
  const end = Date.parse(`${to.activity.localDate}T12:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / DAY_MS)) : 0;
}

function clusterForRoute(routeId: string, clusters: PlaceCluster[]): PlaceCluster | undefined {
  return clusters.find((cluster) => cluster.activityIds.includes(routeId));
}

function paceMode(route: AtlasRouteFeature): PremierePaceMode {
  return measurePremiereRoutePath(route.lod.medium)?.paceMode ?? "distance";
}

function rideMeta(
  route: AtlasRouteFeature,
  ordered: AtlasRouteFeature[],
  achievementsByActivity: ReadonlyMap<string, Achievement[]>,
  clusters: PlaceCluster[],
  wellnessByDate: ReadonlyMap<string, DailyWellness>,
): PremiereRideMeta {
  const achievement = achievementsByActivity.get(route.id)?.[0];
  const cluster = clusterForRoute(route.id, clusters);
  const previousIds = new Set(ordered.filter((item) => item.activity.localDate < route.activity.localDate).map((item) => item.id));
  const echoRouteIds = (cluster?.activityIds ?? []).filter((id) => previousIds.has(id)).slice(-5);
  const recovery = recoveryForDate(route.activity.localDate, wellnessByDate);
  return {
    season: seasonForDate(route.activity.localDate),
    recoveryScore: recovery.score,
    recoverySignals: recovery.signals,
    firstVisit: Boolean(cluster && cluster.startDate === route.activity.localDate),
    achievementId: achievement?.id ?? null,
    achievementEvidence: achievement?.evidence ?? null,
    echoRouteIds,
    paceMode: paceMode(route),
  };
}

function rideSceneDuration(route: AtlasRouteFeature, meta: PremiereRideMeta, first: boolean): number {
  const movingSeconds = route.activity.movingTime.value ?? route.activity.elapsedTime.value ?? 0;
  const movingHours = Math.max(0, movingSeconds / 3_600);
  const distanceKm = Math.max(0, route.activity.distance.value ?? 0);
  const duration = 6_500
    + Math.log1p(movingHours) * 2_300
    + Math.log1p(distanceKm / 20) * 900
    + (meta.achievementId ? 900 : 0)
    + (first ? 700 : 0);
  return Math.round(clamp(duration, 6_500, 15_000));
}

function topIds(routes: AtlasRouteFeature[], accessor: (route: AtlasRouteFeature) => number | null, count: number): Set<string> {
  return new Set(routes
    .flatMap((route) => {
      const value = accessor(route);
      return value === null || !Number.isFinite(value) ? [] : [{ id: route.id, value }];
    })
    .sort((a, b) => b.value - a.value)
    .slice(0, count)
    .map((item) => item.id));
}

function highlightIds(routes: AtlasRouteFeature[], achievements: Achievement[], clusters: PlaceCluster[], limit: number): string[] {
  if (routes.length <= limit) return routes.map((route) => route.id);
  const achievementIds = new Set(achievements.map((item) => item.activityId));
  const distanceIds = topIds(routes, (route) => route.activity.distance.value, 3);
  const elevationIds = topIds(routes, (route) => route.activity.elevationGain?.value ?? null, 3);
  const durationIds = topIds(routes, (route) => route.activity.movingTime.value, 2);
  const mostReturned = [...clusters].sort((a, b) => b.visitCount - a.visitCount)[0];
  const firstVisitIds = new Set(clusters.flatMap((cluster) => routes.filter((route) => cluster.activityIds.includes(route.id) && route.activity.localDate === cluster.startDate).map((route) => route.id)));
  const firstId = routes[0]?.id;
  const lastId = routes.at(-1)?.id;
  const scored = routes.map((route, index) => {
    let score = 0;
    if (route.id === firstId) score += 10_000;
    if (route.id === lastId) score += 9_000;
    if (achievementIds.has(route.id)) score += 3_000;
    if (firstVisitIds.has(route.id)) score += 1_200;
    if (distanceIds.has(route.id)) score += 900;
    if (elevationIds.has(route.id)) score += 750;
    if (durationIds.has(route.id)) score += 650;
    if (mostReturned?.activityIds.includes(route.id)) score += 500;
    score += index / Math.max(1, routes.length);
    return { id: route.id, index, score };
  });
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).sort((a, b) => a.index - b.index).map((item) => item.id);
}

function jumpScene(from: AtlasRouteFeature, to: AtlasRouteFeature, revealCount: number, index: number): DraftScene {
  const distance = haversineKm(from.centroid, to.centroid);
  const gap = dayGap(from, to);
  return {
    id: `jump-${index}-${from.id}-${to.id}`,
    kind: "jump",
    durationMs: gap >= 60 ? 2_200 : distance < 20 ? 1_250 : 1_850,
    revealStart: revealCount,
    revealEnd: revealCount,
    fromRouteId: from.id,
    toRouteId: to.id,
    jumpDistanceKm: distance,
    gapDays: gap,
    jumpKind: gap >= 60 ? "long-gap" : distance < 20 ? "nearby" : "regional",
  };
}

function scaleScenes(drafts: DraftScene[], targetMs: number | null): PremiereScene[] {
  const rawTotal = drafts.reduce((sum, scene) => sum + scene.durationMs, 0);
  const scale = targetMs && rawTotal > 0 ? targetMs / rawTotal : 1;
  let cursor = 0;
  return drafts.map((scene) => {
    const minimum = scene.kind === "finale" ? 4_000 : scene.kind === "prelude" ? 2_000 : 300;
    const durationMs = Math.max(minimum, Math.round(scene.durationMs * scale));
    const finalized: PremiereScene = { ...scene, durationMs, startMs: cursor, endMs: cursor + durationMs };
    cursor += durationMs;
    return finalized;
  });
}

function memoryDrafts(
  routes: AtlasRouteFeature[],
  highlights: string[],
  achievementsByActivity: ReadonlyMap<string, Achievement[]>,
  clusters: PlaceCluster[],
  wellnessByDate: ReadonlyMap<string, DailyWellness>,
): DraftScene[] {
  const routeIndex = new Map(routes.map((route, index) => [route.id, index]));
  const drafts: DraftScene[] = [{ id: "prelude", kind: "prelude", durationMs: 3_000, revealStart: 0, revealEnd: 0 }];
  let revealCursor = 0;
  let previousHighlight: AtlasRouteFeature | null = null;
  highlights.forEach((id, highlightIndex) => {
    const index = routeIndex.get(id);
    if (index === undefined) return;
    if (index > revealCursor) {
      const montage = routes.slice(revealCursor, index);
      drafts.push({
        id: `montage-${highlightIndex}`,
        kind: "montage",
        durationMs: clamp(1_200 + montage.length * 75, 1_200, 4_200),
        revealStart: revealCursor,
        revealEnd: index,
        routeIds: montage.map((route) => route.id),
      });
      revealCursor = index;
    }
    const route = routes[index];
    if (previousHighlight) drafts.push(jumpScene(previousHighlight, route, revealCursor, highlightIndex));
    const meta = rideMeta(route, routes, achievementsByActivity, clusters, wellnessByDate);
    drafts.push({
      id: `ride-${route.id}`,
      kind: "ride",
      durationMs: rideSceneDuration(route, meta, highlightIndex === 0),
      revealStart: revealCursor,
      revealEnd: revealCursor + 1,
      routeId: route.id,
      rideMeta: meta,
    });
    revealCursor = index + 1;
    previousHighlight = route;
  });
  if (revealCursor < routes.length) {
    const montage = routes.slice(revealCursor);
    drafts.push({ id: "montage-final", kind: "montage", durationMs: clamp(1_500 + montage.length * 70, 1_500, 4_500), revealStart: revealCursor, revealEnd: routes.length, routeIds: montage.map((route) => route.id) });
  }
  drafts.push({ id: "finale", kind: "finale", durationMs: 6_000, revealStart: routes.length, revealEnd: routes.length });
  return drafts;
}

function fullDrafts(
  routes: AtlasRouteFeature[],
  achievementsByActivity: ReadonlyMap<string, Achievement[]>,
  clusters: PlaceCluster[],
  wellnessByDate: ReadonlyMap<string, DailyWellness>,
): DraftScene[] {
  const drafts: DraftScene[] = [{ id: "prelude", kind: "prelude", durationMs: 3_000, revealStart: 0, revealEnd: 0 }];
  routes.forEach((route, index) => {
    if (index > 0) drafts.push(jumpScene(routes[index - 1], route, index, index));
    const meta = rideMeta(route, routes, achievementsByActivity, clusters, wellnessByDate);
    drafts.push({ id: `ride-${route.id}`, kind: "ride", durationMs: rideSceneDuration(route, meta, index === 0), revealStart: index, revealEnd: index + 1, routeId: route.id, rideMeta: meta });
  });
  drafts.push({ id: "finale", kind: "finale", durationMs: 6_000, revealStart: routes.length, revealEnd: routes.length });
  return drafts;
}

export function buildPremiereStory(
  routes: AtlasRouteFeature[],
  achievements: Achievement[],
  clusters: PlaceCluster[],
  wellness: DailyWellness[],
  settings: PremiereSettings,
): PremiereStory | null {
  const ordered = [...routes].sort((a, b) => a.activity.localDate.localeCompare(b.activity.localDate) || a.id.localeCompare(b.id));
  if (!ordered.length) return null;
  const achievementsByActivity = new Map<string, Achievement[]>();
  achievements.forEach((achievement) => achievementsByActivity.set(achievement.activityId, [...(achievementsByActivity.get(achievement.activityId) ?? []), achievement]));
  const wellnessByDate = new Map(wellness.map((day) => [day.date, day]));
  const highlightLimit = settings.length === "memory-cut" ? 8 : settings.length === "three-minute" ? 22 : ordered.length;
  const highlights = highlightIds(ordered, achievements, clusters, highlightLimit);
  const drafts = settings.length === "full-chronicle"
    ? fullDrafts(ordered, achievementsByActivity, clusters, wellnessByDate)
    : memoryDrafts(ordered, highlights, achievementsByActivity, clusters, wellnessByDate);
  const scenes = scaleScenes(drafts, settings.length === "memory-cut" ? 60_000 : settings.length === "three-minute" ? 180_000 : null);
  return {
    settings,
    orderedRouteIds: ordered.map((route) => route.id),
    highlightRouteIds: highlights,
    scenes,
    totalDurationMs: scenes.at(-1)?.endMs ?? 0,
    startDate: ordered[0].activity.localDate,
    endDate: ordered.at(-1)!.activity.localDate,
  };
}

export function premiereFrameAt(story: PremiereStory, playheadMs: number): PremiereFrame {
  const time = clamp(playheadMs, 0, story.totalDurationMs);
  let low = 0;
  let high = story.scenes.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (time < story.scenes[middle].endMs) high = middle;
    else low = middle + 1;
  }
  const scene = story.scenes[low];
  const progress = scene.durationMs > 0 ? clamp((time - scene.startMs) / scene.durationMs, 0, 1) : 1;
  const travelProgress = scene.kind === "ride" ? clamp(progress / PREMIERE_RIDE_TRAVEL_SHARE, 0, 1) : progress;
  const imprintProgress = scene.kind === "ride"
    ? clamp((progress - PREMIERE_RIDE_TRAVEL_SHARE) / (1 - PREMIERE_RIDE_TRAVEL_SHARE), 0, 1)
    : 0;
  const revealedCount = scene.kind === "montage"
    ? Math.round(scene.revealStart + (scene.revealEnd - scene.revealStart) * progress)
    : scene.kind === "ride"
      ? imprintProgress >= PREMIERE_IMPRINT_REVEAL_AT ? scene.revealEnd : scene.revealStart
      : scene.revealEnd;
  return {
    sceneIndex: low,
    sceneId: scene.id,
    kind: scene.kind,
    progress,
    travelProgress,
    imprintProgress,
    revealedCount,
    routeId: scene.routeId,
    fromRouteId: scene.fromRouteId,
    toRouteId: scene.toRouteId,
    jumpKind: scene.jumpKind,
    gapDays: scene.gapDays,
    rideMeta: scene.rideMeta,
  };
}

export function premiereSceneStart(story: PremiereStory, sceneIndex: number): number {
  return story.scenes[clamp(Math.round(sceneIndex), 0, story.scenes.length - 1)]?.startMs ?? 0;
}
