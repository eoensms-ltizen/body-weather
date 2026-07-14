import { BlobReader, TextWriter, ZipReader, type Entry } from "@zip.js/zip.js";
import { buildCapabilityProfile, matchActivities } from "./analytics";
import { parseGarminWellness } from "./garmin";
import { inspectZip } from "./security";
import { attachRoutes, parseStravaActivities } from "./strava";
import type { Activity, DataQualityIssue, ImportSummary } from "./types";

export interface ImportOptions {
  startDate?: string;
  endDate?: string;
  onProgress?: (stage: string, progress: number) => void;
}

function detectSource(entries: Entry[]): "strava" | "garmin" | "unknown" {
  const names = entries.map((entry) => entry.filename.toLowerCase());
  if (names.some((name) => name.endsWith("activities.csv"))) return "strava";
  if (names.some((name) => name.includes("di_connect/") || name.includes("sleepdata"))) return "garmin";
  return "unknown";
}

async function sha256(file: File): Promise<string> {
  if (file.size > 256 * 1024 * 1024) return `large-file:${file.size}:${file.lastModified}`;
  if (!globalThis.crypto?.subtle) return "unavailable";
  const digest = await globalThis.crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function importHealthArchives(
  files: File[],
  options: ImportOptions,
): Promise<ImportSummary> {
  if (files.length === 0) throw new Error("ZIP_REQUIRED");
  const issues: DataQualityIssue[] = [];
  const sourceFiles: ImportSummary["sourceFiles"] = [];
  const hashes: Record<string, string> = {};
  const stravaActivities: Activity[] = [];
  const garminActivities: Activity[] = [];
  const wellness: ImportSummary["wellness"] = [];
  let mediaSkipped = 0;
  let unsupportedSkipped = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    options.onProgress?.(`${file.name} 안전 검사`, index / files.length);
    hashes[file.name] = await sha256(file);
    let reader: ZipReader<Blob>;
    let entries: Entry[];
    try {
      reader = new ZipReader(new BlobReader(file));
      entries = await reader.getEntries();
    } catch {
      issues.push({
        id: `archive-${index}`,
        severity: "error",
        code: "INVALID_ZIP",
        message: `${file.name}을 ZIP으로 열지 못했습니다. 다른 정상 소스는 계속 처리했습니다.`,
        recoverable: true,
      });
      continue;
    }
    const source = detectSource(entries);
    try {
      const inspection = inspectZip(entries, source);
      sourceFiles.push(...inspection.summaries);
      issues.push(...inspection.issues);
      mediaSkipped += inspection.mediaSkipped;
      unsupportedSkipped += inspection.unsupportedSkipped;
    } catch {
      issues.push({
        id: `security-${index}`,
        severity: "error",
        code: "UNSAFE_ARCHIVE",
        message: `안전 제한을 통과하지 못한 ${file.name}은 처리하지 않았습니다.`,
        recoverable: true,
      });
      await reader.close();
      continue;
    }

    if (source === "strava") {
      const entry = entries.find((candidate) =>
        !candidate.directory && candidate.filename.toLowerCase().split("/").pop() === "activities.csv",
      );
      if (!entry || entry.directory) { await reader.close(); continue; }
      options.onProgress?.("Strava 활동 정규화", 0.18 + index / files.length * 0.08);
      const parsed = parseStravaActivities(
        await entry.getData(new TextWriter()),
        entry.filename,
        options.startDate,
        options.endDate,
      );
      stravaActivities.push(...parsed.activities);
      issues.push(...parsed.issues);
      issues.push(...await attachRoutes(entries, parsed.activities, (done, total) => {
        options.onProgress?.("운동 경로 분석", 0.28 + (total ? done / total : 1) * 0.3);
      }));
    } else if (source === "garmin") {
      options.onProgress?.("Garmin 수면·회복 정규화", 0.58);
      const parsed = await parseGarminWellness(entries, options.startDate, options.endDate);
      wellness.push(...parsed.wellness);
      issues.push(...parsed.issues);
    } else {
      issues.push({
        id: `unknown-${index}`,
        severity: "warning",
        code: "UNKNOWN_EXPORT",
        message: `${file.name}에서 지원하는 Strava 또는 Garmin 구조를 찾지 못했습니다.`,
        recoverable: true,
      });
    }
    await reader.close();
  }

  const activities = stravaActivities.length > 0 ? stravaActivities : garminActivities;
  activities.sort((a, b) => a.date.localeCompare(b.date));
  const uniqueWellness = [...new Map(wellness.map((day) => [day.date, day])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
  options.onProgress?.("데이터 능력표와 분석 생성", 0.92);
  const matches = matchActivities(stravaActivities, garminActivities);
  const capabilityProfile = buildCapabilityProfile(activities, uniqueWellness);
  options.onProgress?.("완료", 1);

  const availableDates = [...activities.map((activity) => activity.localDate), ...uniqueWellness.map((day) => day.date)].sort();
  return {
    importedAt: new Date().toISOString(),
    startDate: options.startDate ?? availableDates[0] ?? "",
    endDate: options.endDate ?? availableDates.at(-1) ?? "",
    activities,
    wellness: uniqueWellness,
    sourceFiles,
    issues,
    matches,
    capabilityProfile,
    mediaSkipped,
    unsupportedSkipped,
    sourceHashes: hashes,
  };
}
