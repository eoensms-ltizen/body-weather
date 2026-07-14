import assert from "node:assert/strict";
import test from "node:test";
import { boundsIntersect, buildAtlasModel, detectPrivacyZones, maskRoute, routeBounds, routesInBounds, simplifyRoute, subsetAtlasModel } from "../lib/atlas";
import { classifyActivity } from "../lib/activity-classification";
import { buildForecast } from "../lib/forecast";
import { buildMemories } from "../lib/memories";
import { createPosterProjection, filterPosterRoutes, posterDimensions } from "../lib/poster";
import { countBucket, durationBucket, sizeBucket } from "../lib/telemetry";
import { metric, missingMetric, type Activity, type DailyWellness, type ImportSummary, type RoutePoint } from "../lib/types";
import { buildVerificationSummary } from "../lib/verification-fixture";

test("route simplification preserves endpoints without mutating the source", () => {
  const points: RoutePoint[] = Array.from({ length: 100 }, (_, index) => ({ latitude: 37.5 + index * 0.001, longitude: 127 + Math.sin(index / 5) * 0.01 }));
  const before = structuredClone(points);
  const simplified = simplifyRoute(points, 0.002);
  assert.ok(simplified.length < points.length);
  assert.deepEqual(simplified[0], points[0]);
  assert.deepEqual(simplified.at(-1), points.at(-1));
  assert.deepEqual(points, before);
});

test("route bounds choose the short antimeridian span", () => {
  const bounds = routeBounds([{ latitude: 1, longitude: 179.5 }, { latitude: 1.2, longitude: -179.6 }]);
  assert.ok(bounds);
  assert.ok(bounds.east - bounds.west < 2);
});

test("area selection returns only intersecting routes", () => {
  const atlas = buildAtlasModel(buildVerificationSummary().activities, false);
  const first = atlas.routes[0];
  const tiny = { west: first.centroid[0] - 0.02, east: first.centroid[0] + 0.02, south: first.centroid[1] - 0.02, north: first.centroid[1] + 0.02 };
  assert.equal(boundsIntersect(first.bounds, tiny), true);
  assert.ok(routesInBounds(atlas.routes, tiny).some((route) => route.id === first.id));
});

test("activity filters distinguish sport and environment", () => {
  assert.deepEqual(classifyActivity({ type: "VirtualRide", name: "Zwift race" }), { group: "ride", environment: "virtual" });
  assert.deepEqual(classifyActivity({ type: "Ride", name: "Han River" }), { group: "ride", environment: "outdoor" });
  assert.deepEqual(classifyActivity({ type: "Run", name: "Treadmill" }), { group: "run", environment: "indoor" });
  assert.deepEqual(classifyActivity({ type: "Walk", name: "Lunch" }), { group: "walk", environment: "outdoor" });
});

test("invalid, single-point and zero-length routes are excluded", () => {
  const summary = buildVerificationSummary();
  const template = summary.activities[0];
  const atlas = buildAtlasModel([
    { ...template, id: "single", route: [{ latitude: 37, longitude: 127 }] },
    { ...template, id: "invalid", route: [{ latitude: 91, longitude: 127 }, { latitude: 92, longitude: 127 }] },
    { ...template, id: "zero", route: [{ latitude: 37, longitude: 127 }, { latitude: 37, longitude: 127 }] },
  ], false);
  assert.equal(atlas.routes.length, 0);
});

test("repeated route endpoints create a privacy zone and masking removes nearby coordinates", () => {
  const routes: RoutePoint[][] = Array.from({ length: 3 }, (_, index) => [
    { latitude: 37.50001 + index * 0.00001, longitude: 127.00001 },
    { latitude: 37.52 + index * 0.01, longitude: 127.05 },
  ]);
  const zones = detectPrivacyZones(routes);
  assert.equal(zones.length, 1);
  const masked = maskRoute(routes[0], zones);
  assert.equal(masked.length, 1);
  assert.equal(masked[0].latitude, routes[0][1].latitude);
});

test("achievement count is a source achievement, never inferred as KOM", () => {
  const summary = buildVerificationSummary();
  summary.activities[0].achievementCount = metric(3, "count", "verification", "activities.csv");
  const atlas = buildAtlasModel(summary.activities, false);
  const source = atlas.achievements.find((item) => item.activityId === summary.activities[0].id && item.evidence === "source-confirmed");
  assert.equal(source?.kind, "source_achievement");
  assert.equal(atlas.achievements.some((item) => item.kind === "kom" || item.kind === "qom"), false);
});

test("atlas builds a spatial index and filters without mutating the full model", () => {
  const summary = buildVerificationSummary();
  const atlas = buildAtlasModel(summary.activities, false);
  const before = atlas.routes.length;
  const subset = subsetAtlasModel(atlas, summary.activities.slice(0, 3));
  assert.ok(Object.keys(atlas.spatialIndex.cells).length > 0);
  assert.ok(subset.routes.length <= 3);
  assert.equal(atlas.routes.length, before);
});

test("forecast labels stale data as latest observation", () => {
  const summary = buildVerificationSummary();
  const forecast = buildForecast(summary, "easy", undefined, new Date("2026-07-14T03:00:00Z"));
  assert.equal(forecast.displayMode, "latest-observation");
  assert.equal(forecast.nextLabel, "다음 날 시뮬레이션");
  assert.ok(forecast.freshnessDays >= 13);
});

