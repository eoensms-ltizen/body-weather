import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPremiereSpeed,
  DEFAULT_PREMIERE_CAMERA_TUNING,
  greatCircleArcPoint,
  normalizePremiereCameraTuning,
  shortestBearingDelta,
  smoothPremiereBearing,
} from "../lib/premiere-camera";

test("Premiere speed accepts custom values inside a safe 0.1x to 16x range", () => {
  assert.equal(clampPremiereSpeed(0), 0.1);
  assert.equal(clampPremiereSpeed(1.35), 1.35);
  assert.equal(clampPremiereSpeed(99), 16);
  assert.equal(clampPremiereSpeed(Number.NaN), 1);
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
