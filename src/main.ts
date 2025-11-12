import "./style.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { TransformControlsEventMap } from "three/examples/jsm/controls/TransformControls.js";
import { DEFAULT_PROFILE_ID, RIG_PROFILES, getProfile } from "./profiles";
import type {
  EditorState,
  OutputGuides,
  OutputSettings,
  Ease,
  KeyTrackVec3,
  Key
} from "./state";
import {
  createEditorState,
  sampleVec3,
  sampleQuat,
  sampleFloat,
  sampleBool,
  vec3,
  setVec3Key,
  setFloatKey,
  setQuatKey,
  setBoolKey,
  getJointTrack,
  getGroupScaleTrack
} from "./state";
import type { RigProfile, RigProfileId, Vec3 } from "./types";

const APP_VERSION = "0.1.0";
const DEPTH_BRUSH_SPEED = 0.01;
const PROFILE_IDS = Object.keys(RIG_PROFILES) as RigProfileId[];

type Selection =
  | { kind: "joint"; id: string }
  | { kind: "rigRoot" }
  | { kind: "videoPlane" }
  | null;

type RigVisual = {
  group: THREE.Group;
  joints: Record<string, THREE.Mesh>;
  jointMaterials: Record<string, THREE.MeshStandardMaterial>;
  bones: [string, string][];
  boneGeometry: THREE.BufferGeometry;
};

type JointCentroids = Record<string, Vec3>;

type VideoRuntime = {
  element: HTMLVideoElement;
  texture: THREE.VideoTexture;
  width: number;
  height: number;
};

type UIController = {
  refreshJointList: () => void;
  updateSelection: () => void;
  updateTimeline: () => void;
  updateOutputControls: () => void;
  updateGuideControls: () => void;
  updateGroupControls: () => void;
  updateAutoKey: () => void;
  updatePlaybackControls: () => void;
  updateEaseControls: () => void;
  updateCameraControls: () => void;
  updateVideoControls: (config: { lock: boolean; offset: number }) => void;
  showStatus: (message: string) => void;
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app container missing");
app.innerHTML = "";

const layout = document.createElement("div");
layout.className = "layout";
const viewportHost = document.createElement("div");
viewportHost.className = "viewport";
const panel = document.createElement("div");
panel.className = "panel";
layout.append(viewportHost, panel);
app.appendChild(layout);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
viewportHost.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.1, 0);

const transformControls = new TransformControls(camera, renderer.domElement);
const transformControlsToggle = transformControls as TransformControls & { enabled: boolean };
transformControls.setSize(0.75);
scene.add(transformControls as unknown as THREE.Object3D);

const ambient = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambient);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
keyLight.position.set(5, 8, 5);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x88aaff, 0.3);
fillLight.position.set(-5, 4, -3);
scene.add(fillLight);

const grid = new THREE.GridHelper(12, 24, 0x444444, 0x222222);
scene.add(grid);
const axes = new THREE.AxesHelper(0.5);
scene.add(axes);

class GateOverlay {
  overlayScene = new THREE.Scene();
  overlayCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  private renderer: THREE.WebGLRenderer;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
  }

  update(output: OutputSettings) {
    const canvas = this.renderer.domElement;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    this.overlayCamera.left = 0;
    this.overlayCamera.right = W;
    this.overlayCamera.bottom = 0;
    this.overlayCamera.top = H;
    this.overlayCamera.updateProjectionMatrix();
    this.overlayScene.clear();

    const gateAspect = (output.width * output.pixelAspect) / Math.max(output.height, 1);
    const viewAspect = W / Math.max(H, 1);

    let gw: number;
    let gh: number;
    if (viewAspect >= gateAspect) {
      gh = H;
      gw = H * gateAspect;
    } else {
      gw = W;
      gh = W / gateAspect;
    }
    const x = (W - gw) * 0.5;
    const y = (H - gh) * 0.5;

    const addRect = (sx: number, sy: number, sw: number, sh: number, color: number, opacity: number) => {
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array([
        sx,
        sy,
        0,
        sx + sw,
        sy,
        0,
        sx + sw,
        sy,
        0,
        sx + sw,
        sy + sh,
        0,
        sx + sw,
        sy + sh,
        0,
        sx,
        sy + sh,
        0,
        sx,
        sy + sh,
        0,
        sx,
        sy,
        0
      ]);
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      this.overlayScene.add(
        new THREE.LineSegments(
          geo,
          new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })
        )
      );
    };

    if (output.guides.showImageGate) {
      addRect(x, y, gw, gh, 0xffffff, output.guides.opacity);
    }
    if (output.guides.showThirds) {
      const thirdsGeo = new THREE.BufferGeometry();
      const tx1 = x + gw / 3;
      const tx2 = x + (2 * gw) / 3;
      const ty1 = y + gh / 3;
      const ty2 = y + (2 * gh) / 3;
      const arr = new Float32Array([
        tx1,
        y,
        0,
        tx1,
        y + gh,
        0,
        tx2,
        y,
        0,
        tx2,
        y + gh,
        0,
        x,
        ty1,
        0,
        x + gw,
        ty1,
        0,
        x,
        ty2,
        0,
        x + gw,
        ty2,
        0
      ]);
      thirdsGeo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      this.overlayScene.add(
        new THREE.LineSegments(
          thirdsGeo,
          new THREE.LineBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false })
        )
      );
    }
    if (output.guides.showCenter) {
      const cx = x + gw / 2;
      const cy = y + gh / 2;
      const len = Math.min(gw, gh) * 0.04;
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array([
        cx - len,
        cy,
        0,
        cx + len,
        cy,
        0,
        cx,
        cy - len,
        0,
        cx,
        cy + len,
        0
      ]);
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      this.overlayScene.add(
        new THREE.LineSegments(
          geo,
          new THREE.LineBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })
        )
      );
    }
    if (output.guides.showActionSafe) {
      const margin = output.guides.actionSafePct / 100;
      addRect(x + gw * margin, y + gh * margin, gw * (1 - 2 * margin), gh * (1 - 2 * margin), 0x00ff88, 0.6);
    }
    if (output.guides.showTitleSafe) {
      const margin = output.guides.titleSafePct / 100;
      addRect(x + gw * margin, y + gh * margin, gw * (1 - 2 * margin), gh * (1 - 2 * margin), 0x0088ff, 0.6);
    }
  }

  render() {
    this.renderer.render(this.overlayScene, this.overlayCamera);
  }
}

const overlay = new GateOverlay(renderer);

