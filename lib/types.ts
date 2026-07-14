export type MetricStatus =
  | "measured"
  | "derived"
  | "estimated"
  | "missing"
  | "not_applicable"
  | "invalid";

export interface MetricValue<T = number> {
  value: T | null;
  unit: string;
  status: MetricStatus;
  source: string;
  sourceFile: string;
  confidence: number;
  calculationVersion: string;
}

export interface RoutePoint {
  latitude: number;
  longitude: number;
  elevation?: number;
  timestamp?: string;
  heartRate?: number;
  power?: number;
  speed?: number;
}

export interface Activity {
  id: string;
  source: "strava" | "garmin";
  sourceFile: string;
  date: string;
  localDate: string;
  name: string;
  type: string;
  elapsedTime: MetricValue;
  movingTime: MetricValue;
  distance: MetricValue;
  calories: MetricValue;
  averageHeartRate: MetricValue;
  maxHeartRate: MetricValue;
  relativeEffort: MetricValue;
  averagePower: MetricValue;
  weightedAveragePower: MetricValue;
  maxPower: MetricValue;
  trainingLoad: MetricValue;
  intensity: MetricValue;
  filename?: string;
  route?: RoutePoint[];
  streamCount?: number;
}

export interface SleepSession {
  calendarDate: string;
  start?: string;
  end?: string;
  totalSeconds: MetricValue;
  deepSeconds: MetricValue;
  lightSeconds: MetricValue;
  remSeconds: MetricValue;
  awakeSeconds: MetricValue;
  score: MetricValue;
  recoveryScore: MetricValue;
  averageStress: MetricValue;
  respiration: MetricValue;
}

export interface DailyWellness {
  date: string;
  sleep?: SleepSession;
  hrv: MetricValue;
  restingHeartRate: MetricValue;
  bodyBatteryHigh: MetricValue;
  bodyBatteryLow: MetricValue;
  bodyBatteryCharged: MetricValue;
  bodyBatteryDrained: MetricValue;
  averageStress: MetricValue;
  skinTemperature: MetricValue;
  respiration: MetricValue;
  steps: MetricValue;
  activeCalories: MetricValue;
  hydration: MetricValue;
  sweatLoss: MetricValue;
}

export type CapabilityState = "available" | "partial" | "unavailable";

export interface Capability {
  key: string;
  label: string;
  state: CapabilityState;
  coverage: number;
  records: number;
  total: number;
  reason: string;
}

export interface CapabilityProfile {
  capabilities: Capability[];
  activeCount: number;
  partialCount: number;
  unavailableCount: number;
}

export interface DataQualityIssue {
  id: string;
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  sourceFile?: string;
  recoverable: boolean;
}

export interface SourceFileSummary {
  name: string;
  source: "strava" | "garmin" | "unknown";
  size: number;
  supported: boolean;
  skippedReason?: string;
}

export interface ActivityMatch {
  stravaId: string;
  garminId: string;
  confidence: number;
  status: "confirmed" | "probable" | "ambiguous" | "unmatched";
  evidence: string[];
}

export interface CorrelationResult {
  xKey: string;
  yKey: string;
  coefficient: number | null;
  sampleSize: number;
  missingRate: number;
  method: "pearson";
  direction: "positive" | "negative" | "neutral" | "insufficient";
  confidenceLow: number | null;
  confidenceHigh: number | null;
}

export interface ImportSummary {
  importedAt: string;
  startDate: string;
  endDate: string;
  activities: Activity[];
  wellness: DailyWellness[];
  sourceFiles: SourceFileSummary[];
  issues: DataQualityIssue[];
  matches: ActivityMatch[];
  capabilityProfile: CapabilityProfile;
  mediaSkipped: number;
  unsupportedSkipped: number;
  sourceHashes?: Record<string, string>;
}

export const CALCULATION_VERSION = "1.0.0";

export function metric(
  value: unknown,
  unit: string,
  source: string,
  sourceFile: string,
  status: MetricStatus = "measured",
  confidence = 1,
): MetricValue {
  const numeric = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "") {
    return missingMetric(unit, source, sourceFile);
  }
  if (!Number.isFinite(numeric)) {
    return {
      value: null,
      unit,
      status: "invalid",
      source,
      sourceFile,
      confidence: 0,
      calculationVersion: CALCULATION_VERSION,
    };
  }
  return {
    value: numeric,
    unit,
    status,
    source,
    sourceFile,
    confidence,
    calculationVersion: CALCULATION_VERSION,
  };
}

export function missingMetric(
  unit: string,
  source = "unavailable",
  sourceFile = "",
  status: MetricStatus = "missing",
): MetricValue {
  return {
    value: null,
    unit,
    status,
    source,
    sourceFile,
    confidence: 0,
    calculationVersion: CALCULATION_VERSION,
  };
}
