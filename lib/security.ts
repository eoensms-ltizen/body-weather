import type { Entry } from "@zip.js/zip.js";
import type { DataQualityIssue, SourceFileSummary } from "./types";

const MEDIA_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "gif", "webp", "heic", "mp4", "mov", "avi", "mkv",
]);
const SUPPORTED_EXTENSIONS = new Set(["csv", "json", "gpx", "fit", "gz", "zip"]);

export const ZIP_LIMITS = {
  maxEntries: 10_000,
  maxEntryBytes: 250 * 1024 * 1024,
  maxTotalBytes: 1_000 * 1024 * 1024,
  maxNestedZipBytes: 500 * 1024 * 1024,
};

export interface ZipInspection {
  summaries: SourceFileSummary[];
  issues: DataQualityIssue[];
  mediaSkipped: number;
  unsupportedSkipped: number;
}

export function isUnsafePath(name: string): boolean {
  const normalized = name.replace(/\\/g, "/");
  return (
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..") ||
    normalized.includes("\0")
  );
}

export function extensionOf(name: string): string {
  const clean = name.toLowerCase().split("?")[0];
  const part = clean.split(".").pop();
  return part === clean ? "" : part ?? "";
}

export function inspectZip(
  entries: Entry[],
  source: "strava" | "garmin" | "unknown",
): ZipInspection {
  const files = entries.filter((entry) => !entry.directory);
  if (files.length > ZIP_LIMITS.maxEntries) {
    throw new Error(`ZIP_ENTRY_LIMIT:${files.length}`);
  }

  const issues: DataQualityIssue[] = [];
  const summaries: SourceFileSummary[] = [];
  let mediaSkipped = 0;
  let unsupportedSkipped = 0;
  let totalBytes = 0;

  for (const entry of files) {
    const original = entry.filename;
    if (isUnsafePath(original)) throw new Error(`ZIP_SLIP:${original}`);
    const size = entry.uncompressedSize ?? 0;
    const compressed = entry.compressedSize ?? size;
    const extension = extensionOf(entry.filename);
    if (MEDIA_EXTENSIONS.has(extension)) {
      mediaSkipped += 1;
      summaries.push({ name: entry.filename, source, size, supported: false, skippedReason: "media" });
    } else if (!SUPPORTED_EXTENSIONS.has(extension)) {
      unsupportedSkipped += 1;
      summaries.push({ name: entry.filename, source, size, supported: false, skippedReason: "unsupported" });
    } else {
      totalBytes += size;
      if (size > ZIP_LIMITS.maxEntryBytes) throw new Error(`ZIP_ENTRY_SIZE:${entry.filename}`);
      if (compressed > 0 && size / compressed > 200) {
        throw new Error(`ZIP_RATIO_LIMIT:${entry.filename}`);
      }
      summaries.push({ name: entry.filename, source, size, supported: true });
    }
  }
  if (totalBytes > ZIP_LIMITS.maxTotalBytes) throw new Error(`ZIP_TOTAL_SIZE:${totalBytes}`);
  if (mediaSkipped > 0) {
    issues.push({
      id: `${source}-media-skipped`,
      severity: "info",
      code: "MEDIA_SKIPPED",
      message: `미디어 파일 ${mediaSkipped}개를 개인정보 보호 정책에 따라 건너뛰었습니다.`,
      recoverable: true,
    });
  }
  return { summaries, issues, mediaSkipped, unsupportedSkipped };
}
