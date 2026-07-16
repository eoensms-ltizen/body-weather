import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPremiereSpeed,
  DEFAULT_PREMIERE_CAMERA_TUNING,
  greatCircleArcPoint,
  measurePremierePath,
  measurePremiereRoutePath,
  normalizePremiereCameraTuning,
  premiereMontageCameraRouteIds,
  samplePremierePath,
  shortestBearingDelta,
  smoothPremiereBearing,
} from "../lib/premiere-camera";

test("Premiere speed accepts custom values inside a safe 0.1x to 16x range", () => {
  assert.equal(clampPremiereSpeed(0), 0.1);
  assert.equal(clampPremiereSpeed(1.35), 1.35);
  assert.equal(clampPremiereSpeed(99), 16);
  assert.equal(clampPremiereSpeed(Number.NaN), 1);
});

test("Montage camera keeps every route revealed so far in its framing set", () => {
  const orderedRouteIds = ["morning", "river", "mountain", "night"];
  assert.deepEqual(premiereMontageCameraRouteIds(orderedRouteIds, 3), ["morning", "river", "mountain"]);
  assert.deepEqual(premiereMontageCameraRouteIds(orderedRouteIds, 99), orderedRouteIds);
  assert.deepEqual(premiereMontageCameraRouteIds(orderedRouteIds, -1), []);
  assert.deepEqual(orderedRouteIds, ["morning", "river", "mountain", "night"]);
});

test("Recorded Pace uses GPS timestamps instead of constant spatial speed", () => {
  const measured = measurePremiereRoutePath([
    { longitude: 127, latitude: 37, timestamp: "2026-07-01T00:00:00Z" },
    { longitude: 127.001, latitude: 37, timestamp: "2026-07-01T00:00:10Z" },
    { longitude: 127.002, latitude: 37, timestamp: "2026-07-01T00:01:40Z" },
  ]);
  assert.ok(measured);
  assert.equal(measured.paceMode, "recorded");
  const half = samplePremierePath(measured, 0.5);
  assert.equal(half.segmentIndex, 1);
  assert.ok(half.point[0] > 127.001 && half.point[0] < 127.002);
});

test("Sensor Pace falls back to per-point speed when timestamps are unavailable", () => {
  const measured = measurePremiereRoutePath([
    { longitude: 127, latitude: 37, speed: 12 },
    { longitude: 127.001, latitude: 37, speed: 12 },
    { longitude: 127.002, latitude: 37, speed: 2 },
  ]);
  assert.ok(measured);
  assert.equal(measured.paceMode, "sensor");
  const half = samplePremierePath(measured, 0.5);
  assert.equal(half.segmentIndex, 1);
  assert.ok(half.point[0] > 127.001 && half.point[0] < 127.002);
});

test("Traveler advances by route distance and interpolates inside sparse segments", () => {
  const measured = measurePremierePath([[127, 37], [127.001, 37], [127.011, 37]]);
  assert.ok(measured);
  const quarter = samplePremierePath(measured, 0.25);
  const half = samplePremierePath(measured, 0.5);
  assert.equal(quarter.segmentIndex, 1);
  assert.equal(half.segmentIndex, 1);
  assert.ok(quarter.point[0] > 127.001 && quarter.point[0] < half.point[0]);
  assert.ok(half.point[0] < 127.011);
});

test("Traveler sampling clamps endpoints without mutating source coordinates", () => {
  const source: Array<[number, number]> = [[126.9, 37.4], [127.2, 37.7]];
  const measured = measurePremierePath(source);
  assert.ok(measured);
  assert.deepEqual(samplePremierePath(measured, -1).point, source[0]);
  assert.deepEqual(samplePremierePath(measured, 2).point, source[1]);
  assert.deepEqual(source, [[126.9, 37.4], [127.2, 37.7]]);
});

test("Camera tuning keeps follow zoom inside a coherent min/max range", () => {
  const tuning = normalizePremiereCameraTuning({
    ...DEFAULT_PREMIERE_CAMERA_TUNING,
    minZoom: 14,
    maxZoom: 10,
    followZoom: 18,
  });
  assert.equal(tuning.minZoom, 14);
  assert.equal(tuning.maxZoom, 14);
  assert.equal(tuning.followZoom, 14);
});

test("Direction follow takes the shortest turn and caps angular speed", () => {
  assert.equal(shortestBearingDelta(179, -179), 2);
  const tuning = { ...DEFAULT_PREMIERE_CAMERA_TUNING, rotationStrength: 1, rotationSmoothingMs: 100, rotationMaxDegreesPerSecond: 20 };
  const next = smoothPremiereBearing(0, 180, 100, tuning, 1);
  assert.ok(Math.abs(next) <= 2.001);
  const acrossSouth = smoothPremiereBearing(179, -179, 1_000, { ...tuning, rotationMaxDegreesPerSecond: 360 }, 1);
  assert.ok(shortestBearingDelta(179, acrossSouth) > 0);
  assert.ok(shortestBearingDelta(179, acrossSouth) <= 2.001);
});

test("High playback speed adds rotation damping when speed compensation is enabled", () => {
  const tuning = { ...DEFAULT_PREMIERE_CAMERA_TUNING, rotationStrength: 1, rotationSmoothingMs: 1_000, rotationMaxDegreesPerSecond: 360, speedCompensation: 1 };
  const normal = smoothPremiereBearing(0, 90, 200, tuning, 1);
  const fast = smoothPremiereBearing(0, 90, 200, tuning, 4);
  assert.ok(normal > fast);
  assert.ok(fast > 0);
});

test("Memory Jump traveler follows the raised great-circle arc", () => {
  const from: [number, number] = [126.978, 37.5665];
  const to: [number, number] = [129.0756, 35.1796];
  const start = greatCircleArcPoint(from, to, 0, 0.2);
  const middle = greatCircleArcPoint(from, to, 0.5, 0.2);
  const end = greatCircleArcPoint(from, to, 1, 0.2);
  assert.ok(Math.abs(start[0] - from[0]) < 1e-8 && Math.abs(start[1] - from[1]) < 1e-8);
  assert.ok(Math.abs(end[0] - to[0]) < 1e-8 && Math.abs(end[1] - to[1]) < 1e-8);
  assert.ok(middle[2] > 1_000);
  assert.ok(middle.every(Number.isFinite));
});