let state: EditorState = createEditorState(DEFAULT_PROFILE_ID);
let selection: Selection = null;
let transformMode: "translate" | "rotate" | "scale" = "translate";
let currentFrame = 0;
let isPlaying = false;
let loopPlayback = true;
let playbackCursor = 0;
let lastPlaybackTime = 0;
let cameraPreviewEnabled = true;
let selectionDirty = false;
let videoRuntime: VideoRuntime | null = null;
let rigVisual = buildRig(getProfile(state.rigProfileId));
let centroids = computeGroupCentroids(getProfile(state.rigProfileId));
const videoPlaneMesh = createVideoPlaneMesh();
const videoAnchor = new THREE.Group();
scene.add(videoAnchor);
videoAnchor.add(videoPlaneMesh);
overlay.update(state.output);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const depthBrushState = {
  active: false,
  pointerId: -1,
  jointId: null as string | null,
  startY: 0,
  startPos: new THREE.Vector3()
};
const depthBrushDirection = new THREE.Vector3();
const depthBrushOffset = new THREE.Vector3();

const ui = buildPanel(panel);
ui.refreshJointList();
ui.updateTimeline();
ui.updateOutputControls();
ui.updateGuideControls();
ui.updateGroupControls();
ui.updateAutoKey();
ui.updatePlaybackControls();
ui.updateEaseControls();
ui.updateCameraControls();
ui.updateVideoControls({
  lock: sampleBool(state.anim.videoPlane.lockToCamera, currentFrame, false) ?? false,
  offset: sampleFloat(state.anim.videoPlane.timeOffset, currentFrame, 0) ?? 0
});

handleResize();
window.addEventListener("resize", handleResize);
renderer.domElement.addEventListener("pointerdown", onPointerDown);
renderer.domElement.addEventListener("pointermove", onPointerMove);
renderer.domElement.addEventListener("pointerup", onPointerUp);
renderer.domElement.addEventListener("pointerleave", onPointerUp);
renderer.domElement.addEventListener("pointercancel", onPointerUp);

transformControls.addEventListener("dragging-changed", (event: TransformControlsEventMap["dragging-changed"]) => {
  const isDragging = Boolean(event.value);
  controls.enabled = !isDragging;
});

transformControls.addEventListener("objectChange", () => {
  selectionDirty = true;
  if (state.autoKey) {
    commitSelectionKey();
    selectionDirty = false;
  } else {
    ui.showStatus("Transform pending — click Key Selected to store");
  }
});

const orbitKeyHandler = (event: KeyboardEvent) => {
  if (event.key === "g") {
    selection = { kind: "rigRoot" };
    updateSelection();
  }
};
window.addEventListener("keydown", orbitKeyHandler);

function handleResize() {
  const width = viewportHost.clientWidth;
  const height = viewportHost.clientHeight;
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  overlay.update(state.output);
}

function createVideoPlaneMesh() {
  const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.visible = false;
  return mesh;
}

function buildRig(profile: RigProfile): RigVisual {
  const group = new THREE.Group();
  const sphereGeo = new THREE.SphereGeometry(0.035, 18, 18);
  const joints: Record<string, THREE.Mesh> = {};
  const jointMaterials: Record<string, THREE.MeshStandardMaterial> = {};
  for (const joint of profile.joints) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x4cc9f0, metalness: 0, roughness: 0.3 });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.name = joint.id;
    joints[joint.id] = mesh;
    jointMaterials[joint.id] = mat;
    group.add(mesh);
  }
  const bonePositions = new Float32Array(profile.bones.length * 6);
  const boneGeometry = new THREE.BufferGeometry();
  boneGeometry.setAttribute("position", new THREE.BufferAttribute(bonePositions, 3));
  const boneLines = new THREE.LineSegments(
    boneGeometry,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
  );
  group.add(boneLines);
  scene.add(group);
  return { group, joints, jointMaterials, bones: profile.bones.slice(), boneGeometry };
}

function disposeRigVisual(visual: RigVisual) {
  scene.remove(visual.group);
  const disposedGeometries = new Set<THREE.BufferGeometry>();
  visual.group.traverse((obj: THREE.Object3D) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      const geometry = mesh.geometry as THREE.BufferGeometry;
      if (!disposedGeometries.has(geometry)) {
        geometry.dispose();
        disposedGeometries.add(geometry);
      }
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material: THREE.Material) => material.dispose());
      } else {
        (mesh.material as THREE.Material).dispose();
      }
    }
  });
  visual.boneGeometry.dispose();
}

function computeGroupCentroids(profile: RigProfile): JointCentroids {
  const centroids: JointCentroids = {};
  for (const [groupId, def] of Object.entries(profile.groups)) {
    const joints = def.joints;
    if (!joints.length) continue;
    const accum = vec3(0, 0, 0);
    for (const jointId of joints) {
      const p = profile.restPose[jointId];
      if (!p) continue;
      accum.x += p.x;
      accum.y += p.y;
      accum.z += p.z;
    }
    centroids[groupId] = {
      x: accum.x / joints.length,
      y: accum.y / joints.length,
      z: accum.z / joints.length
    };
  }
  return centroids;
}

function onPointerDown(event: PointerEvent) {
  if (event.altKey && selection?.kind === "joint") {
    if (beginDepthBrush(event)) {
      return;
    }
  }
  if (depthBrushState.active) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const targets = Object.values(rigVisual.joints);
  const intersects = raycaster.intersectObjects(targets, false);
  if (intersects.length > 0) {
    const jointId = intersects[0].object.name;
    selection = { kind: "joint", id: jointId };
    updateSelection();
  }
}

function onPointerMove(event: PointerEvent) {
  if (!depthBrushState.active || depthBrushState.pointerId !== event.pointerId) return;
  updateDepthBrush(event);
}

function onPointerUp(event: PointerEvent) {
  if (!depthBrushState.active || depthBrushState.pointerId !== event.pointerId) {
    return;
  }
  endDepthBrush(event);
}

function beginDepthBrush(event: PointerEvent): boolean {
  if (!selection || selection.kind !== "joint") return false;
  const mesh = rigVisual.joints[selection.id];
  if (!mesh) return false;
  depthBrushState.active = true;
  depthBrushState.pointerId = event.pointerId;
  depthBrushState.jointId = selection.id;
  depthBrushState.startY = event.clientY;
  depthBrushState.startPos.copy(mesh.position);
  controls.enabled = false;
  transformControlsToggle.enabled = false;
  renderer.domElement.setPointerCapture(event.pointerId);
  return true;
}

