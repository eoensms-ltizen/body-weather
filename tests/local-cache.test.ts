import assert from "node:assert/strict";
import test from "node:test";
import { buildAtlasModel } from "../lib/atlas";
import { buildCachedAtlasMetadata, getCachedAtlasMetadata, LOCAL_CACHE_SCHEMA_VERSION } from "../lib/local-cache";
import { buildVerificationSummary } from "../lib/verification-fixture";

test("local cache metadata describes reusable data without storing filenames", () => {
  const summary = buildVerificationSummary();
  const metadata = buildCachedAtlasMetadata(summary, "2026-07-16T00:00:00.000Z");
  const atlas = buildAtlasModel(summary.activities, false);
  assert.equal(metadata.schemaVersion, LOCAL_CACHE_SCHEMA_VERSION);
  assert.equal(metadata.activityCount, summary.activities.length);
  assert.equal(metadata.wellnessDayCount, summary.wellness.length);
  assert.equal(metadata.routeActivityCount, atlas.routeActivityCount);
  assert.ok(metadata.routePointCount > 0);
  assert.deepEqual(metadata.sources, ["garmin", "strava"]);
  assert.equal(JSON.stringify(metadata).includes("sourceFile"), false);
});

test("local cache gracefully degrades when IndexedDB is unavailable", async () => {
  assert.equal(await getCachedAtlasMetadata(), null);
});
