export interface PremiereCameraTuning {
  fitActivity: boolean;
  followZoom: number;
  minZoom: number;
  maxZoom: number;
  rotationStrength: number;
  rotationSmoothingMs: number;
  rotationMaxDegreesPerSecond: number;
  speedCompensation: number;
}

export interface PremiereMeasuredPath {
  points: [number, number][];
  cumulativeMeters: number[];
  totalMeters: number;
  cumulativePlaybackUnits: number[];
  totalPlaybackUnits: number;
  paceMode: PremierePaceMode;
}

export type PremierePaceMode = "recorded" | "sensor" | "distance";

export interface PremiereRoutePointInput {
  longitude: number;
  latitude: number;
  timestamp?: string;
  speed?: number;
}

export interface PremierePathSample {
  point: [number, number];
  segmentIndex: number;
  segmentProgress: number;
}

export const DEFAULT_PREMIERE_CAMERA_TUNING: PremiereCameraTuning = {
  fitActivity: false,
  followZoom: 12.4,
  minZoom: 7,
  maxZoom: 15,
  rotationStrength: 0.55,
  rotationSmoothingMs: 1_200,
  rotationMaxDegreesPerSecond: 55,
  speedCompensation: 0.65,
};

const EARTH_RADIUS_METERS = 6_371_000;

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeBearing(value: number): number {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function coordinateDistanceMeters(from: readonly [number, number], to: readonly [number, number]): number {
  const toRadians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = toRadians(to[1] - from[1]);
  const longitudeDelta = toRadians(to[0] - from[0]);
  const latitudeA = toRadians(from[1]);
  const latitudeB = toRadians(to[1]);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

export function clampPremiereSpeed(speed: number): number {
  return clamp(finiteOr(speed, 1), 0.1, 16);
}

export function premiereMontageCameraRouteIds(orderedRouteIds: readonly string[], revealedCount: number): string[] {
  const safeCount = clamp(Math.floor(finiteOr(revealedCount, 0)), 0, orderedRouteIds.length);
  return orderedRouteIds.slice(0, safeCount);
}

export function measurePremierePath(points: readonly (readonly [number, number])[]): PremiereMeasuredPath | null {
  const validPoints = points
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [point[0], point[1]] as [number, number]);
  if (validPoints.length < 2) return null;
  const cumulativeMeters = [0];
  for (let index = 1; index < validPoints.length; index += 1) {
    cumulativeMeters.push(cumulativeMeters[index - 1] + coordinateDistanceMeters(validPoints[index - 1], validPoints[index]));
  }
  const totalMeters = cumulativeMeters.at(-1) ?? 0;
  return {
    points: validPoints,
    cumulativeMeters,
    totalMeters,
    cumulativePlaybackUnits: [...cumulativeMeters],
    totalPlaybackUnits: totalMeters,
    paceMode: "distance",
  };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function cumulativeUnits(weights: number[]): number[] {
  const cumulative = [0];
  weights.forEach((weight) => cumulative.push(cumulative.at(-1)! + Math.max(0.0001, finiteOr(weight, 0))));
  return cumulative;
}

/**
 * Builds a cinematic pace profile. Recorded timestamps preserve the relative
 * climbing/descending rhythm while long stationary gaps are softly compressed.
 * Sensor speed is used as a unit-agnostic relative fallback, then distance.
 */
export function measurePremiereRoutePath(source: readonly PremiereRoutePointInput[]): PremiereMeasuredPath | null {
  const valid = source.filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude));
  if (valid.length < 2) return null;
  const points = valid.map((point) => [point.longitude, point.latitude] as [number, number]);
  const distances = points.slice(1).map((point, index) => coordinateDistanceMeters(points[index], point));
  const cumulativeMeters = [0];
  distances.forEach((distance) => cumulativeMeters.push(cumulativeMeters.at(-1)! + Math.max(0, distance)));
  const totalMeters = cumulativeMeters.at(-1) ?? 0;

  const timestamps = valid.map((point) => {
    const value = point.timestamp ? Date.parse(point.timestamp) : Number.NaN;
    return Number.isFinite(value) ? value : null;
  });
  const deltas = distances.map((_, index) => {
    const from = timestamps[index];
    const to = timestamps[index + 1];
    return from !== null && to !== null && to > from ? (to - from) / 1_000 : null;
  });
  const timedDistance = distances.reduce((sum, distance, index) => sum + (deltas[index] !== null ? distance : 0), 0);
  const timestampCount = timestamps.filter((value) => value !== null).length;
  const recordedCoverage = totalMeters > 0 ? timedDistance / totalMeters : 0;

  if (timestampCount >= 2 && deltas.some((value) => value !== null) && recordedCoverage >= 0.35) {
    const movingSpeeds = deltas.flatMap((delta, index) => {
      if (delta === null || delta <= 0 || distances[index] <= 0) return [];
      const speed = distances[index] / delta;
      return speed >= 0.12 ? [speed] : [];
    });
    const recordedSeconds = deltas.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const typicalSpeed = Math.max(0.35, median(movingSpeeds) || totalMeters / Math.max(1, recordedSeconds));
    const weights = distances.map((distance, index) => {
      const expected = distance > 0 ? distance / typicalSpeed : 0;
      const delta = deltas[index];
      if (delta === null) return Math.max(0.04, expected);
      if (distance <= 0) return Math.min(delta, 8);
      const impliedSpeed = distance / delta;
      return impliedSpeed < typicalSpeed * 0.12 && delta > 30
        ? Math.min(delta, expected * 4 + 8)
        : delta;
    });
    const playback = cumulativeUnits(weights);
    return {
      points,
      cumulativeMeters,
      totalMeters,
      cumulativePlaybackUnits: playback,
      totalPlaybackUnits: playback.at(-1) ?? 0,
      paceMode: "recorded",
    };
  }

  const segmentSpeeds = distances.map((_, index) => {
    const values = [valid[index].speed, valid[index + 1].speed]
      .filter((value): value is number => value !== undefined && Number.isFinite(value) && value > 0);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  });
  const speedDistance = distances.reduce((sum, distance, index) => sum + (segmentSpeeds[index] !== null ? distance : 0), 0);
  const speedCoverage = totalMeters > 0 ? speedDistance / totalMeters : 0;
  if (segmentSpeeds.some((value) => value !== null) && speedCoverage >= 0.35) {
    const typicalSpeed = Math.max(0.01, median(segmentSpeeds.filter((value): value is number => value !== null)));
    const weights = distances.map((distance, index) => distance / Math.max(0.01, segmentSpeeds[index] ?? typicalSpeed));
    const playback = cumulativeUnits(weights);
    return {
      points,
      cumulativeMeters,
      totalMeters,
      cumulativePlaybackUnits: playback,
      totalPlaybackUnits: playback.at(-1) ?? 0,
      paceMode: "sensor",
    };
  }

  return {
    points,
    cumulativeMeters,
    totalMeters,
    cumulativePlaybackUnits: [...cumulativeMeters],
    totalPlaybackUnits: totalMeters,
    paceMode: "distance",
  };
}

