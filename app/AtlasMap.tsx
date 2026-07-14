"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { type PickingInfo } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { routePointsForZoom, routesInBounds } from "@/lib/atlas";
import type { Achievement, AtlasRouteFeature, PlaceCluster, RouteBounds } from "@/lib/types";

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
  const routesRef = useRef(routes);
  const [zoom, setZoom] = useState(5);
  const [mapState, setMapState] = useState<"loading" | "ready" | "backup" | "fallback">("loading");
  const [dragBox, setDragBox] = useState<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const achievementIds = useMemo(() => new Set(achievements.map((item) => item.activityId)), [achievements]);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onAchievementSelectRef.current = onAchievementSelect;
    onAreaSelectionRef.current = onAreaSelection;
    onViewportChangeRef.current = onViewportChange;
    routesRef.current = routes;
  }, [onSelect, onAchievementSelect, onAreaSelection, onViewportChange, routes]);

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
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    const flowOverlay = new MapboxOverlay({ interleaved: false, layers: [] });
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
    map.on("zoom", () => setZoom(map.getZoom()));
    map.on("moveend", () => {
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

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const visibleRoutes = routes.map((route) => ({ ...route, renderPath: routePointsForZoom(route, zoom).map((point) => [point.longitude, point.latitude]) as [number, number][] }));
    const colors = (route: (typeof visibleRoutes)[number]) => routeColor(route, colorMode, achievementIds, hiddenIds.has(route.id));
    const halo = new PathLayer({
      id: "atlas-route-halo",
      data: visibleRoutes,
      getPath: (route) => route.renderPath,
      getColor: (route) => { const [r, g, b] = colors(route); return [r, g, b, route.id === selectedId ? 185 : colorMode === "memory" ? 72 : 58]; },
      getWidth: (route) => route.id === selectedId ? 16 : colorMode === "memory" ? 8.5 : 5.5,
      widthUnits: "pixels",
      capRounded: true,
      jointRounded: true,
      pickable: false,
      parameters: { depthWriteEnabled: false },
    });
    const core = new PathLayer({
      id: "atlas-route-core",
      data: visibleRoutes,
      getPath: (route) => route.renderPath,
      getColor: colors,
      getWidth: (route) => route.id === selectedId ? 4.2 : colorMode === "memory" ? 1.9 : 1.7,
      widthUnits: "pixels",
      widthMinPixels: 1,
      capRounded: true,
      jointRounded: true,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 110],
      onClick: (info: PickingInfo<(typeof visibleRoutes)[number]>) => info.object && onSelectRef.current(info.object),
      parameters: { depthWriteEnabled: false },
    });
    const hitArea = new PathLayer({
      id: "atlas-route-hit-area",
      data: visibleRoutes,
      getPath: (route) => route.renderPath,
      getColor: [255, 255, 255, 0],
      getWidth: (route) => route.id === selectedId ? 22 : 14,
      widthUnits: "pixels",
      widthMinPixels: 12,
      capRounded: true,
      jointRounded: true,
      pickable: true,
      onClick: (info: PickingInfo<(typeof visibleRoutes)[number]>) => info.object && onSelectRef.current(info.object),
      parameters: { depthWriteEnabled: false },
    });
    const locatedAchievements = achievements.filter((item) => item.coordinate);
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
      pickable: true,
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
      data: zoom >= 7 ? placeClusters.filter((item) => item.visitCount > 1).slice(0, 18) : [],
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
  }, [routes, achievements, placeClusters, zoom, colorMode, selectedId, achievementIds, hiddenIds, selectedAchievementId]);

  useEffect(() => {
    const overlay = flowOverlayRef.current;
    const selected = routes.find((route) => route.id === selectedId);
    if (!overlay || !selected || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      overlay?.setProps({ layers: [] });
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
  }, [routes, selectedId, zoom]);

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

  return <div className={`atlas-map-wrap aurora-${colorMode}`}>
    <div ref={containerRef} className="atlas-map" aria-label="누적 운동 경로 지도" />
    {mapState === "loading" && <div className="map-status"><i />지도를 깨우는 중</div>}
    {mapState === "backup" && <div className="map-provider-note">보조 지도에 연결했습니다.</div>}
    {mapState === "fallback" && <div className="map-fallback-note">지도 공급자 연결이 모두 지연되어 경로만 표시하고 있습니다. 네트워크가 회복되면 새로고침해 주세요.</div>}
    <div className="map-atmosphere" aria-hidden="true" />
    {interactionMode !== "navigate" && <div className={`map-selection-surface mode-${interactionMode}`} data-testid="map-selection-surface" aria-label={interactionMode === "poster" ? "포스터 영역 드래그 선택" : "숨길 활동 영역 드래그 선택"} onPointerDown={startSelection} onPointerMove={moveSelection} onPointerUp={endSelection} onPointerCancel={() => setDragBox(null)}>{dragBox && <i className="map-selection-box" style={boxStyle} />}</div>}
  </div>;
}
