import { DEFAULT_PROFILE_ID, getProfile } from "./profiles";
import type { RigDefinition, RigProfile, RigProfileId, Vec3 } from "./types";

export type Ease = "linear" | "in" | "out" | "inOut";

export type Key<T = number> = {
  f: number;
  v: T;
  ease?: Ease;
};

export type KeyTrackFloat = { keys: Key<number>[] };
export type KeyTrackVec3 = { keysX: Key<number>[]; keysY: Key<number>[]; keysZ: Key<number>[] };
export type KeyTrackVec3Scale = KeyTrackVec3;
export type KeyTrackQuat = { keys: Key<[number, number, number, number]>[] };
export type KeyTrackBool = { keys: Key<0 | 1>[] };

export type RigRootTracks = {
  pos: KeyTrackVec3;
  rot: KeyTrackQuat;
  scale: KeyTrackVec3;
};

export type CameraTracks = {
  pos: KeyTrackVec3;
  target: KeyTrackVec3;
  fov: KeyTrackFloat;
};

export type VideoPlaneTracks = {
  enabled: boolean;
  transform: {
    pos: KeyTrackVec3;
    rot: KeyTrackQuat;
    scale: KeyTrackVec3;
  };
  timeOffset: KeyTrackFloat;
  lockToCamera: KeyTrackBool;
  mediaSrc?: string;
};

export type OutputGuides = {
  showImageGate: boolean;
  showThirds: boolean;
  showCenter: boolean;
  showActionSafe: boolean;
  showTitleSafe: boolean;
  actionSafePct: number;
  titleSafePct: number;
  customAspects: Array<{ label: string; width: number; height: number; enabled: boolean }>;
  opacity: number;
  color: string;
};

export type OutputSettings = {
  width: number;
  height: number;
  pixelAspect: number;
  renderScale: number;
  overscanPct: number;
  guides: OutputGuides;
};

export type TimelineSettings = {
  fps: number;
  frameCount: number;
};

export type EditorState = {
  rigProfileId: RigProfileId;
  rigDef: RigDefinition;
  restPose: Record<string, Vec3>;
  timeline: TimelineSettings;
  output: OutputSettings;
  anim: {
    rigRoot: RigRootTracks;
    groupScales: Record<string, KeyTrackVec3>;
    jointPositions: Record<string, KeyTrackVec3>;
    camera: CameraTracks;
    videoPlane: VideoPlaneTracks;
  };
  autoKey: boolean;
};

const cloneVec3 = (v: Vec3): Vec3 => ({ x: v.x, y: v.y, z: v.z });

const cloneGroups = (groups: Record<string, { joints: string[]; label?: string }>) => {
  const out: Record<string, { joints: string[]; label?: string }> = {};
  for (const key of Object.keys(groups)) {
    out[key] = { label: groups[key].label, joints: [...groups[key].joints] };
  }
  return out;
};

const cloneRestPose = (pose: Record<string, Vec3>): Record<string, Vec3> => {
  const out: Record<string, Vec3> = {};
  for (const key of Object.keys(pose)) {
    out[key] = cloneVec3(pose[key]);
  }
  return out;
};

