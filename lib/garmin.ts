import { TextWriter, type Entry, type FileEntry } from "@zip.js/zip.js";
import {
  metric,
  missingMetric,
  type DailyWellness,
  type DataQualityIssue,
  type SleepSession,
} from "./types";

type JsonRecord = Record<string, unknown>;

function asNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function object(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function list(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") as JsonRecord[] : [];
}

function blankDay(date: string): DailyWellness {
  return {
    date,
    hrv: missingMetric("ms", "garmin", ""),
    restingHeartRate: missingMetric("bpm", "garmin", ""),
    bodyBatteryHigh: missingMetric("score", "garmin", ""),
    bodyBatteryLow: missingMetric("score", "garmin", ""),
    bodyBatteryCharged: missingMetric("score", "garmin", ""),
    bodyBatteryDrained: missingMetric("score", "garmin", ""),
    averageStress: missingMetric("score", "garmin", ""),
    skinTemperature: missingMetric("°C Δ", "garmin", ""),
    respiration: missingMetric("brpm", "garmin", ""),
    steps: missingMetric("steps", "garmin", ""),
    activeCalories: missingMetric("kcal", "garmin", ""),
    hydration: missingMetric("ml", "garmin", ""),
    sweatLoss: missingMetric("ml", "garmin", ""),
  };
}

function dayFor(map: Map<string, DailyWellness>, date: string): DailyWellness {
  if (!map.has(date)) map.set(date, blankDay(date));
  return map.get(date)!;
}

function sleepMetric(value: unknown, unit: string, file: string) {
  return metric(value, unit, "garmin.sleep", file);
}

function parseSleep(record: JsonRecord, file: string): SleepSession | null {
  const date = String(record.calendarDate ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const scores = object(record.sleepScores);
  const deep = asNumber(record.deepSleepSeconds);
  const light = asNumber(record.lightSleepSeconds);
  const rem = asNumber(record.remSleepSeconds);
  const awake = asNumber(record.awakeSleepSeconds);
  const total = [deep, light, rem].every((value) => value === undefined)
    ? undefined
    : (deep ?? 0) + (light ?? 0) + (rem ?? 0);
  return {
    calendarDate: date,
    start: typeof record.sleepStartTimestampGMT === "string" ? record.sleepStartTimestampGMT : undefined,
    end: typeof record.sleepEndTimestampGMT === "string" ? record.sleepEndTimestampGMT : undefined,
    totalSeconds: sleepMetric(total, "s", file),
    deepSeconds: sleepMetric(deep, "s", file),
    lightSeconds: sleepMetric(light, "s", file),
    remSeconds: sleepMetric(rem, "s", file),
    awakeSeconds: sleepMetric(awake, "s", file),
    score: sleepMetric(object(scores.overallScore).value ?? scores.overallScore, "score", file),
    recoveryScore: sleepMetric(object(scores.recoveryScore).value ?? scores.recoveryScore, "score", file),
    averageStress: sleepMetric(record.avgSleepStress, "score", file),
    respiration: sleepMetric(record.averageRespiration, "brpm", file),
  };
}

function statusMetric(record: JsonRecord, type: string, unit: string, file: string) {
  const found = list(record.metrics).find((candidate) => candidate.type === type);
  return metric(found?.value, unit, `garmin.health.${type.toLowerCase()}`, file);
}

function bodyBatteryStat(value: unknown, type: string): unknown {
  return list(object(value).bodyBatteryStatList).find((stat) => stat.bodyBatteryStatType === type)?.statsValue;
}

export async function parseGarminWellness(
  allEntries: Entry[],
  startDate?: string,
  endDate?: string,
): Promise<{ wellness: DailyWellness[]; issues: DataQualityIssue[] }> {
  const days = new Map<string, DailyWellness>();
  const issues: DataQualityIssue[] = [];
  const entries = allEntries.filter((entry): entry is FileEntry =>
    !entry.directory && entry.filename.toLowerCase().endsWith(".json") &&
    /(sleepdata|healthstatusdata|udsfile|hydrationlogfile)/i.test(entry.filename),
  );

  for (const entry of entries) {
    try {
      const parsed = JSON.parse(await entry.getData(new TextWriter()));
      for (const record of list(parsed)) {
        const date = String(record.calendarDate ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (startDate && date < startDate) || (endDate && date > endDate)) continue;
        const day = dayFor(days, date);
        if (/sleepdata/i.test(entry.filename)) {
          day.sleep = parseSleep(record, entry.filename) ?? undefined;
        } else if (/healthstatusdata/i.test(entry.filename)) {
          day.hrv = statusMetric(record, "HRV", "ms", entry.filename);
          const healthHr = statusMetric(record, "HR", "bpm", entry.filename);
          if (healthHr.value !== null) day.restingHeartRate = healthHr;
          day.skinTemperature = statusMetric(record, "SKIN_TEMP_C", "°C Δ", entry.filename);
          day.respiration = statusMetric(record, "RESPIRATION", "brpm", entry.filename);
        } else if (/udsfile/i.test(entry.filename)) {
          day.restingHeartRate = metric(
            record.restingHeartRate ?? record.currentDayRestingHeartRate,
            "bpm", "garmin.uds", entry.filename,
          );
          const battery = object(record.bodyBattery);
          day.bodyBatteryHigh = metric(bodyBatteryStat(battery, "HIGHEST"), "score", "garmin.bodyBattery", entry.filename);
          day.bodyBatteryLow = metric(bodyBatteryStat(battery, "LOWEST"), "score", "garmin.bodyBattery", entry.filename);
          day.bodyBatteryCharged = metric(battery.chargedValue, "score", "garmin.bodyBattery", entry.filename);
          day.bodyBatteryDrained = metric(battery.drainedValue, "score", "garmin.bodyBattery", entry.filename);
          const stressTotal = list(object(record.allDayStress).aggregatorList).find((item) => item.type === "TOTAL");
          day.averageStress = metric(stressTotal?.averageStressLevel, "score", "garmin.stress", entry.filename);
          day.steps = metric(record.totalSteps, "steps", "garmin.uds", entry.filename);
          day.activeCalories = metric(record.activeKilocalories ?? record.wellnessActiveKilocalories, "kcal", "garmin.uds", entry.filename);
          const respiration = object(record.respiration);
          if (respiration.avgWakingRespirationValue !== undefined) {
            day.respiration = metric(respiration.avgWakingRespirationValue, "brpm", "garmin.uds", entry.filename);
          }
        } else if (/hydrationlogfile/i.test(entry.filename)) {
          const currentHydration = day.hydration.value ?? 0;
          const currentSweat = day.sweatLoss.value ?? 0;
          day.hydration = metric(currentHydration + (asNumber(record.valueInML) ?? 0), "ml", "garmin.hydration", entry.filename, "derived");
          day.sweatLoss = metric(currentSweat + (asNumber(record.estimatedSweatLossInML) ?? 0), "ml", "garmin.hydration", entry.filename, "derived");
        }
      }
    } catch {
      issues.push({
        id: `garmin-json-${entry.filename}`,
        severity: "warning",
        code: "GARMIN_JSON_INVALID",
        message: "일부 Garmin JSON을 읽지 못했지만 다른 건강 데이터는 계속 분석했습니다.",
        sourceFile: entry.filename,
        recoverable: true,
      });
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return { wellness: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), issues };
}
