import type { ImportSummary } from "./types";

export const LOCAL_CACHE_SCHEMA_VERSION = 1;
export const LOCAL_CACHE_KEY = "latest-atlas";

const DATABASE_NAME = "body-weather-local-atlas";
const DATABASE_VERSION = 1;
const SUMMARY_STORE = "summaries";
const METADATA_STORE = "metadata";

export interface CachedAtlasMetadata {
  key: typeof LOCAL_CACHE_KEY;
  schemaVersion: number;
  savedAt: string;
  importedAt: string;
  startDate: string;
  endDate: string;
  activityCount: number;
  wellnessDayCount: number;
  routeActivityCount: number;
  routePointCount: number;
  sources: Array<"strava" | "garmin">;
}

interface CachedAtlasRecord {
  key: typeof LOCAL_CACHE_KEY;
  schemaVersion: number;
  summary: ImportSummary;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("로컬 저장소 요청을 완료하지 못했습니다."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("로컬 저장소 기록을 완료하지 못했습니다."));
    transaction.onabort = () => reject(transaction.error ?? new Error("로컬 저장소 기록이 중단되었습니다."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("이 브라우저는 기기 저장을 지원하지 않습니다."));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SUMMARY_STORE)) database.createObjectStore(SUMMARY_STORE, { keyPath: "key" });
      if (!database.objectStoreNames.contains(METADATA_STORE)) database.createObjectStore(METADATA_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error ?? new Error("기기 저장소를 열지 못했습니다."));
    request.onblocked = () => reject(new Error("다른 탭에서 기기 저장소를 사용 중입니다. 다른 Body Weather 탭을 닫고 다시 시도해 주세요."));
  });
}

function validMetadata(value: unknown): value is CachedAtlasMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Partial<CachedAtlasMetadata>;
  return metadata.key === LOCAL_CACHE_KEY && metadata.schemaVersion === LOCAL_CACHE_SCHEMA_VERSION &&
    typeof metadata.savedAt === "string" && typeof metadata.importedAt === "string" &&
    typeof metadata.startDate === "string" && typeof metadata.endDate === "string" &&
    Number.isFinite(metadata.activityCount) && Number.isFinite(metadata.wellnessDayCount) &&
    Number.isFinite(metadata.routeActivityCount) && Number.isFinite(metadata.routePointCount) && Array.isArray(metadata.sources);
}

function validSummary(value: unknown): value is ImportSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<ImportSummary>;
  return typeof summary.importedAt === "string" && typeof summary.startDate === "string" && typeof summary.endDate === "string" &&
    Array.isArray(summary.activities) && Array.isArray(summary.wellness) && Array.isArray(summary.sourceFiles) &&
    Array.isArray(summary.issues) && Array.isArray(summary.matches) && Boolean(summary.capabilityProfile);
}

export function buildCachedAtlasMetadata(summary: ImportSummary, savedAt = new Date().toISOString()): CachedAtlasMetadata {
  const sources = Array.from(new Set([
    ...summary.activities.map((activity) => activity.source),
    ...summary.sourceFiles.flatMap((file) => file.source === "strava" || file.source === "garmin" ? [file.source] : []),
  ])).sort() as Array<"strava" | "garmin">;
  let routeActivityCount = 0;
  let routePointCount = 0;
  summary.activities.forEach((activity) => {
    if (!activity.route?.length) return;
    routeActivityCount += 1;
    routePointCount += activity.route.length;
  });
  return {
    key: LOCAL_CACHE_KEY,
    schemaVersion: LOCAL_CACHE_SCHEMA_VERSION,
    savedAt,
    importedAt: summary.importedAt,
    startDate: summary.startDate,
    endDate: summary.endDate,
    activityCount: summary.activities.length,
    wellnessDayCount: summary.wellness.length,
    routeActivityCount,
    routePointCount,
    sources,
  };
}

export async function requestPersistentLocalStorage(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function getCachedAtlasMetadata(): Promise<CachedAtlasMetadata | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(METADATA_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(METADATA_STORE).get(LOCAL_CACHE_KEY));
    return validMetadata(value) ? value : null;
  } finally {
    database.close();
  }
}

export async function saveCachedAtlas(summary: ImportSummary): Promise<CachedAtlasMetadata> {
  const database = await openDatabase();
  const metadata = buildCachedAtlasMetadata(summary);
  try {
    const transaction = database.transaction([SUMMARY_STORE, METADATA_STORE], "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(SUMMARY_STORE).put({ key: LOCAL_CACHE_KEY, schemaVersion: LOCAL_CACHE_SCHEMA_VERSION, summary } satisfies CachedAtlasRecord);
    transaction.objectStore(METADATA_STORE).put(metadata);
    await completed;
    return metadata;
  } finally {
    database.close();
  }
}

export async function loadCachedAtlas(): Promise<ImportSummary | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUMMARY_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(SUMMARY_STORE).get(LOCAL_CACHE_KEY)) as CachedAtlasRecord | undefined;
    if (!value || value.schemaVersion !== LOCAL_CACHE_SCHEMA_VERSION || !validSummary(value.summary)) return null;
    return value.summary;
  } finally {
    database.close();
  }
}

export async function deleteCachedAtlas(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const database = await openDatabase();
  try {
    const transaction = database.transaction([SUMMARY_STORE, METADATA_STORE], "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(SUMMARY_STORE).delete(LOCAL_CACHE_KEY);
    transaction.objectStore(METADATA_STORE).delete(LOCAL_CACHE_KEY);
    await completed;
  } finally {
    database.close();
  }
}

export function localCacheErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "QuotaExceededError") return "브라우저의 기기 저장 공간이 부족합니다. 기존 Atlas를 삭제하거나 브라우저 저장 공간을 확보해 주세요.";
  return error instanceof Error ? error.message : "기기 저장을 완료하지 못했습니다.";
}