function updateDepthBrush(event: PointerEvent) {
  if (!depthBrushState.jointId) return;
  const mesh = rigVisual.joints[depthBrushState.jointId];
  if (!mesh) return;
  camera.getWorldDirection(depthBrushDirection);
  const delta = (depthBrushState.startY - event.clientY) * DEPTH_BRUSH_SPEED;
  depthBrushOffset.copy(depthBrushDirection).multiplyScalar(delta);
  mesh.position.copy(depthBrushState.startPos).add(depthBrushOffset);
  selectionDirty = true;
  if (state.autoKey) {
    commitSelectionKey();
    selectionDirty = false;
  } else {
    ui.showStatus("Transform pending — click Key Selected to store");
  }
}

function endDepthBrush(event?: PointerEvent) {
  if (!depthBrushState.active) return;
  if (event && event.pointerId !== depthBrushState.pointerId && event.type === "pointerup") return;
  if (event && depthBrushState.pointerId === event.pointerId && renderer.domElement.hasPointerCapture(event.pointerId)) {
    renderer.domElement.releasePointerCapture(event.pointerId);
  }
  depthBrushState.active = false;
  depthBrushState.pointerId = -1;
  depthBrushState.jointId = null;
  depthBrushState.startPos.set(0, 0, 0);
  controls.enabled = true;
  transformControlsToggle.enabled = true;
}

function setTransformMode(mode: "translate" | "rotate" | "scale") {
  transformMode = mode;
  transformControls.setMode(mode);
  if (selection?.kind === "joint" && mode !== "translate") {
    transformControls.setMode("translate");
    transformMode = "translate";
  }
}

function selectRigRoot() {
  selection = { kind: "rigRoot" };
  updateSelection();
}

function selectVideoPlane() {
  selection = { kind: "videoPlane" };
  updateSelection();
}

function updateSelection() {
  selectionDirty = false;
  transformControls.detach();
  for (const [jointId, mat] of Object.entries(rigVisual.jointMaterials)) {
    mat.color.set(selection?.kind === "joint" && selection.id === jointId ? 0xffc857 : 0x4cc9f0);
  }
  if (!selection) {
    ui.updateSelection();
    return;
  }
  if (selection.kind === "joint") {
    const mesh = rigVisual.joints[selection.id];
    if (mesh) {
      transformControls.attach(mesh);
      transformControls.setMode("translate");
    }
  } else if (selection.kind === "rigRoot") {
    transformControls.attach(rigVisual.group);
    transformControls.setMode(transformMode);
  } else if (selection.kind === "videoPlane") {
    transformControls.attach(videoPlaneMesh);
    transformControls.setMode(transformMode);
  }
  ui.updateSelection();
  ui.updateEaseControls();
}

function commitSelectionKey() {
  if (!selection) return;
  const frame = currentFrame;
  if (selection.kind === "joint") {
    const mesh = rigVisual.joints[selection.id];
    if (!mesh) return;
    const track = getJointTrack(state, selection.id);
    setVec3Key(track, frame, { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z });
  } else if (selection.kind === "rigRoot") {
    const pos = rigVisual.group.position;
    const scale = rigVisual.group.scale;
    const rot = rigVisual.group.quaternion;
    setVec3Key(state.anim.rigRoot.pos, frame, { x: pos.x, y: pos.y, z: pos.z });
    setVec3Key(state.anim.rigRoot.scale, frame, { x: scale.x, y: scale.y, z: scale.z });
    setQuatKey(state.anim.rigRoot.rot, frame, [rot.x, rot.y, rot.z, rot.w]);
  } else if (selection.kind === "videoPlane") {
    const pos = videoPlaneMesh.position;
    const scale = videoPlaneMesh.scale;
    const rot = videoPlaneMesh.quaternion;
    setVec3Key(state.anim.videoPlane.transform.pos, frame, { x: pos.x, y: pos.y, z: pos.z });
    setVec3Key(state.anim.videoPlane.transform.scale, frame, { x: scale.x, y: scale.y, z: scale.z });
    setQuatKey(state.anim.videoPlane.transform.rot, frame, [rot.x, rot.y, rot.z, rot.w]);
  }
  ui.showStatus(`Key stored @ frame ${frame}`);
  selectionDirty = false;
  requestPoseUpdate();
}

function evaluatePose(frame: number) {
  const pose: Record<string, Vec3> = {};
  for (const joint of state.rigDef.joints) {
    const base = state.restPose[joint.id];
    if (base) {
      pose[joint.id] = { x: base.x, y: base.y, z: base.z };
    }
  }
  for (const [groupId, joints] of Object.entries(state.rigDef.groups)) {
    const centroid = centroids[groupId];
    const scale = sampleVec3(getGroupScaleTrack(state, groupId), frame, vec3(1, 1, 1));
    if (!scale || !centroid) continue;
    for (const jointId of joints.joints) {
      const base = pose[jointId];
      if (!base) continue;
      base.x = centroid.x + (base.x - centroid.x) * scale.x;
      base.y = centroid.y + (base.y - centroid.y) * scale.y;
      base.z = centroid.z + (base.z - centroid.z) * scale.z;
    }
  }
  for (const [jointId, track] of Object.entries(state.anim.jointPositions)) {
    const override = sampleVec3(track, frame);
    if (override) pose[jointId] = override;
  }
  const rigPos = sampleVec3(state.anim.rigRoot.pos, frame, vec3(0, 0.9, 0))!;
  const rigScale = sampleVec3(state.anim.rigRoot.scale, frame, vec3(1, 1, 1))!;
  const rigRot = sampleQuat(state.anim.rigRoot.rot, frame) ?? [0, 0, 0, 1];
  return { pose, rigPos, rigScale, rigRot };
}

function updateRig(frame: number) {
  const { pose, rigPos, rigScale, rigRot } = evaluatePose(frame);
  rigVisual.group.position.set(rigPos.x, rigPos.y, rigPos.z);
  rigVisual.group.scale.set(rigScale.x, rigScale.y, rigScale.z);
  rigVisual.group.quaternion.set(rigRot[0], rigRot[1], rigRot[2], rigRot[3]);
  for (const [jointId, mesh] of Object.entries(rigVisual.joints)) {
    const p = pose[jointId];
    if (p) {
      mesh.position.set(p.x, p.y, p.z);
    }
  }
  const attr = rigVisual.boneGeometry.getAttribute("position") as THREE.BufferAttribute;
  let idx = 0;
  for (const [a, b] of rigVisual.bones) {
    const pa = pose[a];
    const pb = pose[b];
    if (!pa || !pb) continue;
    attr.setXYZ(idx, pa.x, pa.y, pa.z);
    idx += 1;
    attr.setXYZ(idx, pb.x, pb.y, pb.z);
    idx += 1;
  }
  attr.needsUpdate = true;
}

