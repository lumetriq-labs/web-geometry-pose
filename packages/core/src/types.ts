export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  score: number;
}

export interface Keypoint {
  x: number;
  y: number;
  score: number;
}

export interface ImuSample {
  timestamp: number;
  gyro: Vec3;
  accel: Vec3;
}

export interface EdgeGraphEdge {
  a: Vec3;
  b: Vec3;
  weight?: number;
  tag?: string;
}

export interface ShapeModel {
  id: string;
  type: "edge-graph" | "glb" | "obj";
  edges?: EdgeGraphEdge[];
  requiredTags?: string[];
  assetUrl?: string;
}

export interface FrameFeatures {
  timestamp: number;
  lines: LineSegment[];
  keypoints: Keypoint[];
  frameSize?: { width: number; height: number };
}

export interface Pose {
  translation: Vec3;
  rotation: Quat;
}

export interface DetectionResult {
  shapeId: string;
  confidence: number;
  imagePoint: { x: number; y: number };
  pose: Pose;
}

export interface SessionOptions {
  shapeModel: ShapeModel;
  need3D?: boolean;
  calibration?: boolean;
}

export interface PoseEstimateInput {
  options: SessionOptions;
  frame: FrameFeatures;
  previous?: DetectionResult;
}
