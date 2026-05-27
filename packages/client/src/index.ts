import type {
  DetectionResult,
  FrameFeatures,
  ImuSample,
  SessionOptions,
} from "@lumetriq/geometry-core";

export type GeometrySessionEvents = {
  features: FrameFeatures;
  imu: ImuSample[];
  result: DetectionResult[];
};

export interface GeometrySession {
  readonly options: SessionOptions;
  start(): Promise<void>;
  stop(): Promise<DetectionResult[]>;
}

/** Browser SDK entry point (stub). */
export function createGeometrySession(options: SessionOptions): GeometrySession {
  let running = false;

  return {
    options,
    async start() {
      if (running) return;
      running = true;
    },
    async stop() {
      running = false;
      return [];
    },
  };
}