export function samplePremierePath(path: PremiereMeasuredPath, progress: number): PremierePathSample {
  const t = clamp(finiteOr(progress, 0), 0, 1);
  const lastIndex = path.points.length - 1;
  const cumulative = path.cumulativePlaybackUnits ?? path.cumulativeMeters;
  const total = path.totalPlaybackUnits ?? path.totalMeters;
  if (total <= 0) {
    const scaled = t * lastIndex;
    const segmentIndex = Math.min(lastIndex - 1, Math.floor(scaled));
    const segmentProgress = clamp(scaled - segmentIndex, 0, 1);
    const from = path.points[segmentIndex];
    const to = path.points[segmentIndex + 1];
    return { point: [from[0] + (to[0] - from[0]) * segmentProgress, from[1] + (to[1] - from[1]) * segmentProgress], segmentIndex, segmentProgress };
  }

  const targetUnits = total * t;
  let low = 1;
  let high = lastIndex;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (cumulative[middle] <= targetUnits) low = middle + 1;
    else high = middle;
  }
  const endIndex = targetUnits >= total ? lastIndex : low;
  const segmentIndex = Math.max(0, endIndex - 1);
  const startUnits = cumulative[segmentIndex];
  const segmentUnits = cumulative[endIndex] - startUnits;
  const segmentProgress = segmentUnits > 0 ? clamp((targetUnits - startUnits) / segmentUnits, 0, 1) : 0;
  const from = path.points[segmentIndex];
  const to = path.points[endIndex];
  return {
    point: [from[0] + (to[0] - from[0]) * segmentProgress, from[1] + (to[1] - from[1]) * segmentProgress],
    segmentIndex,
    segmentProgress,
  };
}

