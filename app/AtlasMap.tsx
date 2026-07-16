"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { type PickingInfo } from "@deck.gl/core";
import { ArcLayer, PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mergeBounds, routePointsForZoom, routesInBounds } from "@/lib/atlas";
import { greatCircleArcPoint, measurePremiereRoutePath, premiereMontageCameraRouteIds, samplePremierePath, smoothPremiereBearing, type PremiereMeasuredPath } from "@/lib/premiere-camera";
import type { PremiereMapState, PremiereSeason } from "@/lib/premiere";
import type { Achievement, AtlasRouteFeature, PlaceCluster, RouteBounds, RoutePoint } from "@/lib/types";

export type AtlasColorMode = "memory" | "sport" | "season" | "effort" | "heart" | "power" | "achievement";
export type AtlasInteractionMode = "navigate" | "poster" | "hide";

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: "Body Weather fallback",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#06151c" } }],
};

const CARTO_DARK_STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const OPEN_FREE_MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/fiord";

const SPORT_COLORS: Record<string, [number, number, number, number]> = {
  run: [255, 104, 140, 230],
  ride: [88, 235, 210, 230],
  walk: [250, 204, 80, 230],
  hike: [170, 230, 100, 230],
};

function seasonColor(date: string): [number, number, number, number] {
  const month = Number(date.slice(5, 7));
  if (month <= 2 || month === 12) return [116, 197, 255, 225];
  if (month <= 5) return [123, 238, 166, 225];
  if (month <= 8) return [255, 202, 80, 225];
  return [252, 113, 145, 225];
}

function metricColor(value: number | null, low: [number, number, number], high: [number, number, number]): [number, number, number, number] {
  if (value === null) return [77, 104, 113, 90];
  const t = Math.max(0.15, Math.min(1, value / 180));
  return [
    Math.round(low[0] + (high[0] - low[0]) * t),
    Math.round(low[1] + (high[1] - low[1]) * t),
    Math.round(low[2] + (high[2] - low[2]) * t),
    225,
  ];
}

function routeColor(route: AtlasRouteFeature, mode: AtlasColorMode, achievements: Set<string>, hidden: boolean): [number, number, number, number] {
  if (hidden) return [117, 135, 139, 100];
  if (mode === "sport") {
    const key = Object.keys(SPORT_COLORS).find((name) => route.activity.type.toLowerCase().includes(name));
    return key ? SPORT_COLORS[key] : [194, 181, 255, 225];
  }
  if (mode === "season") return seasonColor(route.activity.localDate);
  if (mode === "effort") return metricColor(route.activity.trainingLoad.value ?? route.activity.relativeEffort.value, [91, 214, 206], [255, 99, 89]);
  if (mode === "heart") return metricColor(route.activity.averageHeartRate.value, [126, 193, 255], [255, 55, 132]);
  if (mode === "power") return metricColor(route.activity.averagePower.value, [92, 223, 210], [255, 219, 77]);
  if (mode === "achievement") return achievements.has(route.id) ? [248, 197, 75, 250] : [76, 109, 118, 95];
  return [93, 238, 215, 185];
}

function fitMap(map: maplibregl.Map, bounds: RouteBounds | null, animate: boolean) {
  if (!bounds) return;
  if (Math.abs(bounds.east - bounds.west) < 0.00001 && Math.abs(bounds.north - bounds.south) < 0.00001) return;
  map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], {
    padding: { top: 120, right: 110, bottom: 150, left: 110 },
    duration: animate ? 950 : 0,
    maxZoom: 13,
  });
}

function seasonAurora(season: PremiereSeason | undefined): [number, number, number, number] {
  if (season === "spring") return [122, 245, 174, 245];
  if (season === "summer") return [255, 207, 84, 245];
  if (season === "autumn") return [255, 112, 153, 245];
  if (season === "winter") return [112, 202, 255, 245];
  return [91, 239, 215, 245];
}

const PREMIERE_BURN_IN = {
  pulseDuration: 0.42,
  routeBloomBaseWidth: 18,
  routeBloomFlashWidth: 38,
  routeCoreBaseWidth: 3.2,
  routeCoreFlashWidth: 4.5,
  bloomBaseAlpha: 54,
  bloomFlashAlpha: 110,
  coreBaseAlpha: 46,
  coreFlashAlpha: 105,
  travelerBaseRadius: 8,
  travelerFlashRadius: 6,
  travelerSealRadius: 6,
  waveBaseRadius: 24,
  waveTravelRadius: 96,
  waveFlashRadius: 18,
  waveFillAlpha: 30,
  waveLineAlpha: 150,
  labelStart: 0.14,
  labelEnd: 0.58,
  labelSize: 12,
  labelFlashSize: 2,
  screenFlashMaxOpacity: 0.42,
};

type RoutePathLod = "low" | "medium" | "high";
interface CachedRoutePath { sourcePoints: RoutePoint[]; points: [number, number][]; measured?: PremiereMeasuredPath | null; }
type RoutePathCache = Partial<Record<RoutePathLod, CachedRoutePath>>;
interface RenderedAtlasRoute { route: AtlasRouteFeature; renderPath: [number, number][]; }

function routePathLod(zoom: number): RoutePathLod {
  return zoom < 7 ? "low" : zoom < 11 ? "medium" : "high";
}

function cachedRoutePath(cache: WeakMap<AtlasRouteFeature, RoutePathCache>, route: AtlasRouteFeature, zoom: number): CachedRoutePath {
  const lod = routePathLod(zoom);
  const cached = cache.get(route) ?? {};
  const existing = cached[lod];
  if (existing) return existing;
  const sourcePoints = routePointsForZoom(route, zoom);
  const path = { sourcePoints, points: sourcePoints.map((point) => [point.longitude, point.latitude] as [number, number]) };
  cached[lod] = path;
  cache.set(route, cached);
  return path;
}

function measuredRoutePath(cache: WeakMap<AtlasRouteFeature, RoutePathCache>, route: AtlasRouteFeature, zoom: number): PremiereMeasuredPath | null {
  const cached = cachedRoutePath(cache, route, zoom);
  if (cached.measured === undefined) cached.measured = measurePremiereRoutePath(cached.sourcePoints);
  return cached.measured;
}

