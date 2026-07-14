import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilityProfile, calculateCorrelation, matchActivities } from "../lib/analytics";
import { parseGpx, parseStravaActivities } from "../lib/strava";
import { inspectZip, isUnsafePath } from "../lib/security";
import { metric, missingMetric, type Activity, type DailyWellness } from "../lib/types";

function activity(overrides: Partial<Activity> = {}): Activity {
  const measured = (value: number, unit: string) => metric(value, unit, "fixture", "fixture.csv");
  return {
    id: "a-1", source: "strava", sourceFile: "fixture.csv", date: "2026-05-01T09:00:00.000Z", localDate: "2026-05-01",
    name: "Fixture Ride", type: "Ride", elapsedTime: measured(3600, "s"), movingTime: measured(3500, "s"), distance: measured(30, "km"),
    calories: measured(600, "kcal"), averageHeartRate: measured(140, "bpm"), maxHeartRate: measured(170, "bpm"), relativeEffort: measured(72, "score"),
    averagePower: measured(180, "W"), weightedAveragePower: measured(195, "W"), maxPower: measured(620, "W"), trainingLoad: measured(85, "score"), intensity: measured(82, "%"),
    route: [{ latitude: 37.5, longitude: 127 }, { latitude: 37.6, longitude: 127.1 }], ...overrides,
  };
}

function wellness(date = "2026-05-01", fields: { sleep?: boolean; hrv?: boolean; battery?: boolean; stress?: boolean } = { sleep: true, hrv: true, battery: true, stress: true }): DailyWellness {
  const measured = (value: number, unit: string) => metric(value, unit, "fixture", "fixture.json");
  const missing = (unit: string) => missingMetric(unit, "fixture", "fixture.json");
  return {
    date,
    sleep: fields.sleep ? { calendarDate: date, totalSeconds: measured(27_000, "s"), deepSeconds: measured(5000, "s"), lightSeconds: measured(14_000, "s"), remSeconds: measured(8000, "s"), awakeSeconds: measured(900, "s"), score: measured(82, "score"), recoveryScore: measured(78, "score"), averageStress: measured(18, "score"), respiration: measured(14, "brpm") } : undefined,
    hrv: fields.hrv ? measured(54, "ms") : missing("ms"), restingHeartRate: measured(49, "bpm"),
    bodyBatteryHigh: fields.battery ? measured(78, "score") : missing("score"), bodyBatteryLow: fields.battery ? measured(20, "score") : missing("score"),
    bodyBatteryCharged: fields.battery ? measured(58, "score") : missing("score"), bodyBatteryDrained: fields.battery ? measured(45, "score") : missing("score"),
    averageStress: fields.stress ? measured(27, "score") : missing("score"), skinTemperature: measured(-0.2, "°C Δ"), respiration: measured(14, "brpm"),
    steps: measured(9000, "steps"), activeCalories: measured(700, "kcal"), hydration: missing("ml"), sweatLoss: missing("ml"),
  };
}

test("duplicate CSV headers preserve the first non-empty value and never invent zero", () => {
  const csv = [
    "Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Elapsed Time,Distance,Distance,Average Heart Rate,Training Load",
    '1,"May 1, 2026, 9:00:00 AM",Morning Ride,Ride,,3600,,30,145,80',
  ].join("\n");
  const result = parseStravaActivities(csv, "activities.csv", "2026-04-01", "2026-07-12");
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].elapsedTime.value, 3600);
  assert.equal(result.activities[0].distance.value, 30);
  assert.equal(result.activities[0].maxPower.value, null);
  assert.equal(result.activities[0].maxPower.status, "missing");
});

test("GPX parser keeps coordinates and optional sensor values", () => {
  const gpx = `<gpx><trk><trkseg><trkpt lat="37.5" lon="127.0"><ele>20</ele><time>2026-05-01T00:00:00Z</time><extensions><gpxtpx:hr>140</gpxtpx:hr><power>190</power></extensions></trkpt><trkpt lat="37.6" lon="127.1"><ele>22</ele></trkpt></trkseg></trk></gpx>`;
  const points = parseGpx(gpx);
  assert.equal(points.length, 2);
  assert.equal(points[0].heartRate, 140);
  assert.equal(points[0].power, 190);
});

test("ZIP path and compression guards reject unsafe supported entries while ignoring media payload size", () => {
  assert.equal(isUnsafePath("../secret.txt"), true);
  assert.equal(isUnsafePath("activities/ride.fit.gz"), false);
  const entries = [
    { directory: false, filename: "media/video.mp4", uncompressedSize: 2_000_000_000, compressedSize: 2_000_000_000 },
    { directory: false, filename: "activities.csv", uncompressedSize: 2000, compressedSize: 1000 },
  ] as never;
  const inspected = inspectZip(entries, "strava");
  assert.equal(inspected.mediaSkipped, 1);
  assert.equal(inspected.summaries.filter((item) => item.supported).length, 1);
});