const toRigDef = (profile: RigProfile): RigDefinition => {
  const defaultRest: Record<string, number> = {};
  for (const [a, b] of profile.bones) {
    const pa = profile.restPose[a];
    const pb = profile.restPose[b];
    if (!pa || !pb) continue;
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const dz = pb.z - pa.z;
    defaultRest[`${a}:${b}`] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return {
    joints: profile.joints.map((j) => ({ id: j.id, name: j.name })),
    bones: profile.bones.slice(),
    defaultRest,
    groups: cloneGroups(profile.groups)
  };
};

export const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

export const emptyVec3Track = (): KeyTrackVec3 => ({ keysX: [], keysY: [], keysZ: [] });
export const emptyQuatTrack = (): KeyTrackQuat => ({ keys: [] });
export const emptyFloatTrack = (): KeyTrackFloat => ({ keys: [] });
export const emptyBoolTrack = (): KeyTrackBool => ({ keys: [] });

const staticVec3Track = (value: Vec3): KeyTrackVec3 => ({
  keysX: [{ f: 0, v: value.x }],
  keysY: [{ f: 0, v: value.y }],
  keysZ: [{ f: 0, v: value.z }]
});

const staticQuatTrack = (value: [number, number, number, number]): KeyTrackQuat => ({
  keys: [{ f: 0, v: value }]
});

const staticFloatTrack = (value: number): KeyTrackFloat => ({
  keys: [{ f: 0, v: value }]
});

const staticBoolTrack = (value: boolean): KeyTrackBool => ({
  keys: [{ f: 0, v: value ? 1 : 0 }]
});

export const createEditorState = (profileId: RigProfileId = DEFAULT_PROFILE_ID): EditorState => {
  const profile = getProfile(profileId);
  const rigDef = toRigDef(profile);
  const output: OutputSettings = {
    width: 1920,
    height: 1080,
    pixelAspect: 1,
    renderScale: 1,
    overscanPct: 0,
    guides: {
      showImageGate: true,
      showThirds: true,
      showCenter: true,
      showActionSafe: true,
      showTitleSafe: false,
      actionSafePct: 5,
      titleSafePct: 10,
      customAspects: [],
      opacity: 0.9,
      color: "#ffffff"
    }
  };

  const groupScales: Record<string, KeyTrackVec3> = {};
  for (const groupId of Object.keys(rigDef.groups)) {
    groupScales[groupId] = staticVec3Track(vec3(1, 1, 1));
  }

  return {
    rigProfileId: profile.id,
    rigDef,
    restPose: cloneRestPose(profile.restPose),
    timeline: { fps: 24, frameCount: 240 },
    output,
    anim: {
      rigRoot: {
        pos: staticVec3Track(vec3(0, 0.9, 0)),
        rot: staticQuatTrack([0, 0, 0, 1]),
        scale: staticVec3Track(vec3(1, 1, 1))
      },
      groupScales,
      jointPositions: {},
      camera: {
        pos: staticVec3Track(vec3(3.5, 2.5, 4.2)),
        target: staticVec3Track(vec3(0, 1.1, 0)),
        fov: staticFloatTrack(50)
      },
      videoPlane: {
        enabled: false,
        mediaSrc: undefined,
        transform: {
          pos: staticVec3Track(vec3(0, 1.2, -1)),
          rot: staticQuatTrack([0, 0, 0, 1]),
          scale: staticVec3Track(vec3(2, 2, 1))
        },
        timeOffset: staticFloatTrack(0),
        lockToCamera: staticBoolTrack(false)
      }
    },
    autoKey: true
  };
};

const ensureSorted = <T>(keys: Key<T>[]) => keys.sort((a, b) => a.f - b.f);

const upsertKey = <T>(keys: Key<T>[], frame: number, value: T, ease?: Ease) => {
  const existing = keys.find((k) => k.f === frame);
  if (existing) {
    existing.v = value;
    if (ease) existing.ease = ease;
    return;
  }
  keys.push({ f: frame, v: value, ease });
  ensureSorted(keys);
};

export const setVec3Key = (track: KeyTrackVec3, frame: number, value: Vec3) => {
  upsertKey(track.keysX, frame, value.x);
  upsertKey(track.keysY, frame, value.y);
  upsertKey(track.keysZ, frame, value.z);
};

export const setFloatKey = (track: KeyTrackFloat, frame: number, value: number) => {
  upsertKey(track.keys, frame, value);
};

export const setQuatKey = (track: KeyTrackQuat, frame: number, value: [number, number, number, number]) => {
  upsertKey(track.keys, frame, value);
};

export const setBoolKey = (track: KeyTrackBool, frame: number, value: boolean) => {
  upsertKey(track.keys, frame, value ? 1 : 0);
};

const applyEase = (t: number, ease?: Ease) => {
  switch (ease) {
    case "in":
      return t * t;
    case "out":
      return t * (2 - t);
    case "inOut":
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    default:
      return t;
  }
};

const sampleNumber = (keys: Key<number>[], frame: number): number | undefined => {
  if (!keys.length) return undefined;
  if (frame <= keys[0].f) return keys[0].v;
  if (frame >= keys[keys.length - 1].f) return keys[keys.length - 1].v;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.f && frame <= b.f) {
      const span = b.f - a.f || 1;
      const t = (frame - a.f) / span;
      const eased = applyEase(t, a.ease);
      return a.v + (b.v - a.v) * eased;
    }
  }
  return keys[keys.length - 1].v;
};

