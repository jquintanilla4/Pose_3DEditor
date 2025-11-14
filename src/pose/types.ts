export type PoseModelKind = "vitpose" | "dwpose";
export type BodyProfile = "vitpose_body_17" | "vitpose_wholebody_133" | "dwpose_body_25";
export type VitPoseVariant = "base-simple" | "l-wholebody" | "l-wholebody-onnx";

export type PoseProcessorOptions = {
  backend?: "hf" | "mmpose";
  model: PoseModelKind;
  vitposeVariant?: VitPoseVariant;
  device?: "cpu" | "cuda";
  fps?: number;
  resizeWidth?: number | null;
  resizeHeight?: number | null;
  personMode?: "single" | "multi";
  includeHands?: boolean;
  includeFace?: boolean;
  smooth?: { type: "oneEuro" | "savgol"; strength: number };
  lift3D?: false | { model: "videopose3d"; receptiveFrames?: number; scaleToRig?: boolean };
};

export type Keypoint2D = { x: number; y: number; c: number };
export type FrameKeypoints2D = {
  frame: number;
  time: number;
  persons: Array<Record<string, Keypoint2D>>;
};

export type Keypoint3D = { x: number; y: number; z: number; c: number };
export type FrameKeypoints3D = {
  frame: number;
  persons: Array<Record<string, Keypoint3D>>;
};

export type PoseProcessResult = {
  meta: {
    source: { width: number; height: number; fps: number; frames: number; duration: number };
    effectiveFps: number;
    model: PoseModelKind;
    bodyProfile: BodyProfile;
    mapping: Record<string, string>;
  };
  kpts2d: FrameKeypoints2D[];
  kpts3d?: FrameKeypoints3D[];
};

export type PoseProcessSummary = {
  frames: number;
  persons: number;
  has3D: boolean;
};

export type ExportSkeletonPayload = {
  width: number;
  height: number;
  fps: number;
  bones: string[][];
  frames: FrameKeypoints2D[];
  outPath: string;
  skeletonOnly?: boolean;
};
