import type {
  DetectionResult,
  FrameFeatures,
  ImuSample,
  SessionOptions,
} from "@lumetriq/geometry-core";
import { estimatePose } from "@lumetriq/geometry-core";

export type GeometrySessionEvents = {
  features: FrameFeatures;
  imu: ImuSample[];
  result: DetectionResult[];
};

export interface GeometrySession {
  readonly options: SessionOptions;
  start(): Promise<void>;
  ingestFrame(features: FrameFeatures): DetectionResult[];
  ingestImu(samples: ImuSample[]): void;
  getResults(): DetectionResult[];
  stop(): Promise<DetectionResult[]>;
}

/** Browser SDK entry point with minimal local estimator. */
export function createGeometrySession(options: SessionOptions): GeometrySession {
  let running = false;
  let previous: DetectionResult | undefined;
  const imuBuffer: ImuSample[] = [];
  const results: DetectionResult[] = [];

  return {
    options,
    async start() {
      if (running) return;
      running = true;
    },
    ingestFrame(features) {
      if (!running) return [];
      const next = estimatePose({ options, frame: features, previous });
      if (next.length > 0) {
        previous = next[0];
        results.push(...next);
      }
      return next;
    },
    ingestImu(samples) {
      if (!running || samples.length === 0) return;
      imuBuffer.push(...samples);
      if (imuBuffer.length > 240) {
        imuBuffer.splice(0, imuBuffer.length - 240);
      }
    },
    getResults() {
      return [...results];
    },
    async stop() {
      running = false;
      return [...results];
    },
  };
}