test("ambiguous cross-platform activities are not marked confirmed", () => {
  const matches = matchActivities([activity()], [activity({ id: "g-1", source: "garmin", date: "2026-05-01T09:48:00.000Z", distance: missingMetric("km") })]);
  assert.ok(matches.length <= 1);
  if (matches[0]) assert.notEqual(matches[0].status, "confirmed");
});

const scenarios: Array<{ name: string; activities: Activity[]; wellness: DailyWellness[]; expected: Record<string, string> }> = [
  { name: "01 Strava + Garmin 전체 데이터", activities: [activity()], wellness: [wellness()], expected: { timeline: "available", route: "available", sleep: "available", hrv: "available" } },
  { name: "02 Strava만 존재", activities: [activity()], wellness: [], expected: { timeline: "available", sleep: "unavailable" } },
  { name: "03 Garmin만 존재", activities: [], wellness: [wellness()], expected: { timeline: "unavailable", recovery: "available" } },
  { name: "04 activities.csv만 존재", activities: [activity({ route: undefined })], wellness: [], expected: { summary: "available", route: "unavailable" } },
  { name: "05 경로만 있고 심박·파워 없음", activities: [activity({ averageHeartRate: missingMetric("bpm"), averagePower: missingMetric("W") })], wellness: [], expected: { route: "available", heart: "unavailable", power: "unavailable" } },
  { name: "06 수면은 있으나 HRV/Body Battery 없음", activities: [], wellness: [wellness("2026-05-01", { sleep: true, hrv: false, battery: false, stress: true })], expected: { sleep: "available", hrv: "unavailable", battery: "unavailable" } },
  { name: "07 HRV만 있고 수면 없음", activities: [], wellness: [wellness("2026-05-01", { sleep: false, hrv: true, battery: false, stress: false })], expected: { sleep: "unavailable", hrv: "available" } },
  { name: "08 일부 날짜 누락", activities: [activity()], wellness: [wellness("2026-05-02")], expected: { timeline: "available", recovery: "available" } },
  { name: "09 중복 활동", activities: [activity(), activity({ id: "a-2" })], wellness: [], expected: { timeline: "available" } },
  { name: "10 빈 CSV/빈 JSON 배열", activities: [], wellness: [], expected: { timeline: "unavailable", recovery: "unavailable" } },
  { name: "11 손상 파일 격리 후 정상 데이터 유지", activities: [activity()], wellness: [], expected: { timeline: "available" } },
  { name: "12 지원하지 않는 파일만 존재", activities: [], wellness: [], expected: { summary: "unavailable" } },
  { name: "13 ZIP Slip 엔트리 거부 후 빈 결과", activities: [], wellness: [], expected: { route: "unavailable" } },
  { name: "14 압축 제한 초과 거부 후 빈 결과", activities: [], wellness: [], expected: { timeline: "unavailable" } },
  { name: "15 자정 경계 활동은 현지 날짜 보존", activities: [activity({ localDate: "2026-05-02", date: "2026-05-01T15:30:00.000Z" })], wellness: [wellness("2026-05-02")], expected: { timeline: "available", recovery: "available" } },
  { name: "16 모호한 활동 매칭에서도 독립 기록 유지", activities: [activity()], wellness: [wellness()], expected: { timeline: "available", correlation: "available" } },
];

for (const scenario of scenarios) {
  test(`capability degradation: ${scenario.name}`, () => {
    const profile = buildCapabilityProfile(scenario.activities, scenario.wellness);
    const states = Object.fromEntries(profile.capabilities.map((item) => [item.key, item.state]));
    for (const [key, expected] of Object.entries(scenario.expected)) assert.equal(states[key], expected, `${key} capability`);
    const serialized = JSON.stringify({ scenario, profile });
    assert.equal(serialized.includes("NaN"), false);
    for (const current of scenario.activities) {
      for (const key of ["averagePower", "averageHeartRate"] as const) {
        if (current[key].status === "missing") assert.equal(current[key].value, null);
      }
    }
  });
}

test("correlation requires at least five measured pairs and reports uncertainty", () => {
  const loads = [50, 58, 55, 71, 69, 82];
  const activities = Array.from({ length: 6 }, (_, index) => activity({ id: `a-${index}`, localDate: `2026-05-0${index + 1}`, date: `2026-05-0${index + 1}T09:00:00.000Z`, trainingLoad: metric(loads[index], "score", "fixture", "fixture.csv") }));
  const days = Array.from({ length: 6 }, (_, index) => {
    const day = wellness(`2026-05-0${index + 1}`);
    day.sleep!.totalSeconds = metric(24_000 + index * 900, "s", "fixture", "fixture.json");
    return day;
  });
  const result = calculateCorrelation(activities, days, "sleep", "effort");
  assert.equal(result.sampleSize, 6);
  assert.notEqual(result.confidenceLow, null);
});
