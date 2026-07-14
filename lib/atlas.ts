import {
  CALCULATION_VERSION,
  type Achievement,
  type Activity,
  type AtlasModel,
  type AtlasRouteFeature,
  type PlaceCluster,
  type PrivacyZone,
  type RouteBounds,
  type RoutePoint,
} from "./types";

const EARTH_RADIUS_METERS = 6_371_000;

export function isValidRoutePoint(point: RoutePoint): boolean {
  return Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    point.latitude >= -85 && point.latitude <= 85 &&
    point.longitude >= -180 && point.longitude <= 180;
}

export function routeBounds(points: RoutePoint[]): RouteBounds | null {
  const valid = points.filter(isValidRoutePoint);
  if (valid.length < 2) return null;
  const longitudes = valid.map((point) => point.longitude);
  const shifted = longitudes.map((longitude) => longitude < 0 ? longitude + 360 : longitude);
  const directWest = Math.min(...longitudes);
  const directEast = Math.max(...longitudes);
  const shiftedWest = Math.min(...shifted);
  const shiftedEast = Math.max(...shifted);
  const crossesAntimeridian = shiftedEast - shiftedWest < directEast - directWest;
  return {
    west: crossesAntimeridian ? shiftedWest : directWest,
    south: Math.min(...valid.map((point) => point.latitude)),
    east: crossesAntimeridian ? shiftedEast : directEast,
    north: Math.max(...valid.map((point) => point.latitude)),
  };
}

export function mergeBounds(values: RouteBounds[]): RouteBounds | null {
  if (!values.length) return null;
  return {
    west: Math.min(...values.map((value) => value.west)),
    south: Math.min(...values.map((value) => value.south)),
    east: Math.max(...values.map((value) => value.east)),
    north: Math.max(...values.map((value) => value.north)),
  };
}

export function haversineMeters(a: RoutePoint, b: RoutePoint): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function perpendicularDistance(point: RoutePoint, start: RoutePoint, end: RoutePoint): number {
  const x = point.longitude;
  const y = point.latitude;
  const x1 = start.longitude;
  const y1 = start.latitude;
  const x2 = end.longitude;
  const y2 = end.latitude;
  const denominator = (x2 - x1) ** 2 + (y2 - y1) ** 2;
  if (denominator === 0) return Math.hypot(x - x1, y - y1);
  const t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / denominator));
  return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)));
}

