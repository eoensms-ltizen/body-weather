import assert from "node:assert/strict";
import test from "node:test";
import { buildAtlasModel } from "../lib/atlas";
import { buildPremiereStory, premiereFrameAt, type PremiereSettings } from "../lib/premiere";
import { buildVerificationSummary } from "../lib/verification-fixture";

const DEFAULTS: PremiereSettings = {
  length: "memory-cut",
  cameraMode: "cinematic",
  showActivityCard: true,
  showRecords: true,
  showSeason: true,
  showRecovery: true,
};

test("Memory Cut keeps every route in chronological reveal order and lands near 60 seconds", () => {
  const summary = buildVerificationSummary();
  const atlas = buildAtlasModel(summary.activities, false);
  const story = buildPremiereStory(atlas.routes, atlas.achievements, atlas.placeClusters, summary.wellness, DEFAULTS);
  assert.ok(story);
  assert.equal(story.orderedRouteIds.length, atlas.routes.length);
  assert.ok(story.highlightRouteIds.length <= 12);
  assert.equal(story.highlightRouteIds[0], story.orderedRouteIds[0]);
  assert.equal(story.highlightRouteIds.at(-1), story.orderedRouteIds.at(-1));
  assert.ok(story.totalDurationMs >= 58_000 && story.totalDurationMs <= 64_000);
  const finale = premiereFrameAt(story, story.totalDurationMs);
  assert.equal(finale.kind, "finale");
  assert.equal(finale.revealedCount, story.orderedRouteIds.length);
});

test("Full Chronicle follows every route and Memory Jumps never reveal synthetic routes", () => {
  const summary = buildVerificationSummary();
  const atlas = buildAtlasModel(summary.activities, false);
  const story = buildPremiereStory(atlas.routes, atlas.achievements, atlas.placeClusters, summary.wellness, { ...DEFAULTS, length: "full-chronicle" });
  assert.ok(story);
  assert.equal(story.scenes.filter((scene) => scene.kind === "ride").length, atlas.routes.length);
  story.scenes.filter((scene) => scene.kind === "jump").forEach((scene) => assert.equal(scene.revealStart, scene.revealEnd));
});

test("Premiere metadata uses measured recovery only and labels generated route progress", () => {
  const summary = buildVerificationSummary();
  const atlas = buildAtlasModel(summary.activities, false);
  const story = buildPremiereStory(atlas.routes, atlas.achievements, atlas.placeClusters, summary.wellness, DEFAULTS);
  assert.ok(story);
  const rides = story.scenes.filter((scene) => scene.kind === "ride");
  assert.ok(rides.some((scene) => scene.rideMeta?.recoveryScore !== null));
  assert.ok(rides.every((scene) => scene.rideMeta?.timestampMode === "visualized"));
  const noWellness = buildPremiereStory(atlas.routes, atlas.achievements, atlas.placeClusters, [], DEFAULTS);
  assert.ok(noWellness);
  assert.ok(noWellness.scenes.filter((scene) => scene.kind === "ride").every((scene) => scene.rideMeta?.recoveryScore === null));
});

test("Premiere safely declines an empty GPS route set", () => {
  assert.equal(buildPremiereStory([], [], [], [], DEFAULTS), null);
});
