import type { RigProfile, RigProfileId, Vec3 } from "./types";

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const vitpose: RigProfile = {
  id: "vitpose_body_17",
  label: "ViTPose Body 17",
  joints: [
    { id: "pelvis", name: "Pelvis" },
    { id: "spine", name: "Spine" },
    { id: "neck", name: "Neck" },
    { id: "head", name: "Head" },
    { id: "nose", name: "Nose" },
    { id: "left_hip", name: "Left Hip" },
    { id: "right_hip", name: "Right Hip" },
    { id: "left_knee", name: "Left Knee" },
    { id: "right_knee", name: "Right Knee" },
    { id: "left_ankle", name: "Left Ankle" },
    { id: "right_ankle", name: "Right Ankle" },
    { id: "left_shoulder", name: "Left Shoulder" },
    { id: "right_shoulder", name: "Right Shoulder" },
    { id: "left_elbow", name: "Left Elbow" },
    { id: "right_elbow", name: "Right Elbow" },
    { id: "left_wrist", name: "Left Wrist" },
    { id: "right_wrist", name: "Right Wrist" }
  ],
  bones: [
    ["pelvis", "spine"],
    ["spine", "neck"],
    ["neck", "head"],
    ["head", "nose"],
    ["pelvis", "left_hip"],
    ["left_hip", "left_knee"],
    ["left_knee", "left_ankle"],
    ["pelvis", "right_hip"],
    ["right_hip", "right_knee"],
    ["right_knee", "right_ankle"],
    ["neck", "left_shoulder"],
    ["left_shoulder", "left_elbow"],
    ["left_elbow", "left_wrist"],
    ["neck", "right_shoulder"],
    ["right_shoulder", "right_elbow"],
    ["right_elbow", "right_wrist"]
  ],
  groups: {
    Head: { label: "Head", joints: ["neck", "head", "nose"] },
    Torso: { label: "Torso", joints: ["pelvis", "spine", "neck"] },
    LeftArm: { label: "Left Arm", joints: ["left_shoulder", "left_elbow", "left_wrist"] },
    RightArm: { label: "Right Arm", joints: ["right_shoulder", "right_elbow", "right_wrist"] },
    LeftLeg: { label: "Left Leg", joints: ["left_hip", "left_knee", "left_ankle"] },
    RightLeg: { label: "Right Leg", joints: ["right_hip", "right_knee", "right_ankle"] },
    Hands: { label: "Hands", joints: ["left_wrist", "right_wrist"] }
  },
  restPose: {
    pelvis: v(0, 1, 0),
    spine: v(0, 1.25, 0),
    neck: v(0, 1.5, 0),
    head: v(0, 1.7, 0),
    nose: v(0, 1.75, 0.05),
    left_hip: v(-0.18, 1, 0.03),
    right_hip: v(0.18, 1, -0.03),
    left_knee: v(-0.18, 0.6, 0.02),
    right_knee: v(0.18, 0.6, -0.02),
    left_ankle: v(-0.18, 0.1, 0.06),
    right_ankle: v(0.18, 0.1, -0.06),
    left_shoulder: v(-0.25, 1.45, 0.02),
    right_shoulder: v(0.25, 1.45, -0.02),
    left_elbow: v(-0.55, 1.2, 0.02),
    right_elbow: v(0.55, 1.2, -0.02),
    left_wrist: v(-0.75, 0.95, 0.05),
    right_wrist: v(0.75, 0.95, -0.05)
  }
};

