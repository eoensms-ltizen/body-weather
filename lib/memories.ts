import type { AtlasModel, ImportSummary, MemoryCard } from "./types";

function formatDistance(value: number | null): string {
  return value === null ? "거리 측정 없음" : `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} km`;
}

export interface MemoryCollection {
  cards: MemoryCard[];
  totalDistance: number | null;
  totalHours: number | null;
  activityDays: number;
  years: number[];
}

export function buildMemories(summary: ImportSummary, atlas: AtlasModel): MemoryCollection {
  const measuredDistances = summary.activities.flatMap((activity) => activity.distance.value === null ? [] : [activity.distance.value]);
  const measuredTimes = summary.activities.flatMap((activity) => activity.movingTime.value === null ? [] : [activity.movingTime.value]);
  const totalDistance = measuredDistances.length ? measuredDistances.reduce((sum, value) => sum + value, 0) : null;
  const totalHours = measuredTimes.length ? measuredTimes.reduce((sum, value) => sum + value, 0) / 3600 : null;
  const cards: MemoryCard[] = [];
  const chronologically = [...summary.activities].sort((a, b) => a.date.localeCompare(b.date));
  const first = chronologically[0];
  if (first) cards.push({
    id: "first-activity",
    kind: "first",
    eyebrow: "FIRST TRACE",
    title: "아틀라스의 첫 번째 선",
    description: `${first.localDate} · ${first.name} · ${formatDistance(first.distance.value)}`,
    activityIds: [first.id],
    date: first.localDate,
    coordinate: atlas.routes.find((route) => route.id === first.id)?.centroid,
    evidence: "가져온 활동 중 가장 이른 날짜",
  });

  atlas.placeClusters.slice(0, 5).forEach((place, index) => {
    cards.push({
      id: `memory-${place.id}`,
      kind: "place",
      eyebrow: index === 0 ? "MOST RETURNED" : "PLACE MEMORY",
      title: place.label,
      description: `${place.startDate} — ${place.endDate} · ${place.visitCount}개의 경로`,
      activityIds: place.activityIds,
      date: place.endDate,
      coordinate: place.center,
      evidence: `18km 이내 경로 중심을 하나의 지역 경험으로 묶음`,
    });
  });

  atlas.achievements.forEach((achievement) => {
    cards.push({
      id: `memory-${achievement.id}`,
      kind: achievement.evidence === "source-confirmed" ? "achievement" : "record",
      eyebrow: achievement.evidence === "source-confirmed" ? "SOURCE ACHIEVEMENT" : "ATLAS RECORD",
      title: achievement.title,
      description: achievement.description,
      activityIds: [achievement.activityId],
      date: summary.activities.find((activity) => activity.id === achievement.activityId)?.localDate,
      coordinate: achievement.coordinate,
      evidence: achievement.evidence === "source-confirmed"
        ? `${achievement.sourceField} 원본 필드에서 확인`
        : `${achievement.sourceField}를 종목별로 비교해 계산`,
    });
  });

  const bySeason = new Map<string, typeof summary.activities>();
  summary.activities.forEach((activity) => {
    const month = Number(activity.localDate.slice(5, 7));
    const season = month <= 2 || month === 12 ? "겨울" : month <= 5 ? "봄" : month <= 8 ? "여름" : "가을";
    const key = `${activity.localDate.slice(0, 4)} ${season}`;
    bySeason.set(key, [...(bySeason.get(key) ?? []), activity]);
  });
  [...bySeason.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 4).forEach(([season, activities]) => {
    const distance = activities.flatMap((activity) => activity.distance.value === null ? [] : [activity.distance.value]);
    cards.push({
      id: `season-${season}`,
      kind: "season",
      eyebrow: "SEASON CHAPTER",
      title: `${season}, ${activities.length}개의 움직임`,
      description: distance.length ? `누적 ${formatDistance(distance.reduce((sum, value) => sum + value, 0))}` : "거리 없이 날짜와 종목으로 남은 계절",
      activityIds: activities.map((activity) => activity.id),
      date: activities.map((activity) => activity.localDate).sort().at(-1),
      coordinate: atlas.routes.find((route) => activities.some((activity) => activity.id === route.id))?.centroid,
      evidence: "활동 현지 날짜를 계절별로 집계",
    });
  });

  return {
    cards,
    totalDistance,
    totalHours,
    activityDays: new Set(summary.activities.map((activity) => activity.localDate)).size,
    years: [...new Set(summary.activities.map((activity) => Number(activity.localDate.slice(0, 4))))].filter(Number.isFinite).sort((a, b) => a - b),
  };
}
