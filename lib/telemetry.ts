export type TelemetryEvent =
  | "import_started"
  | "import_completed"
  | "import_failed"
  | "atlas_ready"
  | "atlas_mode_used"
  | "poster_exported";

type SafeProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    plausible?: (event: string, options?: { props?: SafeProps; interactive?: boolean }) => void;
  }
}

const EVENT_NAMES: Record<TelemetryEvent, string> = {
  import_started: "Import Started",
  import_completed: "Import Completed",
  import_failed: "Import Failed",
  atlas_ready: "Atlas Ready",
  atlas_mode_used: "Atlas Mode Used",
  poster_exported: "Poster Exported",
};

export function telemetryEnabled(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PLAUSIBLE_SCRIPT_URL || process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN);
}

export function sizeBucket(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 100) return "under_100mb";
  if (mb < 500) return "100_500mb";
  if (mb < 2_000) return "500mb_2gb";
  return "over_2gb";
}

export function durationBucket(seconds: number): string {
  if (seconds < 15) return "under_15s";
  if (seconds < 60) return "15_60s";
  if (seconds < 180) return "1_3m";
  if (seconds < 600) return "3_10m";
  return "over_10m";
}

export function countBucket(count: number): string {
  if (count < 10) return "under_10";
  if (count < 100) return "10_99";
  if (count < 1_000) return "100_999";
  return "over_1000";
}

export function trackEvent(event: TelemetryEvent, props?: SafeProps): void {
  if (typeof window === "undefined" || !telemetryEnabled() || !window.plausible) return;
  window.plausible(EVENT_NAMES[event], { props, interactive: event !== "atlas_ready" });
}