test("forecast never uses wellness values after its as-of date", () => {
  const summary = buildVerificationSummary();
  const asOf = "2026-06-20";
  const baseline = buildForecast(summary, "easy", asOf, new Date("2026-06-20T12:00:00Z"));
  const future = structuredClone(summary);
  const extreme = structuredClone(future.wellness.at(-1)!);
  extreme.date = "2026-06-21";
  extreme.hrv = metric(999, "ms", "future", "future.json");
  extreme.bodyBatteryHigh = metric(0, "score", "future", "future.json");
  future.wellness.push(extreme);
  const after = buildForecast(future, "easy", asOf, new Date("2026-06-20T12:00:00Z"));
  assert.equal(after.score, baseline.score);
  assert.deepEqual(after.factors, baseline.factors);
});

test("tomorrow scenario changes the range but stays within 0 to 100", () => {
  const summary = buildVerificationSummary();
  const rest = buildForecast(summary, "rest", "2026-06-30", new Date("2026-06-30T12:00:00Z"));
  const hard = buildForecast(summary, "hard", "2026-06-30", new Date("2026-06-30T12:00:00Z"));
  assert.ok(rest.scoreRange && hard.scoreRange);
  assert.ok(rest.scoreRange[0] > hard.scoreRange[0]);
  for (const value of [...rest.scoreRange, ...hard.scoreRange]) assert.ok(value >= 0 && value <= 100);
});

test("activity-only data degrades to tier C instead of inventing health signals", () => {
  const source = buildVerificationSummary();
  const summary: ImportSummary = { ...source, wellness: [] };
  const forecast = buildForecast(summary, "easy", summary.endDate, new Date(`${summary.endDate}T12:00:00Z`));
  assert.equal(forecast.tier, "C");
  assert.equal(forecast.factors.every((item) => item.key === "load"), true);
  assert.equal(forecast.confidence, "low");
});

test("no measurements produce observation shortage, not a zero score", () => {
  const source = buildVerificationSummary();
  const blankActivity: Activity = {
    ...source.activities[0], route: undefined,
    elapsedTime: missingMetric("s"), movingTime: missingMetric("s"), distance: missingMetric("km"), calories: missingMetric("kcal"),
    averageHeartRate: missingMetric("bpm"), maxHeartRate: missingMetric("bpm"), relativeEffort: missingMetric("score"), averagePower: missingMetric("W"), weightedAveragePower: missingMetric("W"), maxPower: missingMetric("W"), trainingLoad: missingMetric("score"), intensity: missingMetric("%"),
  };
  const summary: ImportSummary = { ...source, activities: [blankActivity], wellness: [] };
  const forecast = buildForecast(summary, "easy", blankActivity.localDate, new Date(`${blankActivity.localDate}T12:00:00Z`));
  assert.equal(forecast.score, null);
  assert.equal(forecast.weatherState, "관측 부족");
  assert.equal(forecast.tier, "E");
});

test("forecast confidence boundary recognizes fourteen-day baseline", () => {
  const source = buildVerificationSummary();
  const days: DailyWellness[] = source.wellness.slice(0, 15);
  const summary = { ...source, wellness: days, endDate: days.at(-1)!.date };
  const forecast = buildForecast(summary, "easy", days.at(-1)!.date, new Date(`${days.at(-1)!.date}T12:00:00Z`));
  assert.ok(["high", "medium"].includes(forecast.confidence));
});

test("poster dimensions expose 4K landscape and long-edge vertical outputs", () => {
  assert.deepEqual(posterDimensions("16:9"), [3840, 2160]);
  assert.deepEqual(posterDimensions("4:5"), [2160, 2700]);
  assert.deepEqual(posterDimensions("9:16"), [2160, 3840]);
});

test("poster projection keeps one geographic aspect ratio across output shapes", () => {
  const bounds = { west: 126.7, south: 35.1, east: 129.4, north: 38.2 };
  const landscape = createPosterProjection(bounds, { left: 0, top: 0, right: 1600, bottom: 900 });
  const portrait = createPosterProjection(bounds, { left: 0, top: 0, right: 900, bottom: 1600 });
  const landscapeAspect = landscape.contentWidth / landscape.contentHeight;
  const portraitAspect = portrait.contentWidth / portrait.contentHeight;
  assert.ok(Math.abs(landscapeAspect - portraitAspect) < 1e-9);
  [[bounds.west, bounds.south], [bounds.east, bounds.north]].forEach(([longitude, latitude]) => {
    const [x, y] = portrait.project({ longitude, latitude });
    assert.ok(x >= 0 && x <= 900);
    assert.ok(y >= 0 && y <= 1600);
  });
});

test("poster routes always exclude hidden activities", () => {
  const summary = buildVerificationSummary();
  const routes = buildAtlasModel(summary.activities, false).routes;
  const hidden = new Set(routes.slice(0, 3).map((route) => route.id));
  const visible = filterPosterRoutes(routes, hidden);
  assert.equal(visible.length, routes.length - 3);
  assert.equal(visible.some((route) => hidden.has(route.id)), false);
});

test("telemetry only exposes coarse size, duration, and count buckets", () => {
  assert.equal(sizeBucket(2_500 * 1024 * 1024), "over_2gb");
  assert.equal(durationBucket(95), "1_3m");
  assert.equal(countBucket(2_474), "over_1000");
});

test("memories add measured elevation without inventing missing values", () => {
  const summary = buildVerificationSummary();
  const memories = buildMemories(summary, buildAtlasModel(summary.activities, false));
  const expected = summary.activities.reduce((sum, activity) => sum + (activity.elevationGain?.value ?? 0), 0);
  assert.equal(memories.totalElevationGain, expected);
  assert.equal(memories.elevationActivityCount, summary.activities.length);
  const missing = structuredClone(summary);
  missing.activities.forEach((activity) => { activity.elevationGain = missingMetric("m"); });
  assert.equal(buildMemories(missing, buildAtlasModel(missing.activities, false)).totalElevationGain, null);
});
