import type {
  Activity,
  ActivityMatch,
  Capability,
  CapabilityProfile,
  CorrelationResult,
  DailyWellness,
  MetricValue,
} from "./types";

function capability(
  key: string,
  label: string,
  records: number,
  total: number,
  availableAt = 0.7,
): Capability {
  const coverage = total > 0 ? records / total : 0;
  const state = records === 0 ? "unavailable" : coverage >= availableAt ? "available" : "partial";
  return {
    key,
    label,
    state,
    coverage,
    records,
    total,
    reason: state === "available"
      ? `${records}개 기록에서 안정적으로 사용할 수 있습니다.`
      : state === "partial"
        ? `${records}개 기록에서만 사용할 수 있어 가능한 날짜에만 표시합니다.`
        : "해당 측정값을 찾지 못했습니다.",
  };
}

function hasMetric(value: MetricValue | undefined): boolean {
  return Boolean(value && value.value !== null && value.status !== "invalid");
}

export function buildCapabilityProfile(
  activities: Activity[],
  wellness: DailyWellness[],
): CapabilityProfile {
  const activityTotal = activities.length;
  const wellnessTotal = wellness.length;
  const caps = [
    capability("timeline", "운동 타임라인", activityTotal, activityTotal || 1),
    capability("summary", "거리 · 시간 · 칼로리", activities.filter((a) => hasMetric(a.distance) || hasMetric(a.elapsedTime)).length, activityTotal),
    capability("route", "경로 지도", activities.filter((a) => (a.route?.length ?? 0) > 1).length, activityTotal, 0.25),
    capability("heart", "심박 레이어", activities.filter((a) => hasMetric(a.averageHeartRate)).length, activityTotal),
    capability("power", "파워 레이어", activities.filter((a) => hasMetric(a.averagePower)).length, activityTotal),
    capability("effort", "운동 부하 레이어", activities.filter((a) => hasMetric(a.trainingLoad) || hasMetric(a.relativeEffort)).length, activityTotal),
    capability("sleep", "수면 분석", wellness.filter((d) => hasMetric(d.sleep?.totalSeconds)).length, wellnessTotal),
    capability("hrv", "HRV 분석", wellness.filter((d) => hasMetric(d.hrv)).length, wellnessTotal),
    capability("battery", "Body Battery", wellness.filter((d) => hasMetric(d.bodyBatteryHigh)).length, wellnessTotal),
    capability("stress", "스트레스 분석", wellness.filter((d) => hasMetric(d.averageStress)).length, wellnessTotal),
    capability("recovery", "운동 전후 회복", wellness.filter((d) => hasMetric(d.hrv) || hasMetric(d.bodyBatteryHigh) || hasMetric(d.sleep?.score)).length, wellnessTotal),
    capability("correlation", "상관관계 분석", wellness.filter((d) => hasMetric(d.sleep?.totalSeconds) || hasMetric(d.hrv)).length, wellnessTotal, 0.3),
    capability("atlas_base", "Experience Atlas", activityTotal, activityTotal || 1),
    capability("atlas_routes", "누적 경로 지도", activities.filter((a) => (a.route?.length ?? 0) > 1).length, activityTotal, 0.2),
    capability("atlas_places", "지역 경험", activities.filter((a) => (a.route?.length ?? 0) > 1).length, activityTotal, 0.15),
    capability("source_achievements", "원본 성과", activities.filter((a) => hasMetric(a.achievementCount)).length, activityTotal, 0.1),
    capability("personal_records", "개인 기록", activities.filter((a) => hasMetric(a.distance) || hasMetric(a.movingTime)).length, activityTotal, 0.25),
    capability("forecast_full", "Body Weather Forecast", wellness.filter((d) => [d.sleep?.score, d.hrv, d.bodyBatteryHigh, d.averageStress].filter(hasMetric).length >= 3).length, wellnessTotal, 0.2),
    capability("forecast_activity", "활동 기반 Forecast", activities.filter((a) => hasMetric(a.trainingLoad) || hasMetric(a.relativeEffort) || hasMetric(a.movingTime)).length, activityTotal, 0.25),
    capability("poster_export", "Atlas Poster", activities.filter((a) => (a.route?.length ?? 0) > 1).length, activityTotal, 0.05),
  ];
  return {
    capabilities: caps,
    activeCount: caps.filter((item) => item.state === "available").length,
    partialCount: caps.filter((item) => item.state === "partial").length,
    unavailableCount: caps.filter((item) => item.state === "unavailable").length,
  };
}

