import type { Activity } from "./types";

export type ActivityGroup = "ride" | "run" | "walk" | "hike" | "other";
export type ActivityEnvironment = "outdoor" | "virtual" | "indoor";

export interface ActivityClassification {
  group: ActivityGroup;
  environment: ActivityEnvironment;
}

export function classifyActivity(activity: Pick<Activity, "type" | "name">): ActivityClassification {
  const type = activity.type.toLowerCase();
  const searchable = `${activity.type} ${activity.name}`.toLowerCase();
  const group: ActivityGroup = type.includes("ride") || type.includes("cycl") || type.includes("bike")
    ? "ride"
    : type.includes("run")
      ? "run"
      : type.includes("walk")
        ? "walk"
        : type.includes("hik") || type.includes("trek")
          ? "hike"
          : "other";
  const environment: ActivityEnvironment = /virtual|zwift|rouvy|tacx/.test(searchable)
    ? "virtual"
    : /indoor|trainer|treadmill/.test(searchable)
      ? "indoor"
      : "outdoor";
  return { group, environment };
}