export const sampleVec3 = (track: KeyTrackVec3, frame: number, fallback?: Vec3): Vec3 | undefined => {
  const x = sampleNumber(track.keysX, frame) ?? fallback?.x;
  const y = sampleNumber(track.keysY, frame) ?? fallback?.y;
  const z = sampleNumber(track.keysZ, frame) ?? fallback?.z;
  if (x === undefined || y === undefined || z === undefined) return fallback ? cloneVec3(fallback) : undefined;
  return { x, y, z };
};

const normalizeQuat = (q: [number, number, number, number]): [number, number, number, number] => {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
};

const slerpQuat = (
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number
): [number, number, number, number] => {
  let cosHalfTheta = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  if (cosHalfTheta < 0) {
    b = [-b[0], -b[1], -b[2], -b[3]];
    cosHalfTheta = -cosHalfTheta;
  }
  if (Math.abs(cosHalfTheta) >= 1.0) {
    return normalizeQuat(a);
  }
  const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
  if (Math.abs(sinHalfTheta) < 0.001) {
    return normalizeQuat([
      a[0] * 0.5 + b[0] * 0.5,
      a[1] * 0.5 + b[1] * 0.5,
      a[2] * 0.5 + b[2] * 0.5,
      a[3] * 0.5 + b[3] * 0.5
    ]);
  }
  const halfTheta = Math.acos(cosHalfTheta);
  const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
  const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
  return [
    a[0] * ratioA + b[0] * ratioB,
    a[1] * ratioA + b[1] * ratioB,
    a[2] * ratioA + b[2] * ratioB,
    a[3] * ratioA + b[3] * ratioB
  ];
};

export const sampleQuat = (track: KeyTrackQuat, frame: number): [number, number, number, number] | undefined => {
  const keys = track.keys;
  if (!keys.length) return undefined;
  if (frame <= keys[0].f) return normalizeQuat(keys[0].v);
  if (frame >= keys[keys.length - 1].f) return normalizeQuat(keys[keys.length - 1].v);
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.f && frame <= b.f) {
      const span = b.f - a.f || 1;
      const t = (frame - a.f) / span;
      const eased = applyEase(t, a.ease);
      return normalizeQuat(slerpQuat(a.v, b.v, eased));
    }
  }
  return normalizeQuat(keys[keys.length - 1].v);
};

export const sampleFloat = (track: KeyTrackFloat, frame: number, fallback?: number): number | undefined => {
  return sampleNumber(track.keys, frame) ?? fallback;
};

export const sampleBool = (track: KeyTrackBool, frame: number, fallback?: boolean): boolean | undefined => {
  const v = sampleNumber(track.keys, frame);
  if (v === undefined) return fallback;
  return v >= 0.5;
};

export const clonePose = (pose: Record<string, Vec3>): Record<string, Vec3> => {
  const next: Record<string, Vec3> = {};
  for (const key of Object.keys(pose)) {
    next[key] = cloneVec3(pose[key]);
  }
  return next;
};

export const getJointTrack = (state: EditorState, jointId: string): KeyTrackVec3 => {
  if (!state.anim.jointPositions[jointId]) {
    state.anim.jointPositions[jointId] = emptyVec3Track();
  }
  return state.anim.jointPositions[jointId];
};

export const getGroupScaleTrack = (state: EditorState, groupId: string): KeyTrackVec3 => {
  if (!state.anim.groupScales[groupId]) {
    state.anim.groupScales[groupId] = staticVec3Track(vec3(1, 1, 1));
  }
  return state.anim.groupScales[groupId];
};
