import { buildCapabilityProfile } from "./analytics";
import { metric, missingMetric, type Activity, type DailyWellness, type ImportSummary } from "./types";

export function buildVerificationSummary(): ImportSummary {
  const activities: Activity[] = Array.from({ length: 24 }, (_, index) => {
    const day = String(1 + index * 3).padStart(2, "0");
    const date = index < 10 ? `2026-04-${day}` : index < 20 ? `2026-05-${String(1 + (index - 10) * 3).padStart(2, "0")}` : `2026-06-${String(2 + (index - 20) * 4).padStart(2, "0")}`;
    const sourceFile = "verification/activities.csv";
    const measured = (value: number, unit: string) => metric(value, unit, "verification", sourceFile);
    const baseLat = 37.45 + index * 0.002;
    const baseLon = 126.92 + index * 0.003;
    return {
      id: `verify-${index}`, source: "strava", sourceFile, date: `${date}T08:30:00.000Z`, localDate: date,
      name: index % 3 === 0 ? "Morning Tempo" : index % 3 === 1 ? "Han River Current" : "Recovery Run",
      type: index % 3 === 2 ? "Run" : "Ride", elapsedTime: measured(3200 + index * 50, "s"), movingTime: measured(3000 + index * 45, "s"),
      distance: measured(12 + index * 1.7, "km"), calories: measured(380 + index * 18, "kcal"), averageHeartRate: measured(128 + index % 16, "bpm"), maxHeartRate: measured(158 + index % 18, "bpm"),
      relativeEffort: measured(35 + index * 2.4, "score"), averagePower: index % 3 === 2 ? missingMetric("W", "verification", sourceFile, "not_applicable") : measured(155 + index * 3, "W"),
      weightedAveragePower: index % 3 === 2 ? missingMetric("W", "verification", sourceFile, "not_applicable") : measured(170 + index * 3, "W"), maxPower: index % 3 === 2 ? missingMetric("W", "verification", sourceFile, "not_applicable") : measured(510 + index * 7, "W"),
      trainingLoad: measured(42 + index * 2.7, "score"), intensity: measured(70 + index % 20, "%"),
      route: Array.from({ length: 80 }, (_, point) => ({ latitude: baseLat + Math.sin(point / 10) * .035 + point * .0007, longitude: baseLon + Math.cos(point / 13) * .05 + point * .0009, heartRate: 120 + point % 35, power: index % 3 === 2 ? undefined : 145 + point % 100 })), streamCount: 1200,
    };
  });
  const wellness: DailyWellness[] = Array.from({ length: 91 }, (_, index) => {
    const date = new Date("2026-04-01T12:00:00"); date.setDate(date.getDate() + index);
    const day = date.toISOString().slice(0, 10); const sourceFile = "verification/wellness.json";
    const measured = (value: number, unit: string) => metric(value, unit, "verification", sourceFile);
    const missing = (unit: string) => missingMetric(unit, "verification", sourceFile);
    const sleepSeconds = 23_000 + (index % 11) * 620;
    return { date: day,
      sleep: index % 13 === 0 ? undefined : { calendarDate: day, totalSeconds: measured(sleepSeconds, "s"), deepSeconds: measured(4200 + index % 900, "s"), lightSeconds: measured(13_000, "s"), remSeconds: measured(5800, "s"), awakeSeconds: measured(700, "s"), score: measured(65 + index % 28, "score"), recoveryScore: measured(62 + index % 31, "score"), averageStress: measured(16 + index % 17, "score"), respiration: measured(13 + index % 4, "brpm") },
      hrv: index % 17 === 0 ? missing("ms") : measured(43 + index % 19, "ms"), restingHeartRate: measured(48 + index % 8, "bpm"), bodyBatteryHigh: measured(58 + index % 38, "score"), bodyBatteryLow: measured(8 + index % 19, "score"), bodyBatteryCharged: measured(32 + index % 48, "score"), bodyBatteryDrained: measured(25 + index % 50, "score"), averageStress: measured(21 + index % 24, "score"), skinTemperature: measured(-.5 + (index % 10) / 10, "°C Δ"), respiration: measured(13 + index % 4, "brpm"), steps: measured(5400 + index * 90, "steps"), activeCalories: measured(420 + index % 280, "kcal"), hydration: missing("ml"), sweatLoss: missing("ml") };
  });
  return { importedAt: new Date().toISOString(), startDate: "2026-04-01", endDate: "2026-06-30", activities, wellness, sourceFiles: [{ name: "verification/activities.csv", source: "strava", size: 2048, supported: true }, { name: "verification/wellness.json", source: "garmin", size: 4096, supported: true }], issues: [{ id: "fixture-gap", severity: "info", code: "EXPECTED_SENSOR_GAPS", message: "일부 러닝에는 파워 센서가 없어 해당 레이어에서 제외했습니다.", recoverable: true }], matches: [], capabilityProfile: buildCapabilityProfile(activities, wellness), mediaSkipped: 3, unsupportedSkipped: 0, sourceHashes: { "verification.zip": "development-only-fixture" } };
}
