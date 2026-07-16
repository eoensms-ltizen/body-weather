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

export function clampPremiereSpeed(speed: number): number {
  return clamp(finiteOr(speed, 1), 0.1, 16);
}

export function premiereMontageCameraRouteIds(orderedRouteIds: readonly string[], revealedCount: number): string[] {
  const safeCount = clamp(Math.floor(finiteOr(revealedCount, 0)), 0, orderedRouteIds.length);
  return orderedRouteIds.slice(0, safeCount);
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