function simplifyValidRoute(valid: RoutePoint[], tolerance: number): RoutePoint[] {
  if (valid.length <= 2 || tolerance <= 0) return valid.map((point) => ({ ...point }));
  let maxDistance = 0;
  let index = 0;
  for (let cursor = 1; cursor < valid.length - 1; cursor += 1) {
    const distance = perpendicularDistance(valid[cursor], valid[0], valid[valid.length - 1]);
    if (distance > maxDistance) {
      index = cursor;
      maxDistance = distance;
    }
  }
  if (maxDistance <= tolerance) return [{ ...valid[0] }, { ...valid[valid.length - 1] }];
  const left = simplifyValidRoute(valid.slice(0, index + 1), tolerance);
  const right = simplifyValidRoute(valid.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

export function simplifyRoute(points: RoutePoint[], tolerance: number): RoutePoint[] {
  return simplifyValidRoute(points.filter(isValidRoutePoint), tolerance);
}

export function detectPrivacyZones(routes: RoutePoint[][]): PrivacyZone[] {
  const endpoints = routes.flatMap((route) => {
    const valid = route.filter(isValidRoutePoint);
    return valid.length >= 2 ? [valid[0], valid[valid.length - 1]] : [];
  });
  const consumed = new Set<number>();
  const zones: PrivacyZone[] = [];
  endpoints.forEach((point, index) => {
    if (consumed.has(index)) return;
    const members = endpoints
      .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
      .filter(({ candidate }) => haversineMeters(point, candidate) <= 250);
    members.forEach(({ candidateIndex }) => consumed.add(candidateIndex));
    if (members.length < 3) return;
    zones.push({
      id: `privacy-${zones.length + 1}`,
      latitude: members.reduce((sum, item) => sum + item.candidate.latitude, 0) / members.length,
      longitude: members.reduce((sum, item) => sum + item.candidate.longitude, 0) / members.length,
      radiusMeters: 300,
      evidenceCount: members.length,
    });
  });
  return zones;
}

export function maskRoute(points: RoutePoint[], zones: PrivacyZone[]): RoutePoint[] {
  if (!zones.length) return points.filter(isValidRoutePoint).map((point) => ({ ...point }));
  return points.filter(isValidRoutePoint).filter((point) => !zones.some((zone) => haversineMeters(point, {
    latitude: zone.latitude,
    longitude: zone.longitude,
  }) <= zone.radiusMeters)).map((point) => ({ ...point }));
}

function midpoint(points: RoutePoint[]): [number, number] | undefined {
  const point = points[Math.floor(points.length / 2)];
  return point ? [point.longitude, point.latitude] : undefined;
}

function unwrapLongitudes(points: RoutePoint[]): RoutePoint[] {
  if (!points.length) return [];
  const unwrapped = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    let longitude = points[index].longitude;
    const previous = unwrapped[index - 1].longitude;
    while (longitude - previous > 180) longitude -= 360;
    while (previous - longitude > 180) longitude += 360;
    unwrapped.push({ ...points[index], longitude });
  }
  return unwrapped;
}

function routeLengthMeters(points: RoutePoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversineMeters(points[index - 1], points[index]);
  return total;
}

function createRouteFeature(activity: Activity, points: RoutePoint[], zones: PrivacyZone[], maskPrivate: boolean): AtlasRouteFeature | null {
  const clean = points.filter(isValidRoutePoint);
  const renderPoints = maskPrivate ? maskRoute(clean, zones) : clean.map((point) => ({ ...point }));
  if (renderPoints.length < 2 || routeLengthMeters(renderPoints) < 1) return null;
  const bounds = routeBounds(renderPoints);
  if (!bounds || renderPoints.length < 2) return null;
  const displayPoints = unwrapLongitudes(renderPoints);
  return {
    id: activity.id,
    activity,
    bounds,
    centroid: [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2],
    rawPointCount: clean.length,
    lod: {
      low: simplifyValidRoute(displayPoints, 0.004),
      medium: simplifyValidRoute(displayPoints, 0.0008),
      high: simplifyValidRoute(displayPoints, 0.00012),
    },
    masked: maskPrivate && renderPoints.length !== clean.length,
  };
}

function personalRecordAchievements(routes: AtlasRouteFeature[]): Achievement[] {
  const byType = new Map<string, AtlasRouteFeature[]>();
  routes.forEach((route) => {
    const key = route.activity.type || "Activity";
    byType.set(key, [...(byType.get(key) ?? []), route]);
  });
  const achievements: Achievement[] = [];
  byType.forEach((typedRoutes, type) => {
    const longest = [...typedRoutes].filter((route) => route.activity.distance.value !== null)
      .sort((a, b) => (b.activity.distance.value ?? -1) - (a.activity.distance.value ?? -1))[0];
    if (longest) achievements.push({
      id: `personal-distance-${type}`,
      activityId: longest.activity.id,
      kind: "personal_distance",
      title: `${type} 최장 거리`,
      description: `${longest.activity.distance.value?.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} ${longest.activity.distance.unit}`,
      evidence: "derived",
      coordinate: midpoint(longest.lod.high),
      sourceFile: longest.activity.sourceFile,
      sourceField: "Distance",
      confidence: longest.activity.distance.confidence,
      calculationVersion: CALCULATION_VERSION,
    });
    const longestDuration = [...typedRoutes].filter((route) => route.activity.movingTime.value !== null)
      .sort((a, b) => (b.activity.movingTime.value ?? -1) - (a.activity.movingTime.value ?? -1))[0];
    if (longestDuration && longestDuration.activity.id !== longest?.activity.id) achievements.push({
      id: `personal-duration-${type}`,
      activityId: longestDuration.activity.id,
      kind: "personal_duration",
      title: `${type} 최장 시간`,
      description: `${Math.round((longestDuration.activity.movingTime.value ?? 0) / 60).toLocaleString("ko-KR")}분`,
      evidence: "derived",
      coordinate: midpoint(longestDuration.lod.high),
      sourceFile: longestDuration.activity.sourceFile,
      sourceField: "Moving Time",
      confidence: longestDuration.activity.movingTime.confidence,
      calculationVersion: CALCULATION_VERSION,
    });
  });
  return achievements;
}

function sourceAchievements(routes: AtlasRouteFeature[]): Achievement[] {
  return routes.flatMap((route) => {
    const count = route.activity.achievementCount?.value;
    if (!count || count <= 0) return [];
    return [{
      id: `source-achievement-${route.id}`,
      activityId: route.id,
      kind: "source_achievement" as const,
      title: `성과 ${Math.round(count)}개`,
      description: "원본에는 성과 개수만 있으며 KOM/QOM/PR 종류와 세그먼트 위치는 포함되지 않았습니다.",
      evidence: "source-confirmed" as const,
      coordinate: midpoint(route.lod.high),
      sourceFile: route.activity.sourceFile,
      sourceField: "Achievement Count",
      confidence: route.activity.achievementCount?.confidence ?? 1,
      calculationVersion: CALCULATION_VERSION,
    }];
  });
}

function placeClusters(routes: AtlasRouteFeature[]): PlaceCluster[] {
  const groups: AtlasRouteFeature[][] = [];
  routes.forEach((route) => {
    const centerPoint = { latitude: route.centroid[1], longitude: route.centroid[0] };
    const target = groups.find((group) => {
      const first = group[0];
      return haversineMeters(centerPoint, { latitude: first.centroid[1], longitude: first.centroid[0] }) <= 18_000;
    });
    if (target) target.push(route);
    else groups.push([route]);
  });
  return groups.map((group, index) => {
    const dates = group.map((route) => route.activity.localDate).sort();
    const center: [number, number] = [
      group.reduce((sum, route) => sum + route.centroid[0], 0) / group.length,
      group.reduce((sum, route) => sum + route.centroid[1], 0) / group.length,
    ];
    const representative = group.find((route) => route.activity.name && route.activity.name !== "이름 없는 활동");
    return {
      id: `place-${index + 1}`,
      center,
      activityIds: group.map((route) => route.id),
      visitCount: group.length,
      startDate: dates[0],
      endDate: dates.at(-1) ?? dates[0],
      label: representative && group.length === 1 ? representative.activity.name : `이 지역 · ${group.length}회`,
      labelSource: representative && group.length === 1 ? "activity-name" as const : "neutral" as const,
    };
  }).sort((a, b) => b.visitCount - a.visitCount);
}

function buildSpatialIndex(routes: AtlasRouteFeature[], cellSizeDegrees = 0.25): AtlasModel["spatialIndex"] {
  const cells = new Map<string, Set<string>>();
  routes.forEach((route) => {
    route.lod.low.forEach((point) => {
      const x = Math.floor((point.longitude + 180) / cellSizeDegrees);
      const y = Math.floor((point.latitude + 90) / cellSizeDegrees);
      const key = `${x}:${y}`;
      const ids = cells.get(key) ?? new Set<string>();
      ids.add(route.id);
      cells.set(key, ids);
    });
  });
  return {
    cellSizeDegrees,
    cells: Object.fromEntries([...cells].map(([key, ids]) => [key, [...ids]])),
  };
}

export function buildAtlasModel(activities: Activity[], maskPrivate = true): AtlasModel {
  const routeEntries = activities.filter((activity) => (activity.route?.length ?? 0) >= 2)
    .map((activity) => ({ activity, points: activity.route!.filter(isValidRoutePoint) }))
    .filter((entry) => entry.points.length >= 2);
  const zones = detectPrivacyZones(routeEntries.map((entry) => entry.points));
  const routes = routeEntries.flatMap(({ activity, points }) => {
    const feature = createRouteFeature(activity, points, zones, maskPrivate);
    return feature ? [feature] : [];
  });
  const achievements = [...sourceAchievements(routes), ...personalRecordAchievements(routes)];
  return {
    routes,
    bounds: mergeBounds(routes.map((route) => route.bounds)),
    privacyZones: zones,
    achievements,
    placeClusters: placeClusters(routes),
    spatialIndex: buildSpatialIndex(routes),
    routeActivityCount: routes.length,
    rawPointCount: routes.reduce((sum, route) => sum + route.rawPointCount, 0),
  };
}

export function subsetAtlasModel(atlas: AtlasModel, activities: Activity[]): AtlasModel {
  const activityIds = new Set(activities.map((activity) => activity.id));
  const routes = atlas.routes.filter((route) => activityIds.has(route.id));
  const routeById = new Map(routes.map((route) => [route.id, route]));
  const clusters = atlas.placeClusters.flatMap((cluster) => {
    const ids = cluster.activityIds.filter((id) => routeById.has(id));
    if (!ids.length) return [];
    const dates = ids.map((id) => routeById.get(id)!.activity.localDate).sort();
    const center: [number, number] = [
      ids.reduce((sum, id) => sum + routeById.get(id)!.centroid[0], 0) / ids.length,
      ids.reduce((sum, id) => sum + routeById.get(id)!.centroid[1], 0) / ids.length,
    ];
    return [{ ...cluster, center, activityIds: ids, visitCount: ids.length, startDate: dates[0], endDate: dates.at(-1) ?? dates[0], label: ids.length === 1 ? routeById.get(ids[0])!.activity.name : `이 지역 · ${ids.length}회` }];
  });
  return {
    routes,
    bounds: mergeBounds(routes.map((route) => route.bounds)),
    privacyZones: atlas.privacyZones,
    achievements: atlas.achievements.filter((achievement) => activityIds.has(achievement.activityId)),
    placeClusters: clusters,
    spatialIndex: buildSpatialIndex(routes),
    routeActivityCount: routes.length,
    rawPointCount: routes.reduce((sum, route) => sum + route.rawPointCount, 0),
  };
}

export function routePointsForZoom(route: AtlasRouteFeature, zoom: number): RoutePoint[] {
  if (zoom < 7) return route.lod.low;
  if (zoom < 11) return route.lod.medium;
  return route.lod.high;
}