function updateCamera(frame: number) {
  if (!cameraPreviewEnabled) return;
  const pos = sampleVec3(state.anim.camera.pos, frame);
  const target = sampleVec3(state.anim.camera.target, frame);
  const fov = sampleFloat(state.anim.camera.fov, frame, camera.fov);
  if (pos) camera.position.set(pos.x, pos.y, pos.z);
  if (target) controls.target.set(target.x, target.y, target.z);
  if (fov !== undefined) camera.fov = fov;
  camera.updateProjectionMatrix();
  controls.update();
}

function updateVideoPlane(frame: number) {
  const planeState = state.anim.videoPlane;
  const lock = sampleBool(planeState.lockToCamera, frame, false) ?? false;
  const offsetValue = sampleFloat(planeState.timeOffset, frame, 0) ?? 0;
  ui.updateVideoControls({ lock, offset: offsetValue });
  const enabled = planeState.enabled && !!videoRuntime;
  videoPlaneMesh.visible = enabled;
  if (!enabled) return;
  const pos = sampleVec3(planeState.transform.pos, frame, vec3(0, 1.2, -1));
  const scale = sampleVec3(planeState.transform.scale, frame, vec3(2, 2, 1));
  const rot = sampleQuat(planeState.transform.rot, frame) ?? [0, 0, 0, 1];
  reparentVideoPlane(lock);
  if (pos) videoPlaneMesh.position.set(pos.x, pos.y, pos.z);
  if (scale) videoPlaneMesh.scale.set(scale.x, scale.y, scale.z);
  videoPlaneMesh.quaternion.set(rot[0], rot[1], rot[2], rot[3]);
  if (videoRuntime) {
    const desired = frame / state.timeline.fps + offsetValue;
    if (Math.abs(videoRuntime.element.currentTime - desired) > 0.03) {
      videoRuntime.element.currentTime = desired;
    }
  }
}

function reparentVideoPlane(lockToCamera: boolean) {
  const parent = videoPlaneMesh.parent;
  if (lockToCamera && parent !== camera) {
    preserveWorldReparent(videoPlaneMesh, camera);
  } else if (!lockToCamera && parent !== videoAnchor) {
    preserveWorldReparent(videoPlaneMesh, videoAnchor);
  }
}

function preserveWorldReparent(obj: THREE.Object3D, target: THREE.Object3D) {
  const matrix = obj.matrixWorld.clone();
  target.add(obj);
  matrix.decompose(obj.position, obj.quaternion, obj.scale);
}

function requestPoseUpdate() {
  updateRig(currentFrame);
  updateVideoPlane(currentFrame);
}

function updateFrame(frame: number) {
  currentFrame = Math.round(THREE.MathUtils.clamp(frame, 0, state.timeline.frameCount));
  playbackCursor = currentFrame;
  if (isPlaying) {
    lastPlaybackTime = performance.now();
  }
  updateRig(currentFrame);
  updateCamera(currentFrame);
  updateVideoPlane(currentFrame);
  ui.updateTimeline();
  ui.updateGroupControls();
  ui.updateEaseControls();
}

function toggleAutoKey() {
  state.autoKey = !state.autoKey;
  ui.updateAutoKey();
  if (state.autoKey && selectionDirty) {
    commitSelectionKey();
  }
}

function startPlayback() {
  if (isPlaying) return;
  isPlaying = true;
  playbackCursor = currentFrame;
  lastPlaybackTime = performance.now();
  ui.updatePlaybackControls();
}

function stopPlayback() {
  if (!isPlaying) return;
  isPlaying = false;
  lastPlaybackTime = 0;
  ui.updatePlaybackControls();
}

function togglePlayback() {
  if (isPlaying) {
    stopPlayback();
  } else {
    startPlayback();
  }
}

function toggleLoopPlayback() {
  loopPlayback = !loopPlayback;
  ui.updatePlaybackControls();
}

type EaseInfo =
  | { mode: "none" }
  | { mode: "no-key" }
  | { mode: "mixed" }
  | { mode: "value"; ease: Ease };

function getSelectionEaseTargets(): Key<any>[][] {
  if (!selection) return [];
  const targets: Key<any>[][] = [];
  const pushVec3 = (track: KeyTrackVec3) => {
    targets.push(track.keysX, track.keysY, track.keysZ);
  };
  if (selection.kind === "joint") {
    pushVec3(getJointTrack(state, selection.id));
    return targets;
  }
  if (selection.kind === "rigRoot") {
    if (transformMode === "translate") {
      pushVec3(state.anim.rigRoot.pos);
    } else if (transformMode === "scale") {
      pushVec3(state.anim.rigRoot.scale);
    } else {
      targets.push(state.anim.rigRoot.rot.keys);
    }
    return targets;
  }
  if (selection.kind === "videoPlane") {
    const transform = state.anim.videoPlane.transform;
    if (transformMode === "translate") {
      pushVec3(transform.pos);
    } else if (transformMode === "scale") {
      pushVec3(transform.scale);
    } else {
      targets.push(transform.rot.keys);
    }
  }
  return targets;
}

function getSelectionEaseInfo(): EaseInfo {
  if (!selection) return { mode: "none" };
  const targets = getSelectionEaseTargets();
  const values: Ease[] = [];
  for (const keys of targets) {
    const key = keys.find((k) => k.f === currentFrame);
    if (key) {
      const easeValue = (key.ease as Ease | undefined) ?? "linear";
      values.push(easeValue);
    }
  }
  if (!values.length) return { mode: "no-key" };
  const first = values[0];
  const mixed = values.some((value) => value !== first);
  if (mixed) return { mode: "mixed" };
  return { mode: "value", ease: first };
}

function applyEaseToSelection(ease: Ease): boolean {
  const targets = getSelectionEaseTargets();
  let applied = false;
  targets.forEach((keys) => {
    const key = keys.find((k) => k.f === currentFrame);
    if (!key) return;
    if (ease === "linear") {
      delete key.ease;
    } else {
      key.ease = ease;
    }
    applied = true;
  });
  if (applied) {
    requestPoseUpdate();
  }
  return applied;
}

function setTimelineValue(key: "fps" | "frameCount", value: number) {
  if (Number.isNaN(value) || value <= 0) return;
  const nextValue = key === "frameCount" ? Math.round(value) : value;
  state.timeline[key] = nextValue;
  updateFrame(currentFrame);
}

function setCurrentFrame(value: number) {
  updateFrame(value);
}

function setOutputSize(partial: Partial<{ width: number; height: number; pixelAspect: number; renderScale: number; overscanPct: number }>) {
  Object.assign(state.output, partial);
  overlay.update(state.output);
  ui.updateOutputControls();
}

function setGuideFlag<K extends keyof OutputGuides>(key: K, value: OutputGuides[K]) {
  state.output.guides[key] = value;
  overlay.update(state.output);
  ui.updateGuideControls();
}