export function normalizePremiereCameraTuning(tuning: PremiereCameraTuning): PremiereCameraTuning {
  const minimum = clamp(finiteOr(tuning.minZoom, DEFAULT_PREMIERE_CAMERA_TUNING.minZoom), 1.5, 17);
  const maximum = clamp(finiteOr(tuning.maxZoom, DEFAULT_PREMIERE_CAMERA_TUNING.maxZoom), minimum, 18);
  return {
    fitActivity: Boolean(tuning.fitActivity),
    minZoom: minimum,
    maxZoom: maximum,
    followZoom: clamp(finiteOr(tuning.followZoom, DEFAULT_PREMIERE_CAMERA_TUNING.followZoom), minimum, maximum),
    rotationStrength: clamp(finiteOr(tuning.rotationStrength, DEFAULT_PREMIERE_CAMERA_TUNING.rotationStrength), 0, 1),
    rotationSmoothingMs: clamp(finiteOr(tuning.rotationSmoothingMs, DEFAULT_PREMIERE_CAMERA_TUNING.rotationSmoothingMs), 100, 5_000),
    rotationMaxDegreesPerSecond: clamp(finiteOr(tuning.rotationMaxDegreesPerSecond, DEFAULT_PREMIERE_CAMERA_TUNING.rotationMaxDegreesPerSecond), 5, 360),
    speedCompensation: clamp(finiteOr(tuning.speedCompensation, DEFAULT_PREMIERE_CAMERA_TUNING.speedCompensation), 0, 2),
  };
}

export function shortestBearingDelta(from: number, to: number): number {
  return normalizeBearing(to - from);
}

export function smoothPremiereBearing(
  current: number,
  routeBearing: number,
  elapsedMs: number,
  tuning: PremiereCameraTuning,
  playbackSpeed: number,
): number {
  const normalized = normalizePremiereCameraTuning(tuning);
  const target = normalizeBearing(current + shortestBearingDelta(current, routeBearing) * normalized.rotationStrength);
  const speed = clampPremiereSpeed(playbackSpeed);
  const effectiveSmoothing = normalized.rotationSmoothingMs * (1 + Math.max(0, speed - 1) * normalized.speedCompensation);
  const safeElapsed = clamp(finiteOr(elapsedMs, 0), 0, 1_000);
  const alpha = 1 - Math.exp(-safeElapsed / effectiveSmoothing);
  const desiredStep = shortestBearingDelta(current, target) * alpha;
  const maxStep = normalized.rotationMaxDegreesPerSecond * safeElapsed / 1_000;
  return normalizeBearing(current + clamp(desiredStep, -maxStep, maxStep));
}

export function greatCircleArcPoint(
  from: [number, number],
  to: [number, number],
  progress: number,
  heightMultiplier: number,
): [number, number, number] {
  const toRadians = (value: number) => value * Math.PI / 180;
  const toDegrees = (value: number) => value * 180 / Math.PI;
  const t = clamp(finiteOr(progress, 0), 0, 1);
  const longitudeA = toRadians(from[0]);
  const latitudeA = toRadians(from[1]);
  const longitudeB = toRadians(to[0]);
  const latitudeB = toRadians(to[1]);
  const dot = clamp(
    Math.sin(latitudeA) * Math.sin(latitudeB) + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.cos(longitudeB - longitudeA),
    -1,
    1,
  );
  const angularDistance = Math.acos(dot);
  if (angularDistance < 1e-8) return [from[0], from[1], 0];
  const denominator = Math.sin(angularDistance);
  const weightA = Math.sin((1 - t) * angularDistance) / denominator;
  const weightB = Math.sin(t * angularDistance) / denominator;
  const x = weightA * Math.cos(latitudeA) * Math.cos(longitudeA) + weightB * Math.cos(latitudeB) * Math.cos(longitudeB);
  const y = weightA * Math.cos(latitudeA) * Math.sin(longitudeA) + weightB * Math.cos(latitudeB) * Math.sin(longitudeB);
  const z = weightA * Math.sin(latitudeA) + weightB * Math.sin(latitudeB);
  const longitude = Math.atan2(y, x);
  const latitude = Math.atan2(z, Math.sqrt(x * x + y * y));
  const altitude = Math.sqrt(t * (1 - t)) * angularDistance * EARTH_RADIUS_METERS * Math.max(0, finiteOr(heightMultiplier, 0));
  return [toDegrees(longitude), toDegrees(latitude), altitude];
}
