import { buildAtlasModel } from "./atlas";
import type { Activity, AtlasModel } from "./types";

interface AtlasWorkerRequest {
  requestId: number;
  activities: Activity[];
  maskPrivate: boolean;
}

interface AtlasWorkerResponse {
  requestId: number;
  atlas?: AtlasModel;
  error?: string;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<AtlasWorkerRequest>) => void) | null;
  postMessage: (response: AtlasWorkerResponse) => void;
};

workerScope.onmessage = (event) => {
  const { requestId, activities, maskPrivate } = event.data;
  try {
    workerScope.postMessage({ requestId, atlas: buildAtlasModel(activities, maskPrivate) });
  } catch (error) {
    workerScope.postMessage({ requestId, error: error instanceof Error ? error.message : "ATLAS_WORKER_FAILED" });
  }
};

export {};