export function matchActivities(strava: Activity[], garmin: Activity[]): ActivityMatch[] {
  const matches: ActivityMatch[] = [];
  for (const activity of strava) {
    const candidates = garmin.map((candidate) => {
      const startDelta = Math.abs(new Date(activity.date).getTime() - new Date(candidate.date).getTime()) / 60_000;
      const typeMatch = activity.type.toLowerCase().includes(candidate.type.toLowerCase()) ||
        candidate.type.toLowerCase().includes(activity.type.toLowerCase());
      const activityDistance = activity.distance.value;
      const candidateDistance = candidate.distance.value;
      const distanceRatio = activityDistance && candidateDistance
        ? Math.min(activityDistance, candidateDistance) / Math.max(activityDistance, candidateDistance)
        : 0;
      const confidence = Math.max(0, 0.55 * Math.max(0, 1 - startDelta / 60) + 0.2 * Number(typeMatch) + 0.25 * distanceRatio);
      return { candidate, confidence, startDelta, typeMatch, distanceRatio };
    }).sort((a, b) => b.confidence - a.confidence);
    const best = candidates[0];
    if (!best || best.confidence < 0.5) continue;
    const status = best.confidence >= 0.88 ? "confirmed" : best.confidence >= 0.68 ? "probable" : "ambiguous";
    matches.push({
      stravaId: activity.id,
      garminId: best.candidate.id,
      confidence: best.confidence,
      status,
      evidence: [
        `시작 시각 차이 ${Math.round(best.startDelta)}분`,
        best.typeMatch ? "종목 일치" : "종목 불일치",
        best.distanceRatio ? `거리 유사도 ${Math.round(best.distanceRatio * 100)}%` : "거리 비교 불가",
      ],
    });
  }
  return matches;
}

function pearson(pairs: Array<[number, number]>): number | null {
  if (pairs.length < 5) return null;
  const meanX = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanY = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of pairs) {
    const dx = x - meanX;
    const dy = y - meanY;
    numerator += dx * dy;
    sumX += dx * dx;
    sumY += dy * dy;
  }
  const denominator = Math.sqrt(sumX * sumY);
  return denominator === 0 ? null : numerator / denominator;
}

function fisherInterval(r: number | null, n: number): [number | null, number | null] {
  if (r === null || n < 5 || Math.abs(r) >= 1) return [null, null];
  const z = Math.atanh(r);
  const margin = 1.96 / Math.sqrt(n - 3);
  return [Math.tanh(z - margin), Math.tanh(z + margin)];
}

export type CorrelationMetric = "sleep" | "hrv" | "battery" | "stress";
export type PerformanceMetric = "effort" | "heart" | "power" | "distance";

export function calculateCorrelation(
  activities: Activity[],
  wellness: DailyWellness[],
  xKey: CorrelationMetric,
  yKey: PerformanceMetric,
  activityType = "all",
): CorrelationResult {
  const byDate = new Map(wellness.map((day) => [day.date, day]));
  const filtered = activityType === "all" ? activities : activities.filter((item) => item.type === activityType);
  const pairs: Array<[number, number]> = [];
  for (const activity of filtered) {
    const day = byDate.get(activity.localDate);
    if (!day) continue;
    const x = xKey === "sleep" ? day.sleep?.totalSeconds.value !== null && day.sleep?.totalSeconds.value !== undefined
      ? day.sleep.totalSeconds.value / 3600 : null
      : xKey === "hrv" ? day.hrv.value
        : xKey === "battery" ? day.bodyBatteryHigh.value
          : day.averageStress.value;
    const y = yKey === "effort" ? activity.trainingLoad.value ?? activity.relativeEffort.value
      : yKey === "heart" ? activity.averageHeartRate.value
        : yKey === "power" ? activity.averagePower.value
          : activity.distance.value;
    if (x !== null && x !== undefined && y !== null && y !== undefined) pairs.push([x, y]);
  }
  const coefficient = pearson(pairs);
  const [confidenceLow, confidenceHigh] = fisherInterval(coefficient, pairs.length);
  return {
    xKey,
    yKey,
    coefficient,
    sampleSize: pairs.length,
    missingRate: filtered.length > 0 ? 1 - pairs.length / filtered.length : 1,
    method: "pearson",
    direction: coefficient === null ? "insufficient" : coefficient > 0.15 ? "positive" : coefficient < -0.15 ? "negative" : "neutral",
    confidenceLow,
    confidenceHigh,
  };
}

export function recoveryScore(day: DailyWellness | undefined): { value: number | null; confidence: "높음" | "중간" | "낮음"; inputs: string[] } {
  if (!day) return { value: null, confidence: "낮음", inputs: [] };
  const values: Array<{ label: string; value: number }> = [];
  if (day.sleep?.score.value !== null && day.sleep?.score.value !== undefined) values.push({ label: "수면 점수", value: day.sleep.score.value });
  if (day.bodyBatteryHigh.value !== null) values.push({ label: "Body Battery", value: day.bodyBatteryHigh.value });
  if (day.hrv.value !== null) values.push({ label: "HRV", value: Math.min(100, day.hrv.value * 1.4) });
  if (day.averageStress.value !== null) values.push({ label: "스트레스", value: Math.max(0, 100 - day.averageStress.value) });
  if (values.length === 0) return { value: null, confidence: "낮음", inputs: [] };
  return {
    value: Math.round(values.reduce((sum, item) => sum + item.value, 0) / values.length),
    confidence: values.length >= 4 ? "높음" : values.length >= 2 ? "중간" : "낮음",
    inputs: values.map((item) => item.label),
  };
}