const clampGroupScaleValue = (value: number) => THREE.MathUtils.clamp(Number.isFinite(value) ? value : 1, 0.1, 5);

function getGroupScaleValue(groupId: string): Vec3 {
  return sampleVec3(getGroupScaleTrack(state, groupId), currentFrame, vec3(1, 1, 1)) ?? vec3(1, 1, 1);
}

function setGroupScaleValue(groupId: string, value: Vec3): Vec3 {
  const snapped = {
    x: clampGroupScaleValue(value.x),
    y: clampGroupScaleValue(value.y),
    z: clampGroupScaleValue(value.z)
  };
  const track = getGroupScaleTrack(state, groupId);
  setVec3Key(track, currentFrame, snapped);
  requestPoseUpdate();
  return snapped;
}

function switchProfile(id: RigProfileId) {
  if (id === state.rigProfileId) return;
  stopPlayback();
  const newState = createEditorState(id);
  state = newState;
  disposeRigVisual(rigVisual);
  rigVisual = buildRig(getProfile(id));
  centroids = computeGroupCentroids(getProfile(id));
  selection = null;
  ui.refreshJointList();
  ui.updateTimeline();
  ui.updateOutputControls();
  ui.updateGuideControls();
  updateSelection();
  updateFrame(0);
}

function importVideo(file: File) {
  const video = document.createElement("video");
  video.src = URL.createObjectURL(file);
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.addEventListener("loadeddata", () => {
    video.play();
  });
  video.addEventListener("loadedmetadata", () => {
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const mat = videoPlaneMesh.material as THREE.MeshBasicMaterial;
    mat.map = texture;
    mat.needsUpdate = true;
    videoRuntime = { element: video, texture, width: video.videoWidth, height: video.videoHeight };
    state.anim.videoPlane.enabled = true;
    videoPlaneMesh.visible = true;
    ui.showStatus(`Loaded video ${file.name}`);
    overlay.update(state.output);
    updateFrame(currentFrame);
  });
}

function clearVideoPlane() {
  if (videoRuntime) {
    videoRuntime.texture.dispose();
    videoRuntime.element.pause();
    videoRuntime = null;
  }
  const mat = videoPlaneMesh.material as THREE.MeshBasicMaterial;
  mat.map = null;
  state.anim.videoPlane.enabled = false;
  videoPlaneMesh.visible = false;
  updateFrame(currentFrame);
}

function matchVideoOutput() {
  if (!videoRuntime) return;
  const { width, height } = videoRuntime;
  setOutputSize({ width, height });
  const duration = videoRuntime.element.duration || 0;
  if (duration > 0) {
    state.timeline.frameCount = Math.round(duration * state.timeline.fps);
    ui.updateTimeline();
  }
  overlay.update(state.output);
  updateFrame(currentFrame);
}