const dwpose: RigProfile = {
  id: "dwpose_body_25",
  label: "DWPose Body 25",
  joints: [
    { id: "nose", name: "Nose" },
    { id: "neck", name: "Neck" },
    { id: "right_shoulder", name: "Right Shoulder" },
    { id: "right_elbow", name: "Right Elbow" },
    { id: "right_wrist", name: "Right Wrist" },
    { id: "left_shoulder", name: "Left Shoulder" },
    { id: "left_elbow", name: "Left Elbow" },
    { id: "left_wrist", name: "Left Wrist" },
    { id: "mid_hip", name: "Mid Hip" },
    { id: "right_hip", name: "Right Hip" },
    { id: "right_knee", name: "Right Knee" },
    { id: "right_ankle", name: "Right Ankle" },
    { id: "left_hip", name: "Left Hip" },
    { id: "left_knee", name: "Left Knee" },
    { id: "left_ankle", name: "Left Ankle" },
    { id: "right_eye", name: "Right Eye" },
    { id: "left_eye", name: "Left Eye" },
    { id: "right_ear", name: "Right Ear" },
    { id: "left_ear", name: "Left Ear" },
    { id: "left_big_toe", name: "Left Big Toe" },
    { id: "left_small_toe", name: "Left Small Toe" },
    { id: "left_heel", name: "Left Heel" },
    { id: "right_big_toe", name: "Right Big Toe" },
    { id: "right_small_toe", name: "Right Small Toe" },
    { id: "right_heel", name: "Right Heel" }
  ],
  bones: [
    ["neck", "nose"],
    ["neck", "right_shoulder"],
    ["right_shoulder", "right_elbow"],
    ["right_elbow", "right_wrist"],
    ["neck", "left_shoulder"],
    ["left_shoulder", "left_elbow"],
    ["left_elbow", "left_wrist"],
    ["neck", "mid_hip"],
    ["mid_hip", "right_hip"],
    ["right_hip", "right_knee"],
    ["right_knee", "right_ankle"],
    ["mid_hip", "left_hip"],
    ["left_hip", "left_knee"],
    ["left_knee", "left_ankle"],
    ["nose", "right_eye"],
    ["nose", "left_eye"],
    ["right_eye", "right_ear"],
    ["left_eye", "left_ear"],
    ["left_ankle", "left_big_toe"],
    ["left_big_toe", "left_small_toe"],
    ["left_ankle", "left_heel"],
    ["right_ankle", "right_big_toe"],
    ["right_big_toe", "right_small_toe"],
    ["right_ankle", "right_heel"]
  ],
  groups: {
    Head: { label: "Head", joints: ["neck", "nose", "left_eye", "right_eye", "left_ear", "right_ear"] },
    Torso: { label: "Torso", joints: ["neck", "mid_hip", "left_hip", "right_hip"] },
    LeftArm: { label: "Left Arm", joints: ["left_shoulder", "left_elbow", "left_wrist"] },
    RightArm: { label: "Right Arm", joints: ["right_shoulder", "right_elbow", "right_wrist"] },
    LeftLeg: { label: "Left Leg", joints: ["left_hip", "left_knee", "left_ankle", "left_big_toe", "left_small_toe", "left_heel"] },
    RightLeg: { label: "Right Leg", joints: ["right_hip", "right_knee", "right_ankle", "right_big_toe", "right_small_toe", "right_heel"] },
    Hands: { label: "Hands", joints: ["left_wrist", "right_wrist"] }
  },
  restPose: {
    nose: v(0, 1.77, 0.05),
    neck: v(0, 1.55, 0),
    right_shoulder: v(0.28, 1.5, -0.02),
    right_elbow: v(0.65, 1.25, 0.02),
    right_wrist: v(0.85, 1, 0.05),
    left_shoulder: v(-0.28, 1.5, 0.02),
    left_elbow: v(-0.65, 1.25, -0.02),
    left_wrist: v(-0.85, 1, 0.05),
    mid_hip: v(0, 1.05, 0),
    right_hip: v(0.22, 1, -0.02),
    right_knee: v(0.22, 0.62, -0.02),
    right_ankle: v(0.22, 0.15, -0.05),
    left_hip: v(-0.22, 1, 0.02),
    left_knee: v(-0.22, 0.62, 0.02),
    left_ankle: v(-0.22, 0.15, 0.05),
    right_eye: v(0.05, 1.8, 0.06),
    left_eye: v(-0.05, 1.8, 0.06),
    right_ear: v(0.15, 1.72, 0),
    left_ear: v(-0.15, 1.72, 0),
    left_big_toe: v(-0.22, 0.03, 0.2),
    left_small_toe: v(-0.12, 0.02, 0.18),
    left_heel: v(-0.22, 0.1, -0.02),
    right_big_toe: v(0.22, 0.03, 0.2),
    right_small_toe: v(0.12, 0.02, 0.18),
    right_heel: v(0.22, 0.1, -0.02)
  }
};

export const RIG_PROFILES: Record<RigProfileId, RigProfile> = {
  vitpose_body_17: vitpose,
  dwpose_body_25: dwpose
};

export const DEFAULT_PROFILE_ID: RigProfileId = "vitpose_body_17";

export function getProfile(id: RigProfileId): RigProfile {
  return RIG_PROFILES[id] ?? vitpose;
}