function easeInOut(progress: number): number {
  return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
}

function bearingBetween(from: [number, number], to: [number, number]): number {
  const radians = (value: number) => value * Math.PI / 180;
  const longitudeDelta = radians(to[0] - from[0]);
  const latitudeA = radians(from[1]);
  const latitudeB = radians(to[1]);
  const y = Math.sin(longitudeDelta) * Math.cos(latitudeB);
  const x = Math.cos(latitudeA) * Math.sin(latitudeB) - Math.sin(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeDelta);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export default function AtlasMap({
  routes,
  bounds,
  achievements,
  placeClusters,
  colorMode,
  selectedId,
  focusCoordinate,
  onSelect,
  interactionMode,
  hiddenIds,
  selectedAchievementId,
  onAchievementSelect,
  onAreaSelection,
  onViewportChange,
  premiere,
  onUserMapInteraction,
}: {
  routes: AtlasRouteFeature[];
  bounds: RouteBounds | null;
  achievements: Achievement[];
  placeClusters: PlaceCluster[];
  colorMode: AtlasColorMode;
  selectedId?: string;
  focusCoordinate?: [number, number] | null;
  onSelect: (route: AtlasRouteFeature) => void;
  interactionMode: AtlasInteractionMode;
  hiddenIds: ReadonlySet<string>;
  selectedAchievementId?: string;
  onAchievementSelect: (achievement: Achievement) => void;
  onAreaSelection: (bounds: RouteBounds, routeIds: string[]) => void;
  onViewportChange: (bounds: RouteBounds) => void;
  premiere?: PremiereMapState | null;
  onUserMapInteraction?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialBoundsRef = useRef(bounds);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const flowOverlayRef = useRef<MapboxOverlay | null>(null);
  const onSelectRef = useRef(onSelect);
  const onAchievementSelectRef = useRef(onAchievementSelect);
  const onAreaSelectionRef = useRef(onAreaSelection);
  const onViewportChangeRef = useRef(onViewportChange);
  const onUserMapInteractionRef = useRef(onUserMapInteraction);
  const premiereRef = useRef(premiere);
  const routesRef = useRef(routes);
  const routePathCacheRef = useRef<WeakMap<AtlasRouteFeature, RoutePathCache>>(new WeakMap());
  const lastPremiereCameraRef = useRef(0);
  const lastPremiereMontageCameraRef = useRef(0);
  const lastPremiereMontageCountRef = useRef(-1);
  const smoothedPremiereBearingRef = useRef(0);
  const lastPremiereBearingRouteRef = useRef<string | null>(null);
  const wasPremiereActiveRef = useRef(false);
  const [zoom, setZoom] = useState(5);
  const [mapState, setMapState] = useState<"loading" | "ready" | "backup" | "fallback">("loading");
  const [dragBox, setDragBox] = useState<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const achievementIds = useMemo(() => new Set(achievements.map((item) => item.activityId)), [achievements]);
  const routeById = useMemo(() => new Map(routes.map((route) => [route.id, route])), [routes]);
  const achievementById = useMemo(() => new Map(achievements.map((achievement) => [achievement.id, achievement])), [achievements]);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onAchievementSelectRef.current = onAchievementSelect;
    onAreaSelectionRef.current = onAreaSelection;
    onViewportChangeRef.current = onViewportChange;
    onUserMapInteractionRef.current = onUserMapInteraction;
    premiereRef.current = premiere;
    routesRef.current = routes;
  }, [onSelect, onAchievementSelect, onAreaSelection, onViewportChange, onUserMapInteraction, premiere, routes]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const configuredStyle = process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim();
    const styleCandidates = Array.from(new Set([configuredStyle, CARTO_DARK_STYLE_URL, OPEN_FREE_MAP_STYLE_URL].filter((item): item is string => Boolean(item))));
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: styleCandidates[0],
      center: [127.3, 36.3],
      zoom: 5.5,
      minZoom: 1.5,
      maxZoom: 18,
      pitchWithRotate: true,
      localIdeographFontFamily: "Pretendard, Noto Sans KR, Malgun Gothic, sans-serif",
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Map data © OpenStreetMap contributors · CARTO / OpenFreeMap" }), "bottom-right");
    // Luma enables its WebGL debug wrapper by default in development builds.
    // That wrapper is useful for shader debugging, but makes large local atlases
    // substantially slower and can conflict with Deck attribute transitions.
    const overlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      deviceProps: { debug: false, debugGPUTime: false, debugWebGL: false },
    });
    const flowOverlay = new MapboxOverlay({
      interleaved: false,
      layers: [],
      deviceProps: { debug: false, debugGPUTime: false, debugWebGL: false },
    });
    map.addControl(overlay as unknown as maplibregl.IControl);
    map.addControl(flowOverlay as unknown as maplibregl.IControl);
    let styleIndex = 0;
    let styleParsed = false;
    let renderReady = false;
    let styleErrors = 0;
    let switchingStyle = false;
    let loadTimer = 0;
    const activateLocalFallback = () => {
      switchingStyle = true;
      window.clearTimeout(loadTimer);
      map.setStyle(FALLBACK_STYLE);
      setMapState("fallback");
      fitMap(map, initialBoundsRef.current, false);
    };
    const switchToNextStyle = () => {
      window.clearTimeout(loadTimer);
      if (styleIndex + 1 >= styleCandidates.length) {
        activateLocalFallback();
        return;
      }
      switchingStyle = true;
      styleParsed = false;
      renderReady = false;
      styleErrors = 0;
      styleIndex += 1;
      setMapState("loading");
      map.setStyle(styleCandidates[styleIndex]);
      window.setTimeout(() => { switchingStyle = false; }, 250);
      armLoadTimer();
    };
    const armLoadTimer = () => {
      window.clearTimeout(loadTimer);
      loadTimer = window.setTimeout(() => {
        if (renderReady) return;
        switchToNextStyle();
      }, 12_000);
    };
    map.on("style.load", () => {
      if (map.getStyle().name === FALLBACK_STYLE.name) return;
      styleParsed = true;
      styleErrors = 0;
      switchingStyle = false;
      fitMap(map, initialBoundsRef.current, false);
    });
    map.on("idle", () => {
      if (map.getStyle().name === FALLBACK_STYLE.name || renderReady) return;
      renderReady = true;
      window.clearTimeout(loadTimer);
      setMapState(styleIndex === 0 ? "ready" : "backup");
    });
    map.on("zoomend", () => {
      const nextZoom = map.getZoom();
      setZoom((currentZoom) => routePathLod(currentZoom) === routePathLod(nextZoom) ? currentZoom : nextZoom);
    });
    map.on("moveend", () => {
      if (premiereRef.current) return;
      const current = map.getBounds();
      onViewportChangeRef.current({ west: current.getWest(), south: current.getSouth(), east: current.getEast(), north: current.getNorth() });
    });
    map.on("error", (event) => {
      if (renderReady || switchingStyle) return;
      const message = String(event.error?.message ?? "");
      if (!/style|stylesheet|fetch|network|json|load/i.test(message)) return;
      styleErrors += 1;
      if (styleParsed && styleErrors < 4) return;
      switchToNextStyle();
    });
    armLoadTimer();
    mapRef.current = map;
    overlayRef.current = overlay;
    flowOverlayRef.current = flowOverlay;
    return () => {
      window.clearTimeout(loadTimer);
      overlay.finalize();
      flowOverlay.finalize();
      map.remove();
      overlayRef.current = null;
      flowOverlayRef.current = null;
      mapRef.current = null;
    };
  }, []); // Map instance is intentionally created once.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds) return;
    fitMap(map, bounds, mapState !== "loading");
  }, [bounds, mapState]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusCoordinate) return;
    map.flyTo({ center: focusCoordinate, zoom: Math.max(11, map.getZoom()), duration: 900 });
  }, [focusCoordinate]);

  const premiereActive = Boolean(premiere);
  const premiereOrderedIds = premiere?.orderedRouteIds;
  const premiereRevealedCount = premiere?.frame.revealedCount ?? 0;
  const premiereRouteId = premiere?.frame.routeId;
  const premiereShowRecords = premiere?.showRecords ?? false;

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const revealedIds = new Set(premiereOrderedIds?.slice(0, premiereRevealedCount) ?? []);
    const sourceRoutes = premiereActive
      ? (premiereOrderedIds ?? []).slice(0, premiereRevealedCount).flatMap((id) => {
        const route = routeById.get(id);
        return route ? [route] : [];
      })
      : routes;
    const visibleRoutes = sourceRoutes.flatMap((route): RenderedAtlasRoute[] => {
      const cached = cachedRoutePath(routePathCacheRef.current, route, zoom);
      return cached.points.length >= 2 ? [{ route, renderPath: cached.points }] : [];
    });
    const activeId = premiereActive ? undefined : selectedId;
    const colors = (item: RenderedAtlasRoute) => routeColor(item.route, colorMode, achievementIds, hiddenIds.has(item.route.id));
    const halo = new PathLayer({
      id: "atlas-route-halo",
      data: visibleRoutes,
      getPath: (item) => item.renderPath,
      getColor: (item) => { const [r, g, b] = colors(item); return [r, g, b, item.route.id === activeId ? 185 : colorMode === "memory" ? 72 : 58]; },
      getWidth: (item) => item.route.id === activeId ? 16 : colorMode === "memory" ? 8.5 : 5.5,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: false,
      parameters: { depthWriteEnabled: false },
    });
    const core = new PathLayer({
      id: "atlas-route-core",
      data: visibleRoutes,
      getPath: (item) => item.renderPath,
      getColor: colors,
      getWidth: (item) => item.route.id === activeId ? 4.2 : colorMode === "memory" ? 1.9 : 1.7,
      widthUnits: "pixels",
      widthMinPixels: 1,
      capRounded: true,
      jointRounded: true,
      pickable: !premiereActive,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 110],
      onClick: (info: PickingInfo<RenderedAtlasRoute>) => info.object && onSelectRef.current(info.object.route),
      parameters: { depthWriteEnabled: false },
    });
    const hitArea = new PathLayer({
      id: "atlas-route-hit-area",
      data: visibleRoutes,
      getPath: (item) => item.renderPath,
      getColor: [255, 255, 255, 0],
      getWidth: (item) => item.route.id === activeId ? 22 : 14,
      widthUnits: "pixels",
      widthMinPixels: 12,
      capRounded: true,
      jointRounded: true,
      pickable: !premiereActive,
      onClick: (info: PickingInfo<RenderedAtlasRoute>) => info.object && onSelectRef.current(info.object.route),
      parameters: { depthWriteEnabled: false },
    });
    const locatedAchievements = achievements.filter((item) => item.coordinate && (!premiereActive || premiereShowRecords && revealedIds.has(item.activityId)));
    const achievementGlow = new ScatterplotLayer({
      id: "atlas-achievement-glow",
      data: locatedAchievements,
      getPosition: (item) => item.coordinate!,
      getRadius: (item) => item.id === selectedAchievementId ? 18 : item.evidence === "source-confirmed" ? 13 : 9,
      radiusUnits: "pixels",
      getFillColor: (item) => item.evidence === "source-confirmed" ? [248, 197, 75, 75] : [115, 239, 213, 55],
      stroked: true,
      getLineColor: (item) => item.evidence === "source-confirmed" ? [255, 225, 122, 220] : [117, 244, 218, 185],
      lineWidthMinPixels: 1,
      pickable: !premiereActive,
      onClick: (info: PickingInfo<Achievement>) => info.object && onAchievementSelectRef.current(info.object),
    });
    const achievementText = new TextLayer({
      id: "atlas-achievement-text",
      data: locatedAchievements,
      getPosition: (item) => item.coordinate!,
      getText: (item) => item.evidence === "source-confirmed" ? "◆" : "★",
      getSize: 15,
      sizeUnits: "pixels",
      getColor: (item) => item.evidence === "source-confirmed" ? [255, 224, 112, 255] : [139, 250, 225, 235],
      getTextAnchor: "middle",
      getAlignmentBaseline: "center",
      pickable: false,
      fontFamily: "Arial, sans-serif",
      characterSet: ["◆", "★"],
    });
    const clusterText = new TextLayer({
      id: "atlas-cluster-text",
      data: !premiereActive && zoom >= 7 ? placeClusters.filter((item) => item.visitCount > 1).slice(0, 18) : [],
      getPosition: (item) => item.center,
      getText: (item) => item.label,
      getSize: 12,
      sizeUnits: "pixels",
      getColor: [226, 244, 237, 225],
      getBackgroundColor: [5, 20, 26, 190],
      background: true,
      backgroundPadding: [7, 4],
      getPixelOffset: [0, -18],
      getTextAnchor: "middle",
      getAlignmentBaseline: "bottom",
      pickable: false,
      fontFamily: "Pretendard, Malgun Gothic, sans-serif",
      characterSet: ["이", " ", "지", "역", "·", "회", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
    });
    overlay.setProps({ layers: [halo, core, hitArea, achievementGlow, achievementText, clusterText] });
  }, [routes, routeById, achievements, placeClusters, zoom, colorMode, selectedId, achievementIds, hiddenIds, selectedAchievementId, premiereActive, premiereOrderedIds, premiereRevealedCount, premiereRouteId, premiereShowRecords]);

  useEffect(() => {
    const overlay = flowOverlayRef.current;
    if (!overlay) return;

    if (premiere) {
      const frame = premiere.frame;
      if (frame.kind === "ride" && frame.routeId) {
        const activeRoute = routeById.get(frame.routeId);
        if (!activeRoute) {
          overlay.setProps({ layers: [] });
          return;
        }
        const measured = measuredRoutePath(routePathCacheRef.current, activeRoute, Math.max(zoom, 9));
        if (!measured) {
          overlay.setProps({ layers: [] });
          return;
        }
        const travelProgress = frame.travelProgress;
        const imprintProgress = frame.imprintProgress;
        const traveler = samplePremierePath(measured, travelProgress);
        const partialPath = [...measured.points.slice(0, traveler.segmentIndex + 1), traveler.point];
        if (partialPath.length < 2) partialPath.push(traveler.point);
        const hotStart = samplePremierePath(measured, Math.max(0, travelProgress - 0.035));
        const hotPath = [
          hotStart.point,
          ...measured.points.slice(hotStart.segmentIndex + 1, traveler.segmentIndex + 1),
          traveler.point,
        ];
        if (hotPath.length < 2) hotPath.push(traveler.point);
        const aurora = seasonAurora(premiere.showSeason ? frame.rideMeta?.season : undefined);
        const recoveryScore = premiere.showRecovery ? frame.rideMeta?.recoveryScore : null;
        const sealFade = Math.max(0, 1 - imprintProgress);
        const auxFade = Math.max(0, 1 - imprintProgress * 1.35);
        const flash = imprintProgress > 0 && imprintProgress <= PREMIERE_BURN_IN.pulseDuration
          ? Math.sin(Math.PI * (imprintProgress / PREMIERE_BURN_IN.pulseDuration))
          : 0;
        const sealStrength = frame.rideMeta?.achievementId ? 1.12 : frame.rideMeta?.firstVisit ? 1.06 : 1;
        const drawAlpha = Math.round(255 * sealFade);
        const sealAlpha = Math.min(255, Math.round((PREMIERE_BURN_IN.bloomBaseAlpha + flash * PREMIERE_BURN_IN.bloomFlashAlpha) * Math.max(0, 1 - imprintProgress * 0.45) * sealStrength));
        const travelerAlpha = Math.round(255 * Math.max(0, 1 - imprintProgress * 1.08));
        const travelerRadius = PREMIERE_BURN_IN.travelerBaseRadius + flash * PREMIERE_BURN_IN.travelerFlashRadius + imprintProgress * PREMIERE_BURN_IN.travelerSealRadius;
        const recoveryColor: [number, number, number, number] = recoveryScore === null || recoveryScore === undefined
          ? [94, 235, 213, 45]
          : recoveryScore >= 70 ? [102, 245, 177, 72] : recoveryScore >= 45 ? [255, 205, 92, 72] : [255, 104, 145, 72];
        const recoveryColorFaded: [number, number, number, number] = [recoveryColor[0], recoveryColor[1], recoveryColor[2], Math.round(recoveryColor[3] * auxFade)];
        const echoPositions = (frame.rideMeta?.echoRouteIds ?? []).flatMap((id, echoIndex) => {
          const route = routeById.get(id);
          if (!route) return [];
          const echoPath = measuredRoutePath(routePathCacheRef.current, route, Math.max(zoom, 9));
          if (!echoPath) return [];
          return [{ position: samplePremierePath(echoPath, travelProgress).point, echoIndex }];
        });
        const achievement = frame.rideMeta?.achievementId ? achievementById.get(frame.rideMeta.achievementId) : undefined;
        const recordPosition = achievement?.coordinate ?? activeRoute.centroid;
        const showRecord = Boolean(premiere.showRecords && achievement && travelProgress >= 0.55 && auxFade > 0.08);
        const showTerritory = Boolean(frame.rideMeta?.firstVisit && travelProgress <= 0.42 && imprintProgress === 0);
        const partialData = travelProgress > 0 && drawAlpha > 4 ? [{ path: partialPath }] : [];
        const hotData = travelProgress > 0 && travelProgress < 1 && imprintProgress === 0 ? [{ path: hotPath }] : [];
        const sealData = imprintProgress > 0 ? [{ path: measured.points }] : [];
        const sealWaveData = flash > 0.02 ? [{ position: traveler.point }] : [];
        const sealedLabelData = imprintProgress > PREMIERE_BURN_IN.labelStart && imprintProgress < PREMIERE_BURN_IN.labelEnd ? [{ position: traveler.point, text: "ACTIVITY SEALED" }] : [];
        overlay.setProps({ layers: [
          new PathLayer({
            id: "premiere-active-halo",
            data: partialData,
            getPath: (item) => item.path,
            getColor: [aurora[0], aurora[1], aurora[2], Math.round(72 * sealFade)],
            getWidth: 22,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: { depthWriteEnabled: false },
          }),
          new PathLayer({
            id: "premiere-active-core",
            data: partialData,
            getPath: (item) => item.path,
            getColor: [aurora[0], aurora[1], aurora[2], drawAlpha],
            getWidth: 4.2,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: { depthWriteEnabled: false },
          }),
          new PathLayer({
            id: "premiere-active-hot-trail",
            data: hotData,
            getPath: (item) => item.path,
            getColor: [246, 255, 252, 238],
            getWidth: 2.8,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: { depthWriteEnabled: false },
          }),
          new PathLayer({
            id: "premiere-seal-bloom",
            data: sealData,
            getPath: (item) => item.path,
            getColor: [aurora[0], aurora[1], aurora[2], sealAlpha],
            getWidth: PREMIERE_BURN_IN.routeBloomBaseWidth + flash * PREMIERE_BURN_IN.routeBloomFlashWidth * sealStrength,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: { depthWriteEnabled: false },
          }),
          new PathLayer({
            id: "premiere-seal-core",
            data: sealData,
            getPath: (item) => item.path,
            getColor: [252, 255, 247, Math.min(255, Math.round((PREMIERE_BURN_IN.coreBaseAlpha + flash * PREMIERE_BURN_IN.coreFlashAlpha) * sealFade))],
            getWidth: PREMIERE_BURN_IN.routeCoreBaseWidth + flash * PREMIERE_BURN_IN.routeCoreFlashWidth,
            widthUnits: "pixels",
            capRounded: true,
            jointRounded: true,
            parameters: { depthWriteEnabled: false },
          }),
          new ScatterplotLayer({
            id: "premiere-recovery-aura",
            data: auxFade > 0.05 ? [{ position: traveler.point }] : [],
            getPosition: (item) => item.position,
            getRadius: recoveryScore === null || recoveryScore === undefined ? 25 : 32 + recoveryScore * 0.45,
            radiusUnits: "pixels",
            getFillColor: recoveryColorFaded,
            stroked: true,
            getLineColor: [recoveryColor[0], recoveryColor[1], recoveryColor[2], Math.round(120 * auxFade)],
            lineWidthMinPixels: 1,
            parameters: { depthWriteEnabled: false },
          }),
          new ScatterplotLayer({
            id: "premiere-echo-travelers",
            data: auxFade > 0.05 ? echoPositions : [],
            getPosition: (item) => item.position,
            getRadius: (item) => Math.max(3, 6 - item.echoIndex * 0.5),
            radiusUnits: "pixels",
            getFillColor: (item) => [145, 125, 255, Math.round(Math.max(42, 135 - item.echoIndex * 18) * auxFade)],
            stroked: true,
            getLineColor: [184, 167, 255, Math.round(125 * auxFade)],
            lineWidthMinPixels: 1,
            parameters: { depthWriteEnabled: false },
          }),
          new ScatterplotLayer({
            id: "premiere-traveler",
            data: travelerAlpha > 6 ? [{ position: traveler.point }] : [],
            getPosition: (item) => item.position,
            getRadius: travelerRadius,
            radiusUnits: "pixels",
            getFillColor: [246, 255, 252, travelerAlpha],
            stroked: true,
            getLineColor: [aurora[0], aurora[1], aurora[2], travelerAlpha],
            lineWidthMinPixels: 3,
            parameters: { depthWriteEnabled: false },
          }),
          new ScatterplotLayer({
            id: "premiere-seal-wave",
            data: sealWaveData,
            getPosition: (item) => item.position,
            getRadius: PREMIERE_BURN_IN.waveBaseRadius + imprintProgress * PREMIERE_BURN_IN.waveTravelRadius + flash * PREMIERE_BURN_IN.waveFlashRadius,
            radiusUnits: "pixels",
            getFillColor: [aurora[0], aurora[1], aurora[2], Math.round(PREMIERE_BURN_IN.waveFillAlpha * sealFade)],
            stroked: true,
            getLineColor: achievement?.evidence === "source-confirmed" ? [255, 224, 122, Math.round(PREMIERE_BURN_IN.waveLineAlpha * sealFade)] : [aurora[0], aurora[1], aurora[2], Math.round(PREMIERE_BURN_IN.waveLineAlpha * sealFade)],
            lineWidthMinPixels: 2,
            parameters: { depthWriteEnabled: false },
          }),
          new TextLayer({
            id: "premiere-seal-label",
            data: sealedLabelData,
            getPosition: (item) => item.position,
            getText: (item) => item.text,
            getSize: PREMIERE_BURN_IN.labelSize + flash * PREMIERE_BURN_IN.labelFlashSize,
            getColor: [238, 255, 249, Math.round(240 * sealFade)],
            getPixelOffset: [0, -42],
            getTextAnchor: "middle",
            getAlignmentBaseline: "bottom",
            fontFamily: "Arial, sans-serif",
          }),
          new ScatterplotLayer({
            id: "premiere-territory-bloom",
            data: showTerritory ? [{ position: activeRoute.centroid }] : [],
            getPosition: (item) => item.position,
            getRadius: 34 + travelProgress * 120,
            radiusUnits: "pixels",
            getFillColor: [105, 244, 181, Math.round(65 * (1 - travelProgress))],
            stroked: true,
            getLineColor: [128, 255, 198, 175],
            lineWidthMinPixels: 1,
            parameters: { depthWriteEnabled: false },
          }),
          new TextLayer({
            id: "premiere-territory-label",
            data: showTerritory ? [{ position: activeRoute.centroid, text: "NEW TERRITORY" }] : [],
            getPosition: (item) => item.position,
            getText: (item) => item.text,
            getSize: 13,
            getColor: [188, 255, 219, 245],
            getPixelOffset: [0, -34],
            getTextAnchor: "middle",
            getAlignmentBaseline: "bottom",
            fontFamily: "Arial, sans-serif",
          }),
          new ScatterplotLayer({
            id: "premiere-record-beacon",
            data: showRecord ? [{ position: recordPosition }] : [],
            getPosition: (item) => item.position,
            getRadius: 24 + Math.sin(travelProgress * Math.PI * 8) * 4,
            radiusUnits: "pixels",
            getFillColor: [255, 202, 78, Math.round(50 * auxFade)],
            stroked: true,
            getLineColor: [255, 224, 132, Math.round(225 * auxFade)],
            lineWidthMinPixels: 2,
            parameters: { depthWriteEnabled: false },
          }),
          new TextLayer({
            id: "premiere-record-label",
            data: showRecord ? [{ position: recordPosition, text: achievement?.evidence === "source-confirmed" ? "◆ RECORD" : "★ ATLAS RECORD" }] : [],
            getPosition: (item) => item.position,
            getText: (item) => item.text,
            getSize: 15,
            getColor: [255, 226, 132, 255],
            getPixelOffset: [0, -31],
            getTextAnchor: "middle",
            getAlignmentBaseline: "bottom",
            fontFamily: "Arial, sans-serif",
          }),
        ] });
        return;
      }

      if (frame.kind === "jump" && frame.fromRouteId && frame.toRouteId) {
        const from = routeById.get(frame.fromRouteId);
        const to = routeById.get(frame.toRouteId);
        if (!from || !to) {
          overlay.setProps({ layers: [] });
          return;
        }
        const arcHeight = frame.jumpKind === "long-gap" ? 0.28 : frame.jumpKind === "regional" ? 0.18 : 0.08;
        const progress = easeInOut(frame.progress);
        const position = greatCircleArcPoint(from.centroid, to.centroid, progress, arcHeight);
        const midpoint = greatCircleArcPoint(from.centroid, to.centroid, 0.5, arcHeight);
        const trail = Array.from({ length: 7 }, (_, index) => ({
          position: greatCircleArcPoint(from.centroid, to.centroid, Math.max(0, progress - index * 0.035), arcHeight),
          radius: Math.max(2.5, 8 - index * 0.8),
          alpha: Math.max(28, 185 - index * 24),
        }));
        const jumpText = frame.jumpKind === "long-gap" && frame.gapDays ? `${frame.gapDays.toLocaleString("ko-KR")} DAYS LATER` : "MEMORY JUMP";
        overlay.setProps({ layers: [
          new ArcLayer({
            id: "premiere-memory-jump",
            data: [{ source: from.centroid, target: to.centroid }],
            getSourcePosition: (item) => item.source,
            getTargetPosition: (item) => item.target,
            getSourceColor: [95, 239, 215, 205],
            getTargetColor: frame.jumpKind === "long-gap" ? [255, 111, 157, 225] : [169, 142, 255, 225],
            getWidth: frame.jumpKind === "long-gap" ? 5 : 3,
            getHeight: arcHeight,
            widthUnits: "pixels",
            greatCircle: true,
            parameters: { depthWriteEnabled: false },
          }),
          new ScatterplotLayer({
            id: "premiere-jump-trail",
            data: trail,
            getPosition: (item) => item.position,
            getRadius: (item) => item.radius,
            radiusUnits: "pixels",
            getFillColor: (item) => [169, 142, 255, item.alpha],
            parameters: { depthWriteEnabled: false },
          }),
          new ScatterplotLayer({
            id: "premiere-jump-traveler",
            data: [{ position }],
            getPosition: (item) => item.position,
            getRadius: 10,
            radiusUnits: "pixels",
            getFillColor: [248, 255, 252, 255],
            stroked: true,
            getLineColor: [169, 142, 255, 245],
            lineWidthMinPixels: 3,
            parameters: { depthWriteEnabled: false },
          }),
          new TextLayer({
            id: "premiere-jump-label",
            data: [{ position: midpoint, text: jumpText }],
            getPosition: (item) => item.position,
            getText: (item) => item.text,
            getSize: 14,
            getColor: [223, 214, 255, 245],
            getPixelOffset: [0, -20],
            getTextAnchor: "middle",
            getAlignmentBaseline: "bottom",
            fontFamily: "Arial, sans-serif",
          }),
        ] });
        return;
      }

      if (frame.kind === "montage" && frame.revealedCount > 0) {
        const latest = routeById.get(premiere.orderedRouteIds[Math.min(frame.revealedCount - 1, premiere.orderedRouteIds.length - 1)]);
        overlay.setProps({ layers: latest ? [new ScatterplotLayer({
          id: "premiere-montage-pulse",
          data: [{ position: latest.centroid }],
          getPosition: (item) => item.position,
          getRadius: 22 + frame.progress * 44,
          radiusUnits: "pixels",
          getFillColor: [94, 239, 215, Math.round(75 * (1 - frame.progress))],
          stroked: true,
          getLineColor: [132, 252, 224, 175],
          lineWidthMinPixels: 1,
          parameters: { depthWriteEnabled: false },
        })] : [] });
        return;
      }

      overlay?.setProps({ layers: [] });
      return;
    }

    const selected = routes.find((route) => route.id === selectedId);
    if (!selected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      overlay.setProps({ layers: [] });
      return;
    }
    const points = routePointsForZoom(selected, zoom).map((point) => [point.longitude, point.latitude] as [number, number]);
    if (points.length < 2) return;
    let frame = 0;
    let previous = 0;
    const animate = (timestamp: number) => {
      if (timestamp - previous > 34) {
        previous = timestamp;
        const head = Math.floor(timestamp / 42) % points.length;
        const trail = Array.from({ length: 7 }, (_, index) => ({
          position: points[(head - index * 2 + points.length) % points.length],
          radius: Math.max(2.5, 7 - index),
          alpha: Math.max(35, 245 - index * 48),
          index,
        }));
        overlay.setProps({ layers: [new ScatterplotLayer({
          id: "selected-trace-flow",
          data: trail,
          getPosition: (item) => item.position,
          getRadius: (item) => item.radius,
          radiusUnits: "pixels",
          getFillColor: (item) => item.index % 3 === 1 ? [159, 132, 255, item.alpha] : item.index % 3 === 2 ? [92, 235, 174, item.alpha] : [245, 255, 251, item.alpha],
          stroked: true,
          getLineColor: [104, 236, 210, 230],
          lineWidthMinPixels: 1,
          pickable: false,
          parameters: { depthWriteEnabled: false },
        })] });
      }
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      overlay.setProps({ layers: [] });
    };
  }, [routes, routeById, achievementById, selectedId, zoom, premiere]);

  const premiereSceneId = premiere?.frame.sceneId;
  const premiereKind = premiere?.frame.kind;
  const premiereFromRouteId = premiere?.frame.fromRouteId;
  const premiereToRouteId = premiere?.frame.toRouteId;
  const premiereProgress = premiere?.frame.progress ?? 0;
  const premiereTravelProgress = premiere?.frame.travelProgress ?? 0;
  const premiereImprintProgress = premiere?.frame.imprintProgress ?? 0;
  const premiereCameraMode = premiere?.cameraMode;
  const premiereFreeLook = premiere?.freeLook ?? false;
  const premiereReducedMotion = premiere?.reducedMotion ?? false;
  const premierePlaybackSpeed = premiere?.playbackSpeed ?? 1;
  const premiereCameraTuning = premiere?.cameraTuning;
  const premiereSeason = premiere?.frame.rideMeta?.season;
  const premiereBurnFlashOpacity = !premiereReducedMotion && premiereKind === "ride" && premiereImprintProgress > 0
    ? PREMIERE_BURN_IN.screenFlashMaxOpacity * (
      premiereImprintProgress <= PREMIERE_BURN_IN.pulseDuration
        ? Math.sin(Math.PI * (premiereImprintProgress / PREMIERE_BURN_IN.pulseDuration))
        : 0
    )
    : 0;

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !premiereActive || premiereFreeLook) return;
    const storyRoutes = (premiereOrderedIds ?? []).flatMap((id) => {
      const route = routeById.get(id);
      return route ? [route] : [];
    });
    const duration = premiereReducedMotion ? 0 : 1_250;
    if (premiereKind === "prelude" || premiereKind === "finale") {
      if (premiereKind === "prelude") {
        lastPremiereBearingRouteRef.current = null;
        smoothedPremiereBearingRef.current = map.getBearing();
      }
      const storyBounds = mergeBounds(storyRoutes.map((route) => route.bounds));
      if (storyBounds) {
        map.fitBounds([[storyBounds.west, storyBounds.south], [storyBounds.east, storyBounds.north]], {
          padding: { top: 130, right: 120, bottom: 165, left: 120 },
          duration,
          maxZoom: 12,
          pitch: premiereKind === "finale" ? 20 : 0,
        });
      }
      return;
    }
    if (premiereKind === "jump" && premiereFromRouteId && premiereToRouteId) {
      const from = routeById.get(premiereFromRouteId);
      const to = routeById.get(premiereToRouteId);
      const jumpBounds = from && to ? mergeBounds([from.bounds, to.bounds]) : null;
      if (jumpBounds) {
        map.fitBounds([[jumpBounds.west, jumpBounds.south], [jumpBounds.east, jumpBounds.north]], {
          padding: { top: 170, right: 155, bottom: 190, left: 155 },
          duration,
          maxZoom: 10.5,
          pitch: 28,
        });
      }
      return;
    }
    if (premiereKind === "ride" && (premiereCameraMode === "overview" || premiereCameraTuning?.fitActivity) && premiereRouteId) {
      const route = routeById.get(premiereRouteId);
      if (route) {
        const camera = map.cameraForBounds([[route.bounds.west, route.bounds.south], [route.bounds.east, route.bounds.north]], {
          padding: { top: 150, right: 140, bottom: 185, left: 140 },
          bearing: 0,
        });
        const minimum = premiereCameraTuning?.minZoom ?? 1.5;
        const maximum = premiereCameraTuning?.maxZoom ?? 13;
        map.easeTo({
          center: camera?.center ?? route.centroid,
          zoom: Math.max(minimum, Math.min(maximum, camera?.zoom ?? 11)),
          bearing: 0,
          pitch: premiereCameraMode === "direction" ? 30 : 18,
          duration,
        });
      }
    }
  }, [premiereActive, premiereSceneId, premiereKind, premiereFromRouteId, premiereToRouteId, premiereCameraMode, premiereCameraTuning, premiereFreeLook, premiereReducedMotion, premiereOrderedIds, premiereRouteId, routeById]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !premiereActive || premiereKind !== "montage" || premiereFreeLook) return;
    const revealedRouteIds = premiereMontageCameraRouteIds(premiereOrderedIds ?? [], premiereRevealedCount);
    if (revealedRouteIds.length === 0 || lastPremiereMontageCountRef.current === revealedRouteIds.length) return;

    const now = performance.now();
    const speedScale = Math.sqrt(Math.max(0.1, premierePlaybackSpeed));
    const cameraCadence = Math.max(90, 240 / speedScale);
    if (!premiereReducedMotion && now - lastPremiereMontageCameraRef.current < cameraCadence && premiereProgress < 0.98) return;

    const revealedRoutes = revealedRouteIds.flatMap((id) => {
      const route = routeById.get(id);
      return route ? [route] : [];
    });
    const revealedBounds = mergeBounds(revealedRoutes.map((route) => route.bounds));
    if (!revealedBounds) return;

    const compact = map.getContainer().clientWidth < 720;
    const padding = compact
      ? { top: 105, right: 34, bottom: 165, left: 34 }
      : { top: 130, right: 110, bottom: 180, left: 110 };
    const camera = map.cameraForBounds(
      [[revealedBounds.west, revealedBounds.south], [revealedBounds.east, revealedBounds.north]],
      { padding, bearing: 0 },
    );
    if (!camera) return;

    lastPremiereMontageCameraRef.current = now;
    lastPremiereMontageCountRef.current = revealedRouteIds.length;
    map.easeTo({
      center: camera.center,
      zoom: Math.max(1.5, Math.min(10.5, camera.zoom ?? map.getZoom())),
      bearing: 0,
      pitch: compact ? 6 : 12,
      duration: premiereReducedMotion ? 0 : Math.max(180, 560 / speedScale),
      easing: (value) => 1 - Math.pow(1 - value, 3),
    });
  }, [premiereActive, premiereKind, premiereProgress, premierePlaybackSpeed, premiereFreeLook, premiereReducedMotion, premiereOrderedIds, premiereRevealedCount, routeById]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !premiereActive || premiereKind !== "ride" || !premiereRouteId || premiereFreeLook || premiereReducedMotion || premiereCameraMode === "overview" || !premiereCameraTuning) return;
    const now = performance.now();
    const elapsed = lastPremiereCameraRef.current ? now - lastPremiereCameraRef.current : 180;
    if (elapsed < 150) return;
    lastPremiereCameraRef.current = now;
    const route = routeById.get(premiereRouteId);
    if (!route) return;
    const measured = measuredRoutePath(routePathCacheRef.current, route, Math.max(zoom, 9));
    if (!measured) return;
    const traveler = samplePremierePath(measured, premiereTravelProgress);
    const leadProgress = Math.min(1, premiereTravelProgress + 0.025);
    const lead = samplePremierePath(measured, leadProgress);
    const bearingOrigin = leadProgress > premiereTravelProgress
      ? traveler.point
      : samplePremierePath(measured, Math.max(0, premiereTravelProgress - 0.025)).point;
    if (lastPremiereBearingRouteRef.current !== premiereRouteId) {
      lastPremiereBearingRouteRef.current = premiereRouteId;
      smoothedPremiereBearingRef.current = map.getBearing();
    }
    const targetBearing = premiereCameraMode === "direction" ? bearingBetween(bearingOrigin, lead.point) : 0;
    const bearing = premiereCameraMode === "direction"
      ? smoothPremiereBearing(smoothedPremiereBearingRef.current, targetBearing, elapsed, premiereCameraTuning, premierePlaybackSpeed)
      : smoothPremiereBearing(smoothedPremiereBearingRef.current, 0, elapsed, { ...premiereCameraTuning, rotationStrength: 1 }, 1);
    smoothedPremiereBearingRef.current = bearing;
    const fitCamera = premiereCameraTuning.fitActivity
      ? map.cameraForBounds([[route.bounds.west, route.bounds.south], [route.bounds.east, route.bounds.north]], {
        padding: { top: 150, right: 140, bottom: 185, left: 140 },
        bearing,
      })
      : undefined;
    const zoomTarget = premiereCameraTuning.fitActivity ? fitCamera?.zoom ?? premiereCameraTuning.followZoom : premiereCameraTuning.followZoom;
    map.easeTo({
      center: premiereCameraTuning.fitActivity ? fitCamera?.center ?? route.centroid : premiereCameraMode === "direction" ? lead.point : traveler.point,
      zoom: Math.max(premiereCameraTuning.minZoom, Math.min(premiereCameraTuning.maxZoom, zoomTarget)),
      pitch: premiereCameraTuning.fitActivity ? premiereCameraMode === "direction" ? 30 : 18 : premiereCameraMode === "direction" ? 48 : 32,
      bearing,
      duration: 360,
      easing: (value) => 1 - Math.pow(1 - value, 3),
    });
  }, [premiereActive, premiereKind, premiereRouteId, premiereTravelProgress, premiereCameraMode, premiereCameraTuning, premierePlaybackSpeed, premiereFreeLook, premiereReducedMotion, routeById, zoom]);

  useEffect(() => {
    if (wasPremiereActiveRef.current && !premiereActive && mapRef.current) fitMap(mapRef.current, bounds, true);
    if (!premiereActive) {
      lastPremiereCameraRef.current = 0;
      lastPremiereMontageCameraRef.current = 0;
      lastPremiereMontageCountRef.current = -1;
      lastPremiereBearingRouteRef.current = null;
      smoothedPremiereBearingRef.current = 0;
    }
    wasPremiereActiveRef.current = premiereActive;
  }, [bounds, premiereActive]);

  const pointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  const startSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (interactionMode === "navigate") return;
    const point = pointerPosition(event);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragBox({ startX: point.x, startY: point.y, ...point });
  };
  const moveSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragBox) return;
    const point = pointerPosition(event);
    setDragBox((current) => current ? { ...current, ...point } : null);
  };
  const endSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragBox || !mapRef.current) return;
    const point = pointerPosition(event);
    const width = Math.abs(point.x - dragBox.startX);
    const height = Math.abs(point.y - dragBox.startY);
    setDragBox(null);
    if (width < 8 || height < 8) return;
    const first = mapRef.current.unproject([dragBox.startX, dragBox.startY]);
    const second = mapRef.current.unproject([point.x, point.y]);
    const selectedBounds = {
      west: Math.min(first.lng, second.lng), south: Math.min(first.lat, second.lat),
      east: Math.max(first.lng, second.lng), north: Math.max(first.lat, second.lat),
    };
    onAreaSelectionRef.current(selectedBounds, routesInBounds(routesRef.current, selectedBounds).map((route) => route.id));
  };

  const boxStyle = dragBox ? {
    left: Math.min(dragBox.startX, dragBox.x), top: Math.min(dragBox.startY, dragBox.y),
    width: Math.abs(dragBox.x - dragBox.startX), height: Math.abs(dragBox.y - dragBox.startY),
  } : undefined;

  return <div className={`atlas-map-wrap aurora-${colorMode}${premiereActive ? ` premiere-active premiere-${premiereSeason ?? "memory"}` : ""}`} onPointerDown={() => { if (premiereRef.current) onUserMapInteractionRef.current?.(); }} onWheel={() => { if (premiereRef.current) onUserMapInteractionRef.current?.(); }}>
    <div ref={containerRef} className="atlas-map" aria-label="누적 운동 경로 지도" />
    {mapState === "loading" && <div className="map-status"><i />지도를 깨우는 중</div>}
    {mapState === "backup" && <div className="map-provider-note">보조 지도에 연결했습니다.</div>}
    {mapState === "fallback" && <div className="map-fallback-note">지도 공급자 연결이 모두 지연되어 경로만 표시하고 있습니다. 네트워크가 회복되면 새로고침해 주세요.</div>}
    <div className="map-atmosphere" aria-hidden="true" />
    <div className="premiere-burn-flash" aria-hidden="true" style={{ opacity: premiereBurnFlashOpacity }} />
    {!premiereActive && interactionMode !== "navigate" && <div className={`map-selection-surface mode-${interactionMode}`} data-testid="map-selection-surface" aria-label={interactionMode === "poster" ? "포스터 영역 드래그 선택" : "숨길 활동 영역 드래그 선택"} onPointerDown={startSelection} onPointerMove={moveSelection} onPointerUp={endSelection} onPointerCancel={() => setDragBox(null)}>{dragBox && <i className="map-selection-box" style={boxStyle} />}</div>}
  </div>;
}