function saveToFile() {
  const payload = {
    meta: { appVersion: APP_VERSION, createdAt: new Date().toISOString() },
    timeline: state.timeline,
    rigProfile: state.rigProfileId,
    rigDef: state.rigDef,
    anim: state.anim,
    output: state.output
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `pose-editor-${Date.now()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function loadFromFile(file: File) {
  file
    .text()
    .then((text) => {
      const data = JSON.parse(text);
      const profileId = (data?.rigProfile as RigProfileId) || state.rigProfileId;
      const base = createEditorState(profileId);
      state = {
        rigProfileId: profileId,
        rigDef: data?.rigDef ?? base.rigDef,
        restPose: base.restPose,
        timeline: data?.timeline ?? base.timeline,
        output: {
          ...base.output,
          ...(data?.output ?? {}),
          guides: { ...base.output.guides, ...(data?.output?.guides ?? {}) }
        },
        anim: {
          rigRoot: {
            pos: data?.anim?.rigRoot?.pos ?? base.anim.rigRoot.pos,
            rot: data?.anim?.rigRoot?.rot ?? base.anim.rigRoot.rot,
            scale: data?.anim?.rigRoot?.scale ?? base.anim.rigRoot.scale
          },
          groupScales: { ...base.anim.groupScales, ...(data?.anim?.groupScales ?? {}) },
          jointPositions: data?.anim?.jointPositions ?? {},
          camera: {
            pos: data?.anim?.camera?.pos ?? base.anim.camera.pos,
            target: data?.anim?.camera?.target ?? base.anim.camera.target,
            fov: data?.anim?.camera?.fov ?? base.anim.camera.fov
          },
          videoPlane: {
            enabled: data?.anim?.videoPlane?.enabled ?? base.anim.videoPlane.enabled,
            mediaSrc: data?.anim?.videoPlane?.mediaSrc ?? base.anim.videoPlane.mediaSrc,
            transform: {
              pos: data?.anim?.videoPlane?.transform?.pos ?? base.anim.videoPlane.transform.pos,
              rot: data?.anim?.videoPlane?.transform?.rot ?? base.anim.videoPlane.transform.rot,
              scale: data?.anim?.videoPlane?.transform?.scale ?? base.anim.videoPlane.transform.scale
            },
            timeOffset: data?.anim?.videoPlane?.timeOffset ?? base.anim.videoPlane.timeOffset,
            lockToCamera: data?.anim?.videoPlane?.lockToCamera ?? base.anim.videoPlane.lockToCamera
          }
        },
        autoKey: data?.autoKey ?? base.autoKey
      };
      stopPlayback();
      disposeRigVisual(rigVisual);
      rigVisual = buildRig(getProfile(state.rigProfileId));
      centroids = computeGroupCentroids(getProfile(state.rigProfileId));
      selection = null;
      ui.refreshJointList();
      ui.updateTimeline();
      ui.updateOutputControls();
      ui.updateGuideControls();
      ui.updateAutoKey();
      updateSelection();
      updateFrame(0);
      ui.showStatus(`Loaded ${file.name}`);
    })
    .catch(() => ui.showStatus("Failed to load file"));
}

function buildPanel(container: HTMLElement): UIController {
  container.innerHTML = `
    <section>
      <header>Rig</header>
      <label>Profile
        <select data-ctrl="profile"></select>
      </label>
      <div class="button-row">
        <button data-ctrl="select-rig">Rig Root</button>
        <button data-ctrl="select-video">Video Plane</button>
      </div>
    </section>
    <section>
      <header>Timeline</header>
      <div class="field-row">
        <label>FPS <input type="number" data-ctrl="fps" min="1" /></label>
        <label>Frames <input type="number" data-ctrl="frames" min="1" /></label>
      </div>
      <label>Frame
        <input type="range" min="0" data-ctrl="frame-slider" />
        <input type="number" min="0" data-ctrl="frame-input" />
      </label>
      <div class="button-row">
        <button data-ctrl="toggle-autokey"></button>
        <button data-ctrl="key-selection">Key Selected</button>
      </div>
      <div class="button-row playback-row">
        <button data-ctrl="playback-toggle">Play</button>
        <button data-ctrl="loop-toggle">Loop</button>
      </div>
      <div class="field-row ease-row">
        <label>Ease
          <select data-ctrl="ease-select">
            <option value="linear">Linear</option>
            <option value="in">Ease In</option>
            <option value="out">Ease Out</option>
            <option value="inOut">Ease In-Out</option>
          </select>
        </label>
        <button data-ctrl="apply-ease">Apply Ease</button>
      </div>
      <div class="ease-status" data-ctrl="ease-status">Select something to edit easing.</div>
    </section>
    <section>
      <header>Transform</header>
      <div class="button-row" data-ctrl="transform-modes">
        <button data-mode="translate">Move</button>
        <button data-mode="rotate">Rotate</button>
        <button data-mode="scale">Scale</button>
      </div>
      <div class="selection-label" data-ctrl="selection-label">No selection</div>
    </section>
    <section>
      <header>Groups</header>
      <div class="group-scale-list" data-ctrl="group-scales"></div>
    </section>
    <section>
      <header>Output</header>
      <div class="field-row">
        <label>Width <input type="number" data-ctrl="out-width" min="1" /></label>
        <label>Height <input type="number" data-ctrl="out-height" min="1" /></label>
      </div>
      <div class="field-row">
        <label>Pixel Aspect <input type="number" step="0.01" data-ctrl="out-pa" /></label>
        <label>Render Scale <input type="number" step="0.1" data-ctrl="out-scale" /></label>
      </div>
      <label>Overscan % <input type="number" step="0.5" data-ctrl="out-overscan" /></label>
      <div class="guides" data-ctrl="guides"></div>
    </section>
    <section>
      <header>Video Plane</header>
      <input type="file" accept="video/*" data-ctrl="video-input" />
      <div class="button-row">
        <button data-ctrl="match-video">Match Video</button>
        <button data-ctrl="clear-video">Clear</button>
      </div>
      <label><input type="checkbox" data-ctrl="lock-video" /> Lock to camera</label>
      <label>Time Offset (s) <input type="number" step="0.05" data-ctrl="video-offset" /></label>
    </section>
    <section>
      <header>Camera</header>
      <label>FOV <input type="number" step="0.1" data-ctrl="camera-fov" /></label>
      <div class="button-row">
        <button data-ctrl="camera-preview">Preview</button>
        <button data-ctrl="camera-key">Key Camera</button>
      </div>
    </section>
    <section>
      <header>Joints</header>
      <div class="joint-list" data-ctrl="joint-list"></div>
    </section>
    <section>
      <header>IO</header>
      <div class="button-row">
        <button data-ctrl="save-json">Save JSON</button>
        <button data-ctrl="load-json">Load JSON</button>
      </div>
      <div class="status" data-ctrl="status">Ready.</div>
    </section>
  `;

  const profileSelect = container.querySelector<HTMLSelectElement>('[data-ctrl="profile"]')!;

  const fillProfiles = () => {
    profileSelect.innerHTML = "";
    PROFILE_IDS.forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = getProfile(id).label;
      if (id === state.rigProfileId) option.selected = true;
      profileSelect.appendChild(option);
    });
  };
  fillProfiles();

  profileSelect.addEventListener("change", () => {
    switchProfile(profileSelect.value as RigProfileId);
    fillProfiles();
  });

  container.querySelector<HTMLButtonElement>('[data-ctrl="select-rig"]')!.addEventListener("click", selectRigRoot);
  container.querySelector<HTMLButtonElement>('[data-ctrl="select-video"]')!.addEventListener("click", selectVideoPlane);

  const fpsInput = container.querySelector<HTMLInputElement>('[data-ctrl="fps"]')!;
  const framesInput = container.querySelector<HTMLInputElement>('[data-ctrl="frames"]')!;
  const frameSlider = container.querySelector<HTMLInputElement>('[data-ctrl="frame-slider"]')!;
  const frameNumber = container.querySelector<HTMLInputElement>('[data-ctrl="frame-input"]')!;
  fpsInput.addEventListener("change", () => setTimelineValue("fps", parseFloat(fpsInput.value)));
  framesInput.addEventListener("change", () => setTimelineValue("frameCount", parseInt(framesInput.value, 10)));
  frameSlider.addEventListener("input", () => setCurrentFrame(parseInt(frameSlider.value, 10)));
  frameNumber.addEventListener("change", () => setCurrentFrame(parseInt(frameNumber.value, 10)));

  container.querySelector<HTMLButtonElement>('[data-ctrl="toggle-autokey"]')!.addEventListener("click", toggleAutoKey);
  container.querySelector<HTMLButtonElement>('[data-ctrl="key-selection"]')!.addEventListener("click", commitSelectionKey);
  const playbackButton = container.querySelector<HTMLButtonElement>('[data-ctrl="playback-toggle"]')!;
  playbackButton.addEventListener("click", togglePlayback);
  const loopButton = container.querySelector<HTMLButtonElement>('[data-ctrl="loop-toggle"]')!;
  loopButton.addEventListener("click", toggleLoopPlayback);

  const easeSelect = container.querySelector<HTMLSelectElement>('[data-ctrl="ease-select"]')!;
  const easeApply = container.querySelector<HTMLButtonElement>('[data-ctrl="apply-ease"]')!;
  const easeStatus = container.querySelector<HTMLDivElement>('[data-ctrl="ease-status"]')!;
  easeApply.addEventListener("click", () => {
    if (!selection) {
      ui.showStatus("Select something to edit easing.");
      return;
    }
    const easeValue = easeSelect.value as Ease;
    const applied = applyEaseToSelection(easeValue);
    if (!applied) {
      ui.showStatus("No keyed values at this frame.");
    } else {
      ui.showStatus(`Applied ${easeValue} easing @ frame ${currentFrame}`);
      ui.updateEaseControls();
    }
  });

  const transformButtons = container.querySelectorAll<HTMLButtonElement>('[data-ctrl="transform-modes"] button');
  transformButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      transformButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const mode = btn.dataset.mode as "translate" | "rotate" | "scale" | undefined;
      if (mode) {
        setTransformMode(mode);
      }
    });
  });
  transformButtons[0].classList.add("active");

  const selectionLabel = container.querySelector<HTMLDivElement>('[data-ctrl="selection-label"]')!;
  const groupScaleWrap = container.querySelector<HTMLDivElement>('[data-ctrl="group-scales"]')!;
  type GroupInputEntry = { inputs: Record<"x" | "y" | "z", HTMLInputElement> };
  const groupScaleInputs = new Map<string, GroupInputEntry>();
  let groupSignature = "";

  const outWidth = container.querySelector<HTMLInputElement>('[data-ctrl="out-width"]')!;
  const outHeight = container.querySelector<HTMLInputElement>('[data-ctrl="out-height"]')!;
  const outPixelAspect = container.querySelector<HTMLInputElement>('[data-ctrl="out-pa"]')!;
  const outScale = container.querySelector<HTMLInputElement>('[data-ctrl="out-scale"]')!;
  const outOverscan = container.querySelector<HTMLInputElement>('[data-ctrl="out-overscan"]')!;

  outWidth.addEventListener("change", () => setOutputSize({ width: parseInt(outWidth.value, 10) }));
  outHeight.addEventListener("change", () => setOutputSize({ height: parseInt(outHeight.value, 10) }));
  outPixelAspect.addEventListener("change", () => setOutputSize({ pixelAspect: parseFloat(outPixelAspect.value) }));
  outScale.addEventListener("change", () => setOutputSize({ renderScale: parseFloat(outScale.value) }));
  outOverscan.addEventListener("change", () => setOutputSize({ overscanPct: parseFloat(outOverscan.value) }));

  const guidesWrap = container.querySelector<HTMLDivElement>('[data-ctrl="guides"]')!;
  type GuideToggleKey = "showImageGate" | "showThirds" | "showCenter" | "showActionSafe" | "showTitleSafe";
  const guideToggles: Array<{ key: GuideToggleKey; label: string }> = [
    { key: "showImageGate", label: "Image Gate" },
    { key: "showThirds", label: "Rule of Thirds" },
    { key: "showCenter", label: "Center" },
    { key: "showActionSafe", label: "Action Safe" },
    { key: "showTitleSafe", label: "Title Safe" }
  ];
  guideToggles.forEach((entry) => {
    const row = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.addEventListener("change", () => setGuideFlag(entry.key, input.checked));
    row.appendChild(input);
    row.appendChild(document.createTextNode(` ${entry.label}`));
    row.dataset.key = entry.key;
    guidesWrap.appendChild(row);
  });

  const videoInput = container.querySelector<HTMLInputElement>('[data-ctrl="video-input"]')!;
  videoInput.addEventListener("change", () => {
    const file = videoInput.files?.[0];
    if (file) importVideo(file);
  });
  container.querySelector<HTMLButtonElement>('[data-ctrl="match-video"]')!.addEventListener("click", matchVideoOutput);
  container.querySelector<HTMLButtonElement>('[data-ctrl="clear-video"]')!.addEventListener("click", clearVideoPlane);
  const lockVideo = container.querySelector<HTMLInputElement>('[data-ctrl="lock-video"]')!;
  lockVideo.addEventListener("change", () => {
    setBoolKey(state.anim.videoPlane.lockToCamera, currentFrame, lockVideo.checked);
    updateVideoPlane(currentFrame);
  });
  const videoOffset = container.querySelector<HTMLInputElement>('[data-ctrl="video-offset"]')!;
  videoOffset.addEventListener("change", () => {
    setFloatKey(state.anim.videoPlane.timeOffset, currentFrame, parseFloat(videoOffset.value));
    updateVideoPlane(currentFrame);
  });

  const cameraFovInput = container.querySelector<HTMLInputElement>('[data-ctrl="camera-fov"]')!;
  cameraFovInput.addEventListener("change", () => {
    camera.fov = parseFloat(cameraFovInput.value);
    camera.updateProjectionMatrix();
  });
  const cameraPreviewBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="camera-preview"]')!;
  cameraPreviewBtn.addEventListener("click", () => {
    cameraPreviewEnabled = !cameraPreviewEnabled;
    ui.updateCameraControls();
  });
  container.querySelector<HTMLButtonElement>('[data-ctrl="camera-key"]')!.addEventListener("click", () => {
    setVec3Key(state.anim.camera.pos, currentFrame, { x: camera.position.x, y: camera.position.y, z: camera.position.z });
    setVec3Key(state.anim.camera.target, currentFrame, { x: controls.target.x, y: controls.target.y, z: controls.target.z });
    setFloatKey(state.anim.camera.fov, currentFrame, camera.fov);
    ui.showStatus(`Camera keyed @ frame ${currentFrame}`);
  });

  const jointList = container.querySelector<HTMLDivElement>('[data-ctrl="joint-list"]')!;

  const saveBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="save-json"]')!;
  saveBtn.addEventListener("click", saveToFile);
  const loadBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="load-json"]')!;
  const loadInput = document.createElement("input");
  loadInput.type = "file";
  loadInput.accept = "application/json";
  loadInput.style.display = "none";
  loadInput.addEventListener("change", () => {
    const file = loadInput.files?.[0];
    if (file) loadFromFile(file);
  });
  container.appendChild(loadInput);
  loadBtn.addEventListener("click", () => loadInput.click());

  const updateGroupRowValues = (groupId: string, value: Vec3) => {
    const entry = groupScaleInputs.get(groupId);
    if (!entry) return;
    entry.inputs.x.value = value.x.toFixed(2);
    entry.inputs.y.value = value.y.toFixed(2);
    entry.inputs.z.value = value.z.toFixed(2);
  };

  const ensureGroupScaleRows = () => {
    const ids = Object.keys(state.rigDef.groups).join("|");
    if (groupSignature === ids) return;
    groupSignature = ids;
    groupScaleWrap.innerHTML = "";
    groupScaleInputs.clear();
    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "group-scale-empty";
      empty.textContent = "Profile has no named groups.";
      groupScaleWrap.appendChild(empty);
      return;
    }
    Object.entries(state.rigDef.groups).forEach(([groupId, def]) => {
      const row = document.createElement("div");
      row.className = "group-scale-row";
      const labelText = def.label || groupId;
      const title = document.createElement("div");
      title.className = "group-scale-title";
      title.textContent = labelText;
      row.appendChild(title);
      const axes = document.createElement("div");
      axes.className = "group-scale-axes";
      const axisInputs = {} as Record<"x" | "y" | "z", HTMLInputElement>;
      (["x", "y", "z"] as const).forEach((axis) => {
        const axisLabel = document.createElement("label");
        axisLabel.textContent = axis.toUpperCase();
        const input = document.createElement("input");
        input.type = "number";
        input.step = "0.05";
        input.min = "0.1";
        input.max = "5";
        input.value = "1.00";
        axisLabel.appendChild(input);
        axes.appendChild(axisLabel);
        axisInputs[axis] = input;
        input.addEventListener("change", () => {
          const numeric = parseFloat(input.value);
          if (Number.isNaN(numeric)) {
            updateGroupRowValues(groupId, getGroupScaleValue(groupId));
            ui.showStatus("Enter a numeric scale.");
            return;
          }
          const current = getGroupScaleValue(groupId);
          current[axis] = numeric;
          const applied = setGroupScaleValue(groupId, current);
          updateGroupRowValues(groupId, applied);
          ui.showStatus(`${labelText} scale keyed @ frame ${currentFrame}`);
        });
      });
      row.appendChild(axes);
      const actions = document.createElement("div");
      actions.className = "group-scale-actions";
      const resetBtn = document.createElement("button");
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", () => {
        const applied = setGroupScaleValue(groupId, vec3(1, 1, 1));
        updateGroupRowValues(groupId, applied);
        ui.showStatus(`${labelText} scale reset @ frame ${currentFrame}`);
      });
      actions.appendChild(resetBtn);
      row.appendChild(actions);
      groupScaleWrap.appendChild(row);
      groupScaleInputs.set(groupId, { inputs: axisInputs });
      updateGroupRowValues(groupId, getGroupScaleValue(groupId));
    });
  };

  const refreshGroupScaleValues = () => {
    ensureGroupScaleRows();
    groupScaleInputs.forEach((_entry, groupId) => {
      updateGroupRowValues(groupId, getGroupScaleValue(groupId));
    });
  };

  const refreshEaseDisplay = () => {
    const info = getSelectionEaseInfo();
    switch (info.mode) {
      case "none":
        easeSelect.value = "linear";
        easeSelect.disabled = true;
        easeApply.disabled = true;
        easeStatus.textContent = "Select something to edit easing.";
        break;
      case "no-key":
        easeSelect.disabled = false;
        easeApply.disabled = true;
        easeSelect.value = "linear";
        easeStatus.textContent = "No keys on this frame.";
        break;
      case "mixed":
        easeSelect.disabled = false;
        easeApply.disabled = false;
        easeSelect.value = "linear";
        easeStatus.textContent = "Mixed easing — choose a curve to override.";
        break;
      case "value":
        easeSelect.disabled = false;
        easeApply.disabled = false;
        easeSelect.value = info.ease ?? "linear";
        easeStatus.textContent = `Current ease: ${info.ease}`;
        break;
    }
  };

  const statusLabel = container.querySelector<HTMLDivElement>('[data-ctrl="status"]')!;

  return {
    refreshJointList: () => {
      jointList.innerHTML = "";
      for (const joint of state.rigDef.joints) {
        const btn = document.createElement("button");
        btn.textContent = joint.name || joint.id;
        btn.dataset.jointId = joint.id;
        btn.addEventListener("click", () => {
          selection = { kind: "joint", id: joint.id };
          updateSelection();
        });
        jointList.appendChild(btn);
      }
    },
    updateSelection: () => {
      if (!selection) {
        selectionLabel.textContent = "No selection";
      } else if (selection.kind === "joint") {
        selectionLabel.textContent = `Joint: ${selection.id}`;
      } else if (selection.kind === "rigRoot") {
        selectionLabel.textContent = "Rig Root";
      } else {
        selectionLabel.textContent = "Video Plane";
      }
      Array.from(jointList.children).forEach((child) => {
        const btn = child as HTMLButtonElement;
        const jointId = btn.dataset.jointId;
        btn.classList.toggle("active", selection?.kind === "joint" && jointId === selection.id);
      });
    },
    updateTimeline: () => {
      fpsInput.value = String(state.timeline.fps);
      framesInput.value = String(state.timeline.frameCount);
      frameSlider.max = String(state.timeline.frameCount);
      frameSlider.value = String(currentFrame);
      frameNumber.value = String(currentFrame);
    },
    updateOutputControls: () => {
      outWidth.value = String(state.output.width);
      outHeight.value = String(state.output.height);
      outPixelAspect.value = state.output.pixelAspect.toFixed(2);
      outScale.value = state.output.renderScale.toFixed(2);
      outOverscan.value = state.output.overscanPct.toFixed(1);
    },
    updateGuideControls: () => {
      guideToggles.forEach((entry) => {
        const label = guidesWrap.querySelector<HTMLLabelElement>(`label[data-key="${entry.key}"]`);
        const input = label?.querySelector<HTMLInputElement>("input");
        if (input) input.checked = state.output.guides[entry.key];
      });
    },
    updateGroupControls: () => {
      refreshGroupScaleValues();
    },
    updateAutoKey: () => {
      const btn = container.querySelector<HTMLButtonElement>('[data-ctrl="toggle-autokey"]')!;
      btn.textContent = state.autoKey ? "Auto-Key On" : "Auto-Key Off";
      btn.classList.toggle("active", state.autoKey);
    },
    updatePlaybackControls: () => {
      playbackButton.textContent = isPlaying ? "Pause" : "Play";
      playbackButton.classList.toggle("active", isPlaying);
      loopButton.classList.toggle("active", loopPlayback);
    },
    updateEaseControls: () => {
      refreshEaseDisplay();
    },
    updateCameraControls: () => {
      cameraFovInput.value = camera.fov.toFixed(2);
      const btn = container.querySelector<HTMLButtonElement>('[data-ctrl="camera-preview"]')!;
      btn.textContent = cameraPreviewEnabled ? "Preview On" : "Preview Off";
      btn.classList.toggle("active", cameraPreviewEnabled);
    },
    updateVideoControls: ({ lock, offset }: { lock: boolean; offset: number }) => {
      lockVideo.checked = lock;
      videoOffset.value = offset.toFixed(2);
    },
    showStatus: (message: string) => {
      statusLabel.textContent = message;
      setTimeout(() => {
        if (statusLabel.textContent === message) {
          statusLabel.textContent = "Ready.";
        }
      }, 3000);
    }
  };
}

function animate() {
  requestAnimationFrame(animate);
  if (isPlaying) {
    const now = performance.now();
    if (!lastPlaybackTime) {
      lastPlaybackTime = now;
    }
    const deltaSeconds = (now - lastPlaybackTime) / 1000;
    lastPlaybackTime = now;
    playbackCursor += deltaSeconds * state.timeline.fps;
    const maxFrame = state.timeline.frameCount;
    const frameSpan = Math.max(maxFrame + 1, 1);
    if (playbackCursor > maxFrame) {
      if (loopPlayback) {
        playbackCursor = playbackCursor % frameSpan;
      } else {
        playbackCursor = maxFrame;
        stopPlayback();
      }
    }
    const nextFrame = Math.round(playbackCursor);
    if (nextFrame !== currentFrame) {
      updateFrame(nextFrame);
    }
  }
  controls.update();
  renderer.autoClear = true;
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  overlay.render();
}

updateFrame(0);
animate();
