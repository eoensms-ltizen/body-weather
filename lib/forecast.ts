import {
  CALCULATION_VERSION,
  type Activity,
  type DailyWellness,
  type ForecastConfidenceLevel,
  type ForecastFactor,
  type ForecastSnapshot,
  type ImportSummary,
  type TomorrowScenario,
} from "./types";

const DAY_MS = 86_400_000;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function dateValue(date: string): number {
  return new Date(`${date}T12:00:00Z`).getTime();
}

function daysBetween(earlier: string, later: string): number {
  return Math.max(0, Math.round((dateValue(later) - dateValue(earlier)) / DAY_MS));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function robustScore(current: number, history: number[], higherIsBetter: boolean): number {
  const center = median(history);
  if (center === null || history.length < 7) return clamp(current);
  const mad = median(history.map((value) => Math.abs(value - center))) ?? 0;
  if (mad < 0.0001) return 60;
  const z = (current - center) / (mad * 1.4826);
  return clamp(50 + (higherIsBetter ? z : -z) * 14);
}

function latestDate(summary: ImportSummary): string {
  return [...summary.activities.map((activity) => activity.localDate), ...summary.wellness.map((day) => day.date)]
    .sort().at(-1) ?? summary.endDate;
}

function todayInKorea(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function windowDays(wellness: DailyWellness[], asOfDate: string): DailyWellness[] {
  const start = new Date(`${asOfDate}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 28);
  const startDate = start.toISOString().slice(0, 10);
  return wellness.filter((day) => day.date >= startDate && day.date < asOfDate);
}

function factor(
  key: string,
  label: string,
  normalizedScore: number,
  baseWeight: number,
  source: string,
  baselineDays: number,
  explanation: string,
  status: ForecastFactor["status"] = "derived",
): ForecastFactor {
  return { key, label, normalizedScore: clamp(normalizedScore), weight: baseWeight, source, baselineDays, explanation, status };
}

function wellnessFactors(day: DailyWellness | undefined, history: DailyWellness[]): ForecastFactor[] {
  if (!day) return [];
  const result: ForecastFactor[] = [];
  const sleepScore = day.sleep?.score.value;
  const sleepHours = day.sleep?.totalSeconds.value !== null && day.sleep?.totalSeconds.value !== undefined
    ? day.sleep.totalSeconds.value / 3600 : null;
  if (sleepScore !== null && sleepScore !== undefined) {
    result.push(factor("sleep", "수면", sleepScore, 0.24, day.sleep?.score.source ?? "garmin.sleep", history.filter((item) => item.sleep?.score.value !== null).length, `수면 점수 ${Math.round(sleepScore)}점`));
  } else if (sleepHours !== null) {
    const score = clamp(100 - Math.abs(7.75 - sleepHours) * 18);
    result.push(factor("sleep", "수면", score, 0.2, day.sleep?.totalSeconds.source ?? "garmin.sleep", history.filter((item) => item.sleep?.totalSeconds.value !== null).length, `수면 ${sleepHours.toFixed(1)}시간`, "estimated"));
  }

  if (day.hrv.value !== null) {
    const values = history.flatMap((item) => item.hrv.value === null ? [] : [item.hrv.value]);
    result.push(factor("hrv", "HRV", robustScore(day.hrv.value, values, true), 0.2, day.hrv.source, values.length, `현재 ${Math.round(day.hrv.value)}ms · 개인 기준선 비교`));
  }
  if (day.restingHeartRate.value !== null) {
    const values = history.flatMap((item) => item.restingHeartRate.value === null ? [] : [item.restingHeartRate.value]);
    result.push(factor("resting-heart", "안정시 심박", robustScore(day.restingHeartRate.value, values, false), 0.1, day.restingHeartRate.source, values.length, `현재 ${Math.round(day.restingHeartRate.value)}bpm · 낮을수록 회복 신호`));
  }
  if (day.bodyBatteryHigh.value !== null) {
    result.push(factor("battery", "Body Battery", day.bodyBatteryHigh.value, 0.2, day.bodyBatteryHigh.source, history.filter((item) => item.bodyBatteryHigh.value !== null).length, `최고 ${Math.round(day.bodyBatteryHigh.value)}점`));
  }
  if (day.averageStress.value !== null) {
    result.push(factor("stress", "스트레스", 100 - day.averageStress.value, 0.1, day.averageStress.source, history.filter((item) => item.averageStress.value !== null).length, `평균 ${Math.round(day.averageStress.value)}점 · 낮을수록 맑음`));
  }
  return result;
}

function loadValue(activity: Activity): number | null {
  return activity.trainingLoad.value ?? activity.relativeEffort.value ??
    (activity.movingTime.value !== null ? activity.movingTime.value / 3600 * 20 : null);
}

function loadFactor(activities: Activity[], asOfDate: string): ForecastFactor | null {
  const recentStartDate = new Date(`${asOfDate}T12:00:00Z`);
  recentStartDate.setUTCDate(recentStartDate.getUTCDate() - 2);
  const baselineStartDate = new Date(`${asOfDate}T12:00:00Z`);
  baselineStartDate.setUTCDate(baselineStartDate.getUTCDate() - 28);
  const recentStart = recentStartDate.toISOString().slice(0, 10);
  const baselineStart = baselineStartDate.toISOString().slice(0, 10);
  const recent = activities.filter((item) => item.localDate >= recentStart && item.localDate <= asOfDate)
    .flatMap((item) => loadValue(item) === null ? [] : [loadValue(item)!]);
  const baseline = activities.filter((item) => item.localDate >= baselineStart && item.localDate < recentStart)
    .flatMap((item) => loadValue(item) === null ? [] : [loadValue(item)!]);
  if (!recent.length && !baseline.length) return null;
  const recentLoad = recent.reduce((sum, value) => sum + value, 0);
  const expectedThreeDay = baseline.length ? baseline.reduce((sum, value) => sum + value, 0) / 26 * 3 : Math.max(1, recentLoad);
  const ratio = recentLoad / Math.max(1, expectedThreeDay);
  const score = clamp(88 - Math.max(0, ratio - 0.6) * 32);
  return factor("load", "최근 부하", score, 0.16, "strava.activity-load", baseline.length, `최근 3일 부하 ${Math.round(recentLoad)} · 개인 활동 기준 대비 ${ratio.toFixed(1)}배`, baseline.length >= 7 ? "derived" : "estimated");
}

function distributeWeights(factors: ForecastFactor[]): ForecastFactor[] {
  const total = factors.reduce((sum, item) => sum + item.weight, 0);
  return factors.map((item) => ({ ...item, weight: total ? item.weight / total : 0 }));
}

function confidenceFor(factors: ForecastFactor[], freshnessDays: number): ForecastConfidenceLevel {
  const healthGroups = new Set(factors.filter((item) => item.key !== "load").map((item) => item.key)).size;
  const baselineDays = Math.max(0, ...factors.map((item) => item.baselineDays));
  if (healthGroups >= 3 && baselineDays >= 14 && freshnessDays <= 1) return "high";
  if (healthGroups >= 2 && baselineDays >= 7 && freshnessDays <= 3) return "medium";
  return "low";
}

function tierFor(factors: ForecastFactor[]): ForecastSnapshot["tier"] {
  const health = factors.filter((item) => item.key !== "load").length;
  if (health >= 3 && factors.some((item) => item.key === "load")) return "A";
  if (health >= 2) return "B";
  if (factors.some((item) => item.key === "load")) return "C";
  if (factors.length > 0) return "D";
  return "E";
}

function weather(score: number | null): ForecastSnapshot["weatherState"] {
  if (score === null) return "관측 부족";
  if (score >= 85) return "맑음";
  if (score >= 65) return "구름 조금";
  if (score >= 45) return "흐림";
  if (score >= 25) return "비";
  return "폭풍";
}

function recommendation(score: number | null): ForecastSnapshot["recommendationBand"] {
  if (score === null) return "판단 보류";
  if (score >= 85) return "강하게";
  if (score >= 65) return "보통";
  if (score >= 45) return "가볍게";
  return "회복 우선";
}

const SCENARIO_DELTA: Record<TomorrowScenario, number> = { rest: 8, easy: 4, moderate: 0, hard: -9 };

export function buildForecast(
  summary: ImportSummary,
  scenario: TomorrowScenario = "easy",
  requestedDate?: string,
  now = new Date(),
): ForecastSnapshot {
  const asOfDate = requestedDate ?? latestDate(summary);
  const today = todayInKorea(now);
  const freshnessDays = daysBetween(asOfDate, today);
  const current = summary.wellness.find((day) => day.date === asOfDate);
  const history = windowDays(summary.wellness, asOfDate);
  const trainingLoad = loadFactor(summary.activities, asOfDate);
  const factors = distributeWeights([
    ...wellnessFactors(current, history),
    ...(trainingLoad ? [trainingLoad] : []),
  ]);
  const score = factors.length ? Math.round(factors.reduce((sum, item) => sum + item.normalizedScore * item.weight, 0)) : null;
  const confidence = confidenceFor(factors, freshnessDays);
  const uncertainty = confidence === "high" ? 5 : confidence === "medium" ? 9 : 15;
  const projected = score === null ? null : clamp(score + SCENARIO_DELTA[scenario]);
  const scoreRange: [number, number] | null = projected === null ? null : [Math.round(clamp(projected - uncertainty)), Math.round(clamp(projected + uncertainty))];
  const reasons = [...factors].sort((a, b) => Math.abs(b.normalizedScore - 60) - Math.abs(a.normalizedScore - 60))
    .slice(0, 3).map((item) => `${item.label}: ${item.explanation}`);
  return {
    asOfDate,
    displayMode: freshnessDays <= 1 ? "today" : "latest-observation",
    nextLabel: freshnessDays <= 1 ? "내일" : "다음 날 시뮬레이션",
    score,
    scoreRange,
    weatherState: weather(score),
    recommendationBand: recommendation(score),
    confidence,
    tier: tierFor(factors),
    factors,
    reasons,
    assumptions: [scenario === "rest" ? "오늘 휴식" : scenario === "easy" ? "오늘 가벼운 운동" : scenario === "moderate" ? "오늘 보통 강도 운동" : "오늘 고강도 운동", "개인 기록의 연관 신호를 이용한 비의학적 시뮬레이션"],
    freshnessDays,
    scenario,
    calculationVersion: CALCULATION_VERSION,
  };
}
