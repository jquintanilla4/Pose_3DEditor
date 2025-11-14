import type { RigJointDef, RigProfile, RigProfileId, Vec3 } from "./types";

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

const vitposeWholebody: RigProfile = (() => {
  const cloneVec = (vec: Vec3): Vec3 => v(vec.x, vec.y, vec.z);
  const joints: RigJointDef[] = vitpose.joints.map((joint) => ({ ...joint }));
  const restPose: Record<string, Vec3> = {};
  Object.entries(vitpose.restPose).forEach(([id, vec]) => {
    restPose[id] = cloneVec(vec);
  });
  const bones: [string, string][] = vitpose.bones.map(([a, b]) => [a, b]);

  const addJoint = (id: string, name: string, pos: Vec3) => {
    if (!restPose[id]) {
      joints.push({ id, name });
    }
    restPose[id] = pos;
  };

  const addBone = (a: string, b: string) => {
    bones.push([a, b]);
  };

  const connectChain = (ids: string[], closed = false) => {
    for (let i = 0; i < ids.length - 1; i += 1) {
      addBone(ids[i], ids[i + 1]);
    }
    if (closed && ids.length > 2) {
      addBone(ids[ids.length - 1], ids[0]);
    }
  };

  const footJoints: Array<[string, string, Vec3]> = [
    ["left_big_toe", "Left Big Toe", v(-0.22, 0.03, 0.2)],
    ["left_small_toe", "Left Small Toe", v(-0.12, 0.02, 0.18)],
    ["left_heel", "Left Heel", v(-0.22, 0.1, -0.02)],
    ["right_big_toe", "Right Big Toe", v(0.22, 0.03, 0.2)],
    ["right_small_toe", "Right Small Toe", v(0.12, 0.02, 0.18)],
    ["right_heel", "Right Heel", v(0.22, 0.1, -0.02)]
  ];
  footJoints.forEach(([id, name, pos]) => addJoint(id, name, pos));
  addBone("left_ankle", "left_big_toe");
  addBone("left_big_toe", "left_small_toe");
  addBone("left_ankle", "left_heel");
  addBone("right_ankle", "right_big_toe");
  addBone("right_big_toe", "right_small_toe");
  addBone("right_ankle", "right_heel");

  const handFingerDefs: Array<{ key: string; offsetY: number }> = [
    { key: "thumb", offsetY: -0.03 },
    { key: "index", offsetY: 0.0 },
    { key: "middle", offsetY: 0.005 },
    { key: "ring", offsetY: -0.005 },
    { key: "pinky", offsetY: -0.015 }
  ];

  const buildHand = (side: "left" | "right"): string[] => {
    const ids: string[] = [];
    const wristId = `${side}_wrist`;
    const wrist = restPose[wristId];
    if (!wrist) {
      return ids;
    }
    ids.push(wristId);
    const dir = side === "left" ? -1 : 1;
    const niceSide = side === "left" ? "Left" : "Right";
    const palmId = `${side}_palm`;
    const palmPos = v(wrist.x + dir * 0.08, wrist.y - 0.02, wrist.z);
    addJoint(palmId, `${niceSide} Palm`, palmPos);
    addBone(wristId, palmId);
    ids.push(palmId);
    handFingerDefs.forEach((finger, idx) => {
      let prev = palmId;
      for (let seg = 1; seg <= 4; seg += 1) {
        const jointId = `${side}_${finger.key}${seg}`;
        const prettyName = `${niceSide} ${finger.key.charAt(0).toUpperCase() + finger.key.slice(1)} ${seg}`;
        const spread = (idx - 2) * 0.015;
        const pos = v(
          palmPos.x + dir * (0.045 * seg + 0.025 * idx),
          palmPos.y + finger.offsetY + 0.025 * seg + spread,
          palmPos.z
        );
        addJoint(jointId, prettyName, pos);
        ids.push(jointId);
        addBone(prev, jointId);
        prev = jointId;
      }
    });
    return ids;
  };

  const leftHandJoints = buildHand("left");
  const rightHandJoints = buildHand("right");

  const headCenter = v(0, 1.7, 0);
  const faceDepth = 0.02;

  const addFaceChain = (
    baseId: string,
    label: string,
    count: number,
    position: (idx: number) => Vec3,
    closed = false
  ): string[] => {
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = `${baseId}${i}`;
      addJoint(id, `${label} ${i}`, position(i));
      ids.push(id);
    }
    connectChain(ids, closed);
    return ids;
  };

  const faceContourIds = addFaceChain("face_contour", "Face Contour", 17, (i) => {
    const t = i / 16;
    const angle = Math.PI + Math.PI * t;
    return v(headCenter.x + Math.cos(angle) * 0.18, headCenter.y + Math.sin(angle) * 0.22 - 0.05, faceDepth);
  });

  const rightEyebrowIds = addFaceChain("right_eyebrow", "Right Eyebrow", 5, (i) =>
    v(0.06 - i * 0.02, headCenter.y + 0.11 + (i === 2 ? 0.01 : 0), faceDepth)
  );
  const leftEyebrowIds = addFaceChain("left_eyebrow", "Left Eyebrow", 5, (i) =>
    v(-0.06 + i * 0.02, headCenter.y + 0.11 + (i === 2 ? 0.01 : 0), faceDepth)
  );

  const noseBridgeIds = addFaceChain("nose_bridge", "Nose Bridge", 4, (i) => v(0, headCenter.y + 0.07 - 0.03 * i, faceDepth));
  const noseLowerIds = addFaceChain("nose_lower", "Nose Base", 5, (i) => {
    const offset = i - 2;
    return v(offset * 0.012, headCenter.y - 0.02 - Math.abs(offset) * 0.004, faceDepth);
  });
  addBone(noseBridgeIds[noseBridgeIds.length - 1], noseLowerIds[Math.floor(noseLowerIds.length / 2)]);

  const ellipsePoint = (
    centerX: number,
    centerY: number,
    radiusX: number,
    radiusY: number,
    idx: number,
    total: number
  ) => {
    const angle = (Math.PI * 2 * idx) / total + Math.PI / 2;
    return v(centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY, faceDepth);
  };

  const rightEyeIds = addFaceChain(
    "right_eye",
    "Right Eye",
    6,
    (i) => ellipsePoint(0.04, headCenter.y + 0.07, 0.025, 0.012, i, 6),
    true
  );
  const leftEyeIds = addFaceChain(
    "left_eye",
    "Left Eye",
    6,
    (i) => ellipsePoint(-0.04, headCenter.y + 0.07, 0.025, 0.012, i, 6),
    true
  );

  const outerLipIds = addFaceChain(
    "outer_lip",
    "Outer Lip",
    12,
    (i) => ellipsePoint(0, headCenter.y - 0.09, 0.06, 0.028, i, 12),
    true
  );
  const innerLipIds = addFaceChain(
    "inner_lip",
    "Inner Lip",
    8,
    (i) => ellipsePoint(0, headCenter.y - 0.085, 0.035, 0.018, i, 8),
    true
  );

  const faceJointIds = [
    ...faceContourIds,
    ...rightEyebrowIds,
    ...leftEyebrowIds,
    ...noseBridgeIds,
    ...noseLowerIds,
    ...rightEyeIds,
    ...leftEyeIds,
    ...outerLipIds,
    ...innerLipIds
  ];
  const mouthJointIds = [...outerLipIds, ...innerLipIds];

  const groups: Record<string, { label?: string; joints: string[] }> = {};
  Object.entries(vitpose.groups).forEach(([key, group]) => {
    groups[key] = { label: group.label, joints: [...group.joints] };
  });
  groups.Hands = { label: "Hands", joints: [...leftHandJoints, ...rightHandJoints] };
  groups.LeftHand = { label: "Left Hand", joints: leftHandJoints };
  groups.RightHand = { label: "Right Hand", joints: rightHandJoints };
  groups.Face = { label: "Face", joints: faceJointIds };
  groups.Mouth = { label: "Mouth", joints: mouthJointIds };

  return {
    id: "vitpose_wholebody_133",
    label: "ViTPose WholeBody 133",
    joints,
    bones,
    groups,
    restPose
  };
})();

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
  vitpose_wholebody_133: vitposeWholebody,
  dwpose_body_25: dwpose
};

export const DEFAULT_PROFILE_ID: RigProfileId = "vitpose_body_17";

export function getProfile(id: RigProfileId): RigProfile {
  return RIG_PROFILES[id] ?? vitpose;
}
