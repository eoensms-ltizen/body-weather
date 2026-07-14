"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { type PickingInfo } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer, TextLayer } from "@deck.gl/layers";
import { MapboxOverlay } from "@deck.gl/mapbox";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { routePointsForZoom } from "@/lib/atlas";
import type { Achievement, AtlasRouteFeature, PlaceCluster, RouteBounds } from "@/lib/types";

export type AtlasColorMode = "memory" | "sport" | "season" | "effort" | "heart" | "power" | "achievement";

const FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  name: "Body Weather fallback",
  sources: {},
  layers: [{ id: "background", type: "background", paint: { "background-color": "#06151c" } }],
};

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

function routeColor(route: AtlasRouteFeature, mode: AtlasColorMode, achievements: Set<string>): [number, number, number, number] {
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
}: {
  routes: AtlasRouteFeature[];
  bounds: RouteBounds | null;
  achievements: Achievement[];
  placeClusters: PlaceCluster[];
  colorMode: AtlasColorMode;
  selectedId?: string;
  focusCoordinate?: [number, number] | null;
  onSelect: (route: AtlasRouteFeature) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialBoundsRef = useRef(bounds);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const onSelectRef = useRef(onSelect);
  const [zoom, setZoom] = useState(5);
  const [mapState, setMapState] = useState<"loading" | "ready" | "fallback">("loading");
  const achievementIds = useMemo(() => new Set(achievements.map((item) => item.activityId)), [achievements]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const style = process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/fiord";
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [127.3, 36.3],
      zoom: 5.5,
      minZoom: 1.5,
      maxZoom: 18,
      pitchWithRotate: true,
      localIdeographFontFamily: "Pretendard, Noto Sans KR, Malgun Gothic, sans-serif",
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Map data © OpenStreetMap contributors" }), "bottom-right");
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    map.on("click", (event) => {
      const picked = overlay.pickObject({ x: event.point.x, y: event.point.y, radius: 10 });
      if (picked?.object) onSelectRef.current(picked.object as AtlasRouteFeature);
    });
    let recovered = false;
    map.on("load", () => {
      setMapState(recovered ? "fallback" : "ready");
      fitMap(map, initialBoundsRef.current, false);
    });
    map.on("zoom", () => setZoom(map.getZoom()));
    map.on("error", (event) => {
      if (recovered || map.loaded()) return;
      const message = String(event.error?.message ?? "");
      if (!/style|source|fetch|network|load/i.test(message)) return;
      recovered = true;
      map.setStyle(FALLBACK_STYLE);
      setMapState("fallback");
    });
    const loadTimer = window.setTimeout(() => {
      if (recovered || map.loaded()) return;
      recovered = true;
      map.setStyle(FALLBACK_STYLE);
      setMapState("fallback");
      fitMap(map, initialBoundsRef.current, false);
    }, 8_000);
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      window.clearTimeout(loadTimer);
      overlay.finalize();
      map.remove();
      overlayRef.current = null;
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
    const colors = (route: (typeof visibleRoutes)[number]) => routeColor(route, colorMode, achievementIds);
    const halo = new PathLayer({
      id: "atlas-route-halo",
      data: visibleRoutes,
      getPath: (route) => route.renderPath,
      getColor: (route) => { const [r, g, b] = colors(route); return [r, g, b, route.id === selectedId ? 160 : 56]; },
      getWidth: (route) => route.id === selectedId ? 14 : colorMode === "memory" ? 7 : 5,
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
      getWidth: (route) => route.id === selectedId ? 3.8 : 1.65,
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
    const locatedAchievements = achievements.filter((item) => item.coordinate);
    const achievementGlow = new ScatterplotLayer({
      id: "atlas-achievement-glow",
      data: locatedAchievements,
      getPosition: (item) => item.coordinate!,
      getRadius: (item) => item.evidence === "source-confirmed" ? 13 : 9,
      radiusUnits: "pixels",
      getFillColor: (item) => item.evidence === "source-confirmed" ? [248, 197, 75, 75] : [115, 239, 213, 55],
      stroked: true,
      getLineColor: (item) => item.evidence === "source-confirmed" ? [255, 225, 122, 220] : [117, 244, 218, 185],
      lineWidthMinPixels: 1,
      pickable: false,
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
    overlay.setProps({ layers: [halo, core, achievementGlow, achievementText, clusterText] });
  }, [routes, achievements, placeClusters, zoom, colorMode, selectedId, achievementIds]);

  return <div className="atlas-map-wrap">
    <div ref={containerRef} className="atlas-map" aria-label="누적 운동 경로 지도" />
    {mapState === "loading" && <div className="map-status"><i />지도를 깨우는 중</div>}
    {mapState === "fallback" && <div className="map-fallback-note">베이스맵 연결 없이 경로만 안전하게 표시하고 있습니다.</div>}
    <div className="map-atmosphere" aria-hidden="true" />
  </div>;
}
