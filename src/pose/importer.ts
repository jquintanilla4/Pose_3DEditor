import type { EditorState } from "../state";
import { getJointTrack, setVec3Key } from "../state";
import type { Vec3 } from "../types";
import type { FrameKeypoints2D, FrameKeypoints3D, PoseProcessResult } from "./types";

export type InsertPoseOptions = {
  startFrame?: number;
  use3D?: boolean;
  clearExisting?: boolean;
  autoFitTimeline?: boolean;
};

export type InsertPoseStats = {
  framesApplied: number;
  jointsApplied: number;
};

type Bounds = { cx: number; cy: number; halfX: number; halfY: number };

type JointFrame = Record<string, Vec3>;

const toSnakeCase = (id: string): string => {
  if (!id) return id;
  if (id.includes("_")) return id;
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
};

const getBounds = (restPose: Record<string, Vec3>): Bounds => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const joint of Object.values(restPose)) {
    minX = Math.min(minX, joint.x);
    maxX = Math.max(maxX, joint.x);
    minY = Math.min(minY, joint.y);
    maxY = Math.max(maxY, joint.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || minX === maxX) {
    minX = -1;
    maxX = 1;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY) || minY === maxY) {
    minY = 0;
    maxY = 2;
  }
  return {
    cx: (minX + maxX) * 0.5,
    cy: (minY + maxY) * 0.5,
    halfX: Math.max(0.1, (maxX - minX) * 0.5),
    halfY: Math.max(0.1, (maxY - minY) * 0.5)
  };
};

const normalizedToWorld = (nx: number, ny: number, nz: number | undefined, bounds: Bounds): Vec3 => {
  const x = bounds.cx + nx * bounds.halfX;
  const y = bounds.cy + ny * bounds.halfY;
  const z = nz !== undefined ? nz * bounds.halfY : 0;
  return { x, y, z };
};

const deriveViTPoseTorso = (pose: JointFrame) => {
  const leftHip = pose["left_hip"];
  const rightHip = pose["right_hip"];
  const leftShoulder = pose["left_shoulder"];
  const rightShoulder = pose["right_shoulder"];
  const nose = pose["nose"];

  if (leftHip && rightHip && !pose["pelvis"]) {
    pose["pelvis"] = {
      x: (leftHip.x + rightHip.x) * 0.5,
      y: (leftHip.y + rightHip.y) * 0.5,
      z: (leftHip.z + rightHip.z) * 0.5
    };
  }
  if (leftShoulder && rightShoulder && !pose["neck"]) {
    pose["neck"] = {
      x: (leftShoulder.x + rightShoulder.x) * 0.5,
      y: (leftShoulder.y + rightShoulder.y) * 0.5,
      z: (leftShoulder.z + rightShoulder.z) * 0.5
    };
  }
  if (pose["pelvis"] && pose["neck"] && !pose["spine"]) {
    pose["spine"] = {
      x: (pose["pelvis"].x + pose["neck"].x) * 0.5,
      y: (pose["pelvis"].y + pose["neck"].y) * 0.5,
      z: (pose["pelvis"].z + pose["neck"].z) * 0.5
    };
  }
  if (nose && !pose["head"] && pose["neck"]) {
    const dirY = Math.max(0.1, nose.y - pose["neck"].y);
    pose["head"] = { x: nose.x, y: nose.y + dirY * 0.25, z: nose.z };
  }
};

const deriveMissingJoints = (pose: JointFrame, profile: string) => {
  if (profile === "vitpose_body_17" || profile === "vitpose_wholebody_133") {
    deriveViTPoseTorso(pose);
  }
};

const extractFrame = (
  frame: FrameKeypoints2D | FrameKeypoints3D,
  bounds: Bounds,
  use3D: boolean
): JointFrame => {
  const person = frame.persons?.[0];
  if (!person) return {};
  const joints: JointFrame = {};
  for (const [jointId, raw] of Object.entries(person)) {
    const targetId = toSnakeCase(jointId);
    const nx = (raw as any).x ?? 0;
    const ny = (raw as any).y ?? 0;
    const nz = use3D ? (raw as any).z ?? 0 : undefined;
    joints[targetId] = normalizedToWorld(nx, ny, nz, bounds);
  }
  return joints;
};

export function applyPoseResultToState(
  state: EditorState,
  result: PoseProcessResult,
  options: InsertPoseOptions = {}
): InsertPoseStats {
  const prefer3D = options.use3D ?? Boolean(result.kpts3d?.length);
  const frames = prefer3D && result.kpts3d?.length ? result.kpts3d : result.kpts2d;
  if (!frames?.length) {
    return { framesApplied: 0, jointsApplied: 0 };
  }
  if (options.clearExisting) {
    state.anim.jointPositions = {};
  }
  const bounds = getBounds(state.restPose);
  const startFrame = options.startFrame ?? 0;
  const applied: InsertPoseStats = { framesApplied: 0, jointsApplied: 0 };

  const use3D = prefer3D && Boolean(result.kpts3d?.length);
  for (const frame of frames) {
    const pose = extractFrame(frame, bounds, use3D);
    deriveMissingJoints(pose, result.meta.bodyProfile);
    const frameIndex = startFrame + frame.frame;
    Object.entries(pose).forEach(([jointId, value]) => {
      if (!state.restPose[jointId]) return;
      const track = getJointTrack(state, jointId);
      setVec3Key(track, frameIndex, value);
      applied.jointsApplied += 1;
    });
    applied.framesApplied += 1;
  }

  if (options.autoFitTimeline) {
    const duration = frames[frames.length - 1].frame + 1;
    state.timeline.frameCount = Math.max(state.timeline.frameCount, startFrame + duration);
    state.timeline.fps = Math.round(result.meta.effectiveFps) || state.timeline.fps;
  }

  return applied;
}
