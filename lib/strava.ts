import { Uint8ArrayWriter, type Entry, type FileEntry } from "@zip.js/zip.js";
import { Buffer } from "buffer";
import FitParser from "fit-file-parser";
import { firstValue, toCsvTable } from "./csv";
import { extensionOf } from "./security";
import {
  metric,
  missingMetric,
  type Activity,
  type DataQualityIssue,
  type RoutePoint,
} from "./types";

function parseStravaDate(value: string): Date | null {
  const normalized = value.replace(/,\s*(\d{1,2}:\d{2}:\d{2}\s*[AP]M)$/i, " $1");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseStravaActivities(
  text: string,
  sourceFile: string,
  startDate?: string,
  endDate?: string,
): { activities: Activity[]; issues: DataQualityIssue[] } {
  const table = toCsvTable(text);
  const issues: DataQualityIssue[] = [];
  const activities: Activity[] = [];
  if (!(table.positions.get("Activity Date")?.length)) {
    throw new Error("STRAVA_ACTIVITY_DATE_MISSING");
  }

  table.rows.forEach((row, index) => {
    const dateValue = firstValue(row, table.positions, ["Activity Date"]);
    const date = dateValue ? parseStravaDate(dateValue) : null;
    if (!date) {
      issues.push({
        id: `strava-date-${index}`,
        severity: "warning",
        code: "INVALID_ACTIVITY_DATE",
        message: `${index + 2}행의 활동 날짜를 해석하지 못해 건너뛰었습니다.`,
        sourceFile,
        recoverable: true,
      });
      return;
    }
    const day = localDate(date);
    if ((startDate && day < startDate) || (endDate && day > endDate)) return;
    const get = (...candidates: string[]) => firstValue(row, table.positions, candidates);
    const id = get("Activity ID") ?? `strava-${date.getTime()}-${index}`;
    activities.push({
      id,
      source: "strava",
      sourceFile,
      date: date.toISOString(),
      localDate: day,
      name: get("Activity Name") ?? "이름 없는 활동",
      type: get("Activity Type", "Type") ?? "Activity",
      elapsedTime: metric(get("Elapsed Time"), "s", "strava.activities", sourceFile),
      movingTime: metric(get("Moving Time"), "s", "strava.activities", sourceFile),
      distance: metric(get("Distance"), "km", "strava.activities", sourceFile),
      calories: metric(get("Calories"), "kcal", "strava.activities", sourceFile),
      averageHeartRate: metric(get("Average Heart Rate"), "bpm", "strava.activities", sourceFile),
      maxHeartRate: metric(get("Max Heart Rate"), "bpm", "strava.activities", sourceFile),
      relativeEffort: metric(get("Relative Effort"), "score", "strava.activities", sourceFile),
      averagePower: metric(get("Average Watts"), "W", "strava.activities", sourceFile),
      weightedAveragePower: metric(get("Weighted Average Power"), "W", "strava.activities", sourceFile),
      maxPower: metric(get("Max Watts"), "W", "strava.activities", sourceFile),
      trainingLoad: metric(get("Training Load"), "score", "strava.activities", sourceFile),
      intensity: metric(get("Intensity"), "%", "strava.activities", sourceFile),
      elevationGain: metric(get("Elevation Gain", "Total Elevation Gain"), "m", "strava.activities", sourceFile),
      achievementCount: metric(get("Achievement Count", "Achievements"), "count", "strava.activities", sourceFile),
      filename: get("Filename")?.replace(/\\/g, "/"),
    });
  });
  return { activities, issues };
}

function tagValue(block: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]+)</${name}>`, "i"));
    if (match) return match[1];
  }
  return undefined;
}

export function parseGpx(text: string): RoutePoint[] {
  const points: RoutePoint[] = [];
  const regex = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const lat = Number(match[1].match(/\blat=["']([^"']+)/i)?.[1]);
    const lon = Number(match[1].match(/\blon=["']([^"']+)/i)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const elevation = Number(tagValue(match[2], ["ele"]));
    const heartRate = Number(tagValue(match[2], ["gpxtpx:hr", "hr"]));
    const power = Number(tagValue(match[2], ["power", "gpxtpx:power"]));
    const speed = Number(tagValue(match[2], ["speed", "gpxtpx:speed"]));
    points.push({
      latitude: lat,
      longitude: lon,
      elevation: Number.isFinite(elevation) ? elevation : undefined,
      heartRate: Number.isFinite(heartRate) ? heartRate : undefined,
      power: Number.isFinite(power) ? power : undefined,
      speed: Number.isFinite(speed) ? speed : undefined,
      timestamp: tagValue(match[2], ["time"]),
    });
  }
  return points;
}

async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== "undefined") {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error("GZIP_UNSUPPORTED");
}

function fitRecordsToPoints(value: unknown): RoutePoint[] {
  const data = value as {
    records?: Array<Record<string, unknown>>;
    sessions?: Array<{ laps?: Array<{ records?: Array<Record<string, unknown>> }> }>;
  };
  const records = data.records ?? data.sessions?.flatMap((session) =>
    session.laps?.flatMap((lap) => lap.records ?? []) ?? [],
  ) ?? [];
  return records.flatMap((record) => {
    const latitude = Number(record.position_lat);
    const longitude = Number(record.position_long);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return [];
    return [{
      latitude,
      longitude,
      elevation: Number.isFinite(Number(record.altitude)) ? Number(record.altitude) : undefined,
      timestamp: record.timestamp instanceof Date
        ? record.timestamp.toISOString()
        : typeof record.timestamp === "string" ? record.timestamp : undefined,
      heartRate: Number.isFinite(Number(record.heart_rate)) ? Number(record.heart_rate) : undefined,
      power: Number.isFinite(Number(record.power)) ? Number(record.power) : undefined,
      speed: Number.isFinite(Number(record.speed)) ? Number(record.speed) : undefined,
    }];
  });
}

export async function parseRouteEntry(
  entry: FileEntry,
): Promise<RoutePoint[]> {
  const extension = extensionOf(entry.filename);
  let bytes: Uint8Array<ArrayBufferLike> = await entry.getData(new Uint8ArrayWriter());
  let innerName = entry.filename.toLowerCase();
  if (extension === "gz") {
    bytes = await gunzip(bytes);
    innerName = innerName.slice(0, -3);
  }
  if (innerName.endsWith(".gpx")) {
    return parseGpx(new TextDecoder("utf-8").decode(bytes));
  }
  if (innerName.endsWith(".fit")) {
    const parser = new FitParser({
      force: true,
      mode: "list",
      lengthUnit: "km",
      speedUnit: "km/h",
      elapsedRecordField: true,
    });
    return fitRecordsToPoints(await parser.parseAsync(Buffer.from(bytes)));
  }
  return [];
}

export async function attachRoutes(
  entries: Entry[],
  activities: Activity[],
  onProgress?: (completed: number, total: number) => void,
): Promise<DataQualityIssue[]> {
  const issues: DataQualityIssue[] = [];
  const byNormalized = new Map<string, FileEntry>();
  entries.forEach((entry) => {
    if (!entry.directory) byNormalized.set(entry.filename.replace(/\\/g, "/").toLowerCase(), entry);
  });
  const targets = activities.filter((activity) => activity.filename);
  let complete = 0;
  const processActivity = async (activity: Activity) => {
    const requested = activity.filename!.toLowerCase().replace(/^\//, "");
    const entry = byNormalized.get(requested) ?? byNormalized.get(`activities/${requested.split("/").pop()}`);
    if (!entry) {
      complete += 1;
      onProgress?.(complete, targets.length);
      return;
    }
    try {
      const points = await parseRouteEntry(entry);
      if (points.length > 0) {
        const stride = Math.max(1, Math.ceil(points.length / 650));
        activity.route = points.filter((_, index) => index % stride === 0);
        activity.streamCount = points.length;
      }
    } catch {
      issues.push({
        id: `route-${activity.id}`,
        severity: "warning",
        code: "ROUTE_PARSE_FAILED",
        message: `${activity.localDate} 활동의 경로를 읽지 못했지만 요약 데이터는 유지했습니다.`,
        sourceFile: entry.filename,
        recoverable: true,
      });
    }
    complete += 1;
    onProgress?.(complete, targets.length);
  };
  for (let offset = 0; offset < targets.length; offset += 4) {
    await Promise.all(targets.slice(offset, offset + 4).map(processActivity));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return issues;
}

export function hasActivityValue(activity: Activity, key: keyof Activity): boolean {
  const value = activity[key];
  return Boolean(value && typeof value === "object" && "value" in value && value.value !== null);
}

export function emptyActivityMetric(unit: string) {
  return missingMetric(unit, "strava.activities", "activities.csv");
}
