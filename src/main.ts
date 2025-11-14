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
import { processVideoPy, exportSkeletonVideo } from "./pose/serviceClient";
import { applyPoseResultToState } from "./pose/importer";
import type { PoseProcessResult, FrameKeypoints2D, VitPoseVariant } from "./pose/types";

const APP_VERSION = "0.1.0";
const DEPTH_BRUSH_SPEED = 0.01;
const PROFILE_IDS = Object.keys(RIG_PROFILES) as RigProfileId[];

type Selection =
  | { kind: "joint"; id: string }
  | { kind: "group"; id: string }
  | { kind: "rigRoot" }
  | { kind: "videoPlane" }
  | null;

type RigVisual = {
  group: THREE.Group;
  joints: Record<string, THREE.Mesh>;
  jointMaterials: Record<string, THREE.MeshStandardMaterial>;
  bones: [string, string][];
  boneGeometry: THREE.BufferGeometry;
  masterControl: THREE.Mesh;
  masterControlMaterial: THREE.MeshBasicMaterial;
};

type JointCentroids = Record<string, Vec3>;

type VideoRuntime = {
  element: HTMLVideoElement;
  texture: THREE.VideoTexture;
  width: number;
  height: number;
};

type TimelineBarController = {
  setFrame: (frame: number, frameCount: number) => void;
  setMarkers: (frames: number[], frameCount: number) => void;
  setFrameLines: (frameCount: number) => void;
  setPlaybackState: (payload: { playing: boolean; loop: boolean }) => void;
};

type UIController = {
  refreshJointList: () => void;
  updateSelection: () => void;
  updateTransformMode: () => void;
  updateScaleFactor: (value: number | null) => void;
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

const fileMenu = document.createElement("div");
fileMenu.className = "file-menu";
fileMenu.innerHTML = `
  <button class="file-menu-toggle" aria-label="File menu" aria-haspopup="true" aria-expanded="false">
    <span></span>
    <span></span>
    <span></span>
  </button>
  <div class="file-menu-dropdown" role="menu">
    <button type="button" role="menuitem" data-ctrl="import-json">Import JSON</button>
    <button type="button" role="menuitem" data-ctrl="export-json">Export JSON</button>
  </div>
`;
viewportHost.appendChild(fileMenu);
const fileMenuToggle = fileMenu.querySelector<HTMLButtonElement>(".file-menu-toggle")!;
const fileMenuDropdown = fileMenu.querySelector<HTMLDivElement>(".file-menu-dropdown")!;
const importJsonBtn = fileMenu.querySelector<HTMLButtonElement>('[data-ctrl="import-json"]')!;
const exportJsonBtn = fileMenu.querySelector<HTMLButtonElement>('[data-ctrl="export-json"]')!;
const importInput = document.createElement("input");
importInput.type = "file";
importInput.accept = "application/json";
importInput.style.display = "none";
fileMenu.appendChild(importInput);
let fileMenuOpen = false;
const setFileMenuOpen = (open: boolean) => {
  fileMenuOpen = open;
  fileMenu.classList.toggle("open", open);
  fileMenuToggle.setAttribute("aria-expanded", open ? "true" : "false");
};
setFileMenuOpen(false);
fileMenuToggle.addEventListener("click", (event) => {
  event.stopPropagation();
  setFileMenuOpen(!fileMenuOpen);
});
fileMenuToggle.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setFileMenuOpen(false);
  }
});
fileMenuDropdown.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setFileMenuOpen(false);
    fileMenuToggle.focus();
  }
});
document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;
  if (!fileMenu.contains(target)) {
    setFileMenuOpen(false);
  }
});
importJsonBtn.addEventListener("click", () => {
  setFileMenuOpen(false);
  importInput.click();
});
exportJsonBtn.addEventListener("click", () => {
  setFileMenuOpen(false);
  saveToFile();
});
importInput.addEventListener("change", () => {
  const file = importInput.files?.[0];
  if (file) loadFromFile(file);
  importInput.value = "";
});

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.1, 0);

const transformControls = new TransformControls(camera, renderer.domElement);
const transformControlsToggle = transformControls as TransformControls & { enabled: boolean };
transformControls.setSize(0.75);
scene.add(transformControls.getHelper());

const jointRotationHelper = new THREE.Object3D();
const jointTranslateGroupHelper = new THREE.Object3D();
const jointScaleHelper = new THREE.Object3D();
const jointRotationPrevQuat = new THREE.Quaternion();
const identityQuat = new THREE.Quaternion();
const jointRotationDelta = new THREE.Quaternion();
const jointRotationPrevInverse = new THREE.Quaternion();
const jointTranslatePrevPosition = new THREE.Vector3();
const jointTranslateDelta = new THREE.Vector3();
const jointScalePrevScale = new THREE.Vector3(1, 1, 1);
const jointScaleRatio = new THREE.Vector3();

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

const MASTER_CONTROL_COLOR = 0xff4d6d;
const MASTER_CONTROL_SELECTED_COLOR = 0xffc857;
const MASTER_CONTROL_OPACITY = 0.9;
const MASTER_CONTROL_SELECTED_OPACITY = 1;

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
const jointSelection = new Set<string>();
let transformMode: "translate" | "rotate" | "scale" = "translate";
let transformControlsDragging = false;
let currentFrame = 0;
let isPlaying = false;
let loopPlayback = true;
let playbackCursor = 0;
let lastPlaybackTime = 0;
let cameraPreviewEnabled = true;
let selectionDirty = false;
const dirtyJointIds = new Set<string>();
let videoRuntime: VideoRuntime | null = null;
let rigVisual = buildRig(getProfile(state.rigProfileId));
rigVisual.group.add(jointRotationHelper);
rigVisual.group.add(jointTranslateGroupHelper);
rigVisual.group.add(jointScaleHelper);
let centroids = computeGroupCentroids(getProfile(state.rigProfileId));
let jointChildren = buildJointChildren(getProfile(state.rigProfileId));
let jointDescendantsCache: Record<string, string[]> = {};
let currentRotationDescendants: string[] = [];
const videoPlaneMesh = createVideoPlaneMesh();
const videoAnchor = new THREE.Group();
scene.add(videoAnchor);
videoAnchor.add(videoPlaneMesh);
overlay.update(state.output);
let timelineMarkersDirty = true;
let timelineMarkerCache: number[] = [];
let timelineMarkerFrameCount = -1;
let ui: UIController;
let poseVideoFile: File | null = null;
let poseResult: PoseProcessResult | null = null;

function markTimelineDirty() {
  timelineMarkersDirty = true;
}

function getTimelineMarkerCache(): number[] {
  if (!timelineMarkersDirty) {
    return timelineMarkerCache;
  }
  timelineMarkerCache = collectAllKeyframes();
  timelineMarkersDirty = false;
  return timelineMarkerCache;
}

function collectAllKeyframes(): number[] {
  const frames = new Set<number>();
  const addKeys = (keys?: Key<any>[]) => {
    if (!keys) return;
    keys.forEach((key) => frames.add(key.f));
  };
  const addVec3 = (track?: KeyTrackVec3) => {
    if (!track) return;
    addKeys(track.keysX);
    addKeys(track.keysY);
    addKeys(track.keysZ);
  };
  const anim = state.anim;
  addVec3(anim.rigRoot.pos);
  addVec3(anim.rigRoot.scale);
  addKeys(anim.rigRoot.rot.keys);
  Object.values(anim.groupScales).forEach(addVec3);
  Object.values(anim.jointPositions).forEach(addVec3);
  addVec3(anim.camera.pos);
  addVec3(anim.camera.target);
  addKeys(anim.camera.fov.keys);
  const plane = anim.videoPlane;
  addVec3(plane.transform.pos);
  addVec3(plane.transform.scale);
  addKeys(plane.transform.rot.keys);
  addKeys(plane.timeOffset.keys);
  addKeys(plane.lockToCamera.keys);
  return Array.from(frames).sort((a, b) => a - b);
}

type PoseBounds = { cx: number; cy: number; halfX: number; halfY: number };

function getRestBounds(): PoseBounds {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  Object.values(state.restPose).forEach((joint) => {
    minX = Math.min(minX, joint.x);
    maxX = Math.max(maxX, joint.x);
    minY = Math.min(minY, joint.y);
    maxY = Math.max(maxY, joint.y);
  });
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
}

function worldToNormalized(point: Vec3, bounds: PoseBounds) {
  return {
    x: (point.x - bounds.cx) / bounds.halfX,
    y: (point.y - bounds.cy) / bounds.halfY,
    c: 1
  };
}

function buildExportFrames(): FrameKeypoints2D[] {
  const bounds = getRestBounds();
  const frames: FrameKeypoints2D[] = [];
  const fpsValue = Math.max(1, state.timeline.fps);
  for (let frame = 0; frame < state.timeline.frameCount; frame += 1) {
    const { pose } = evaluatePose(frame);
    const person: Record<string, { x: number; y: number; c: number }> = {};
    Object.entries(pose).forEach(([jointId, vec]) => {
      person[jointId] = worldToNormalized(vec, bounds);
    });
    frames.push({
      frame,
      time: frame / fpsValue,
      persons: [person]
    });
  }
  return frames;
}

function buildJointChildren(profile: RigProfile): Record<string, string[]> {
  const children: Record<string, string[]> = {};
  profile.joints.forEach((joint) => {
    children[joint.id] = [];
  });
  profile.bones.forEach(([parent, child]) => {
    if (!children[parent]) {
      children[parent] = [];
    }
    if (!children[child]) {
      children[child] = [];
    }
    children[parent].push(child);
  });
  return children;
}

function getJointDescendants(jointId: string): string[] {
  if (jointDescendantsCache[jointId]) {
    return jointDescendantsCache[jointId];
  }
  const result: string[] = [];
  const stack: string[] = [...(jointChildren[jointId] ?? [])];
  const visited = new Set<string>();
  while (stack.length) {
    const child = stack.pop()!;
    if (visited.has(child)) continue;
    visited.add(child);
    result.push(child);
    const nextChildren = jointChildren[child];
    if (nextChildren) {
      stack.push(...nextChildren);
    }
  }
  jointDescendantsCache[jointId] = result;
  return result;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const jointRotationTemp = new THREE.Vector3();
const jointRotationPivot = new THREE.Vector3();

const isTextInputTarget = (target: EventTarget | null): boolean => {
  if (!target) return false;
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  ) {
    return true;
  }
  return target instanceof HTMLElement && target.isContentEditable;
};

const depthBrushState = {
  active: false,
  pointerId: -1,
  jointId: null as string | null,
  startY: 0,
  startPos: new THREE.Vector3()
};
const depthBrushDirection = new THREE.Vector3();
const depthBrushOffset = new THREE.Vector3();

const SCALE_MIN_FACTOR = 0.1;
const SCALE_MAX_FACTOR = 5;
const scaleTempVec = new THREE.Vector3();
const scaleManualPivotLocal = new THREE.Vector3();

const timelineUI = createTimelineBar(app);
ui = buildPanel(panel, timelineUI);
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
const handleGlobalPointerEnd = (event: PointerEvent) => {
  if (depthBrushState.active && event.pointerId === depthBrushState.pointerId) {
    endDepthBrush(event);
  }
};
window.addEventListener("pointerup", handleGlobalPointerEnd);
window.addEventListener("pointercancel", handleGlobalPointerEnd);
window.addEventListener("blur", () => {
  endDepthBrush();
});

transformControls.addEventListener("dragging-changed", (event: TransformControlsEventMap["dragging-changed"]) => {
  const isDragging = Boolean(event.value);
  transformControlsDragging = isDragging;
  controls.enabled = !isDragging;
  if (!isDragging) {
    syncJointTransformHelpers();
  }
});

transformControls.addEventListener("objectChange", () => {
  if (!selection) return;
  let changed = false;
  if (selection.kind === "joint") {
    if (transformMode === "rotate") {
      changed = jointSelection.size > 1 ? applyMultiJointRotationDelta() : applyJointRotationDelta();
    } else if (transformMode === "translate") {
      if (jointSelection.size > 1) {
        changed = applyMultiJointTranslationDelta();
      } else {
        dirtyJointIds.add(selection.id);
        selectionDirty = true;
        refreshBoneGeometryFromMeshes();
        changed = true;
      }
    } else if (transformMode === "scale") {
      changed = applyTargetsScaleDelta(getJointSelectionSnapshot());
    }
  } else if (selection.kind === "group") {
    const targets = getGroupJointIds(selection.id);
    if (transformMode === "rotate") {
      changed = applyTargetsRotationDelta(targets);
    } else if (transformMode === "translate") {
      changed = applyTargetsTranslationDelta(targets);
    } else if (transformMode === "scale") {
      changed = applyTargetsScaleDelta(targets);
    }
  } else {
    selectionDirty = true;
    changed = true;
  }
  if (!changed) return;
  if (state.autoKey) {
    commitSelectionKey();
    selectionDirty = false;
  } else {
    ui.showStatus("Transform pending — click Key Selected to store");
  }
});

const viewportKeyHandler = (event: KeyboardEvent) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTextInputTarget(event.target)) return;
  const key = event.key.toLowerCase();
  if (key === "escape") {
    if (selection?.kind === "joint" || jointSelection.size) {
      event.preventDefault();
      deselectAllJoints();
    } else if (selection?.kind === "group") {
      event.preventDefault();
      selection = null;
      updateSelection();
    }
    return;
  }
  if (key === "g") {
    selectRigRoot();
    return;
  }
  if (key === "w") {
    event.preventDefault();
    setTransformMode("translate");
    return;
  }
  if (key === "e") {
    event.preventDefault();
    setTransformMode("rotate");
    return;
  }
  if (key === "s") {
    event.preventDefault();
    setTransformMode("scale");
    return;
  }
};
window.addEventListener("keydown", viewportKeyHandler);

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
  const masterRadius = computeMasterControlRadius(profile);
  const masterGeo = new THREE.RingGeometry(Math.max(masterRadius - 0.04, 0.01), masterRadius, 48, 1);
  const masterMat = new THREE.MeshBasicMaterial({
    color: MASTER_CONTROL_COLOR,
    transparent: true,
    opacity: MASTER_CONTROL_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false
  });
  const masterControl = new THREE.Mesh(masterGeo, masterMat);
  masterControl.name = "masterControl";
  masterControl.rotation.x = -Math.PI / 2;
  group.add(masterControl);
  scene.add(group);
  return {
    group,
    joints,
    jointMaterials,
    bones: profile.bones.slice(),
    boneGeometry,
    masterControl,
    masterControlMaterial: masterMat
  };
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

function computeMasterControlRadius(profile: RigProfile): number {
  let minY = Infinity;
  for (const pos of Object.values(profile.restPose)) {
    if (!pos) continue;
    minY = Math.min(minY, pos.y);
  }
  const footThreshold = Number.isFinite(minY) ? minY + 0.25 : Infinity;
  let footRadius = 0;
  let fallbackRadius = 0;
  for (const pos of Object.values(profile.restPose)) {
    if (!pos) continue;
    const horizontal = Math.hypot(pos.x, pos.z);
    if (pos.y <= footThreshold) {
      footRadius = Math.max(footRadius, horizontal);
    }
    fallbackRadius = Math.max(fallbackRadius, horizontal);
  }
  const base = footRadius > 0 ? footRadius : fallbackRadius || 0.35;
  return THREE.MathUtils.clamp(base + 0.1, 0.35, 1.25);
}

function onPointerDown(event: PointerEvent) {
  if (event.altKey && selection?.kind === "joint") {
    if (beginDepthBrush(event)) {
      return;
    }
  }
  if (depthBrushState.active) return;

  const jointId = pickJointUnderPointer(event);
  const toggleSelection = event.metaKey || event.ctrlKey;
  const additiveSelection = event.shiftKey && !toggleSelection;
  if (jointId) {
    const alreadySelected = selection?.kind === "joint" && jointSelection.has(jointId);
    const shouldModifySelection = toggleSelection || additiveSelection || !alreadySelected || selection?.kind !== "joint";
    if (shouldModifySelection) {
      selectJoint(jointId, { additive: additiveSelection, toggle: toggleSelection });
      return;
    }
  }

  if (!toggleSelection && !additiveSelection && pickMasterControlUnderPointer(event)) {
    event.preventDefault();
    selectRigRoot();
    return;
  }

}

function onPointerMove(event: PointerEvent) {
  if (depthBrushState.active && depthBrushState.pointerId === event.pointerId) {
    updateDepthBrush(event);
  }
}

function onPointerUp(event: PointerEvent) {
  if (depthBrushState.active && depthBrushState.pointerId === event.pointerId) {
    endDepthBrush(event);
  }
}

function beginDepthBrush(event: PointerEvent): boolean {
  if (!selection || selection.kind !== "joint" || jointSelection.size > 1) return false;
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
  dirtyJointIds.add(depthBrushState.jointId);
  selectionDirty = true;
  if (state.autoKey) {
    commitSelectionKey();
    selectionDirty = false;
  } else {
    ui.showStatus("Transform pending — click Key Selected to store");
  }
  refreshBoneGeometryFromMeshes();
  syncJointTransformHelpers();
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
  syncJointTransformHelpers();
}

function updatePointerRay(event: PointerEvent) {
  const rect = renderer.domElement.getBoundingClientRect();
  const width = rect.width || 1;
  const height = rect.height || 1;
  pointer.x = ((event.clientX - rect.left) / width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pickJointUnderPointer(event: PointerEvent): string | null {
  updatePointerRay(event);
  const targets = Object.values(rigVisual.joints);
  const intersects = raycaster.intersectObjects(targets, false);
  if (!intersects.length) return null;
  return intersects[0].object.name;
}

function pickMasterControlUnderPointer(event: PointerEvent): boolean {
  updatePointerRay(event);
  const control = rigVisual.masterControl;
  if (!control.visible) return false;
  return raycaster.intersectObject(control, false).length > 0;
}

type JointSelectionOptions = {
  additive?: boolean;
  toggle?: boolean;
};

function selectJoint(jointId: string, options?: JointSelectionOptions) {
  const id = jointId;
  let changed = false;
  if (options?.toggle) {
    if (jointSelection.has(id)) {
      jointSelection.delete(id);
    } else {
      jointSelection.add(id);
    }
    changed = true;
  } else if (options?.additive) {
    if (!jointSelection.has(id)) {
      jointSelection.add(id);
      changed = true;
    }
  } else {
    if (jointSelection.size !== 1 || !jointSelection.has(id)) {
      changed = true;
    }
    jointSelection.clear();
    jointSelection.add(id);
  }

  if (!jointSelection.size) {
    const hadSelection = Boolean(selection);
    selection = null;
    if (changed || hadSelection) {
      updateSelection();
    }
    return;
  }

  const preferred =
    jointSelection.has(id) || !selection || selection.kind !== "joint" || !jointSelection.has(selection.id)
      ? (jointSelection.has(id) ? id : jointSelection.values().next().value)
      : selection.id;
  const prevKey = selection?.kind === "joint" ? selection.id : null;
  selection = preferred ? { kind: "joint", id: preferred } : null;
  if (changed || preferred !== prevKey) {
    updateSelection();
  }
}

function clearJointSelection() {
  jointSelection.clear();
}

function deselectAllJoints() {
  const hadJointSelection = jointSelection.size > 0;
  const hadJointFocus = selection?.kind === "joint";
  if (!hadJointSelection && !hadJointFocus) {
    return;
  }
  jointSelection.clear();
  if (hadJointFocus) {
    selection = null;
  }
  updateSelection();
}

function getJointSelectionSnapshot(): string[] {
  if (!selection || selection.kind !== "joint") return [];
  if (jointSelection.size) return Array.from(jointSelection);
  return [selection.id];
}

function getSelectionJointTargets(): string[] {
  if (!selection) return [];
  if (selection.kind === "joint") return getJointSelectionSnapshot();
  if (selection.kind === "group") return getGroupJointIds(selection.id);
  return [];
}

function computePivotFromTargets(targets: string[], out: THREE.Vector3): boolean {
  out.set(0, 0, 0);
  let count = 0;
  for (const jointId of targets) {
    const mesh = rigVisual.joints[jointId];
    if (!mesh) continue;
    out.add(mesh.position);
    count += 1;
  }
  if (!count) return false;
  out.multiplyScalar(1 / count);
  return true;
}

function refreshScaleUI() {
  if (!ui) return;
  const visible =
    transformMode === "scale" &&
    selection &&
    (selection.kind === "joint" || selection.kind === "group");
  ui.updateScaleFactor(visible ? 1 : null);
}

function resetJointScaleHelper() {
  jointScaleHelper.quaternion.identity();
  jointScaleHelper.rotation.set(0, 0, 0);
  jointScaleHelper.scale.set(1, 1, 1);
  jointScalePrevScale.set(1, 1, 1);
}

function prepareJointScaleHelper(targets: string[]): boolean {
  if (!targets.length) return false;
  if (!computePivotFromTargets(targets, jointScaleHelper.position)) return false;
  resetJointScaleHelper();
  return true;
}

function scaleSelectionByRatio(factor: number): boolean {
  if (!selection || (selection.kind !== "joint" && selection.kind !== "group")) return false;
  if (transformMode !== "scale") return false;
  if (!Number.isFinite(factor) || factor <= 0) return false;
  const clamped = THREE.MathUtils.clamp(factor, SCALE_MIN_FACTOR, SCALE_MAX_FACTOR);
  const targets = getSelectionJointTargets();
  if (!targets.length) return false;
  if (!computePivotFromTargets(targets, scaleManualPivotLocal)) return false;
  let changed = false;
  for (const jointId of targets) {
    const mesh = rigVisual.joints[jointId];
    if (!mesh) continue;
    scaleTempVec.copy(mesh.position).sub(scaleManualPivotLocal).multiplyScalar(clamped).add(scaleManualPivotLocal);
    mesh.position.copy(scaleTempVec);
    dirtyJointIds.add(jointId);
    changed = true;
  }
  if (changed) {
    selectionDirty = true;
    refreshBoneGeometryFromMeshes();
  }
  return changed;
}

function setTransformMode(mode: "translate" | "rotate" | "scale"): boolean {
  const changed = transformMode !== mode;
  if (changed) {
    transformMode = mode;
    if (selection) {
      if (selection.kind === "joint") {
        attachJointTransform(selection.id);
      } else if (selection.kind === "group") {
        attachGroupTransform();
      } else if (selection.kind === "rigRoot" || selection.kind === "videoPlane") {
        transformControls.setMode(mode);
      }
    }
    if (ui) {
      ui.updateTransformMode();
    }
  }
  refreshScaleUI();
  return true;
}

function selectRigRoot() {
  clearJointSelection();
  selection = { kind: "rigRoot" };
  updateSelection();
}

function selectVideoPlane() {
  clearJointSelection();
  selection = { kind: "videoPlane" };
  updateSelection();
}

function updateSelection() {
  selectionDirty = false;
  dirtyJointIds.clear();
  transformControls.detach();
  if (!selection || selection.kind !== "joint") {
    clearJointSelection();
  }
  for (const [jointId, mat] of Object.entries(rigVisual.jointMaterials)) {
    mat.color.set(jointSelection.has(jointId) ? 0xffc857 : 0x4cc9f0);
  }
  refreshMasterControlVisual();
  if (!selection) {
    ui.updateSelection();
    refreshScaleUI();
    return;
  }
  if (selection.kind === "joint") {
    attachJointTransform(selection.id);
  } else if (selection.kind === "group") {
    attachGroupTransform();
  } else if (selection.kind === "rigRoot") {
    transformControls.attach(rigVisual.group);
    transformControls.setMode(transformMode);
  } else if (selection.kind === "videoPlane") {
    transformControls.attach(videoPlaneMesh);
    transformControls.setMode(transformMode);
  }
  ui.updateTransformMode();
  ui.updateSelection();
  ui.updateEaseControls();
  refreshScaleUI();
}

function refreshMasterControlVisual() {
  const mat = rigVisual.masterControlMaterial;
  const isSelected = selection?.kind === "rigRoot";
  mat.color.set(isSelected ? MASTER_CONTROL_SELECTED_COLOR : MASTER_CONTROL_COLOR);
  mat.opacity = isSelected ? MASTER_CONTROL_SELECTED_OPACITY : MASTER_CONTROL_OPACITY;
}

function attachJointTransform(jointId: string) {
  if (jointSelection.size > 1) {
    attachMultiJointTransform();
    return;
  }
  const mesh = rigVisual.joints[jointId];
  if (!mesh) {
    transformControls.detach();
    currentRotationDescendants = [];
    return;
  }
  if (transformMode === "rotate") {
    prepareJointRotationHelper(mesh, jointId);
    transformControls.attach(jointRotationHelper);
    transformControls.setMode("rotate");
  } else if (transformMode === "translate") {
    transformControls.attach(mesh);
    transformControls.setMode("translate");
    currentRotationDescendants = [];
  } else if (transformMode === "scale") {
    const targets = getJointSelectionSnapshot();
    if (!prepareJointScaleHelper(targets)) {
      transformControls.detach();
      currentRotationDescendants = [];
      return;
    }
    transformControls.attach(jointScaleHelper);
    transformControls.setMode("scale");
    currentRotationDescendants = [];
  } else {
    transformControls.detach();
    currentRotationDescendants = [];
  }
}

function attachMultiJointTransform() {
  const targets = getJointSelectionSnapshot();
  if (targets.length <= 1) {
    if (selection?.kind === "joint") {
      attachJointTransform(selection.id);
    } else {
      transformControls.detach();
    }
    return;
  }
  if (transformMode === "rotate") {
    if (!prepareMultiJointRotationHelper(targets)) {
      transformControls.detach();
      return;
    }
    transformControls.attach(jointRotationHelper);
    transformControls.setMode("rotate");
  } else if (transformMode === "translate") {
    if (!prepareJointTranslateGroupHelper(targets)) {
      transformControls.detach();
      return;
    }
    transformControls.attach(jointTranslateGroupHelper);
    transformControls.setMode("translate");
  } else if (transformMode === "scale") {
    if (!prepareJointScaleHelper(targets)) {
      transformControls.detach();
      return;
    }
    transformControls.attach(jointScaleHelper);
    transformControls.setMode("scale");
  } else {
    transformControls.detach();
  }
  currentRotationDescendants = [];
}

function attachGroupTransform() {
  if (!selection || selection.kind !== "group") {
    transformControls.detach();
    return;
  }
  const targets = getGroupJointIds(selection.id);
  if (!targets.length) {
    transformControls.detach();
    currentRotationDescendants = [];
    return;
  }
  if (transformMode === "rotate") {
    if (!prepareMultiJointRotationHelper(targets)) {
      transformControls.detach();
      return;
    }
    transformControls.attach(jointRotationHelper);
    transformControls.setMode("rotate");
  } else if (transformMode === "translate") {
    if (!prepareJointTranslateGroupHelper(targets)) {
      transformControls.detach();
      return;
    }
    transformControls.attach(jointTranslateGroupHelper);
    transformControls.setMode("translate");
  } else if (transformMode === "scale") {
    if (!prepareJointScaleHelper(targets)) {
      transformControls.detach();
      return;
    }
    transformControls.attach(jointScaleHelper);
    transformControls.setMode("scale");
  } else {
    transformControls.detach();
  }
  currentRotationDescendants = [];
}

function prepareJointRotationHelper(mesh: THREE.Mesh, jointId: string) {
  jointRotationHelper.position.copy(mesh.position);
  jointRotationHelper.quaternion.identity();
  jointRotationHelper.rotation.set(0, 0, 0);
  jointRotationPrevQuat.identity();
  currentRotationDescendants = getJointDescendants(jointId);
}

function prepareMultiJointRotationHelper(targets: string[]): boolean {
  if (!targets.length) return false;
  if (!computePivotFromTargets(targets, jointRotationHelper.position)) return false;
  jointRotationHelper.quaternion.identity();
  jointRotationHelper.rotation.set(0, 0, 0);
  jointRotationPrevQuat.identity();
  currentRotationDescendants = [];
  return true;
}

function prepareJointTranslateGroupHelper(targets: string[]): boolean {
  if (!targets.length) return false;
  if (!computePivotFromTargets(targets, jointTranslateGroupHelper.position)) return false;
  jointTranslateGroupHelper.quaternion.identity();
  jointTranslateGroupHelper.rotation.set(0, 0, 0);
  jointTranslatePrevPosition.copy(jointTranslateGroupHelper.position);
  return true;
}

function syncJointTransformHelpers() {
  if (transformControlsDragging) return;
  if (!selection) return;
  if (transformMode === "rotate") {
    if (selection.kind === "joint") {
      const targets = getJointSelectionSnapshot();
      if (!targets.length) return;
      if (targets.length > 1) {
        computePivotFromTargets(targets, jointRotationHelper.position);
      } else {
        const mesh = rigVisual.joints[selection.id];
        if (!mesh) return;
        jointRotationHelper.position.copy(mesh.position);
      }
    } else if (selection.kind === "group") {
      const targets = getGroupJointIds(selection.id);
      if (!targets.length) return;
      computePivotFromTargets(targets, jointRotationHelper.position);
    }
  } else if (transformMode === "translate") {
    if (selection.kind === "joint" && jointSelection.size > 1) {
      const targets = getJointSelectionSnapshot();
      if (!targets.length) return;
      if (computePivotFromTargets(targets, jointTranslateGroupHelper.position)) {
        jointTranslatePrevPosition.copy(jointTranslateGroupHelper.position);
      }
    } else if (selection.kind === "group") {
      const targets = getGroupJointIds(selection.id);
      if (!targets.length) return;
      if (computePivotFromTargets(targets, jointTranslateGroupHelper.position)) {
        jointTranslatePrevPosition.copy(jointTranslateGroupHelper.position);
      }
    }
  } else if (transformMode === "scale") {
    if (selection.kind === "joint") {
      const targets = getJointSelectionSnapshot();
      if (!targets.length) return;
      if (computePivotFromTargets(targets, jointScaleHelper.position)) {
        resetJointScaleHelper();
      }
    } else if (selection.kind === "group") {
      const targets = getGroupJointIds(selection.id);
      if (!targets.length) return;
      if (computePivotFromTargets(targets, jointScaleHelper.position)) {
        resetJointScaleHelper();
      }
    }
  }
}

function refreshBoneGeometryFromMeshes() {
  const attr = rigVisual.boneGeometry.getAttribute("position") as THREE.BufferAttribute;
  let idx = 0;
  for (const [a, b] of rigVisual.bones) {
    const meshA = rigVisual.joints[a];
    const meshB = rigVisual.joints[b];
    if (!meshA || !meshB) continue;
    attr.setXYZ(idx, meshA.position.x, meshA.position.y, meshA.position.z);
    idx += 1;
    attr.setXYZ(idx, meshB.position.x, meshB.position.y, meshB.position.z);
    idx += 1;
  }
  attr.needsUpdate = true;
}

function applyJointRotationDelta(): boolean {
  if (!selection || selection.kind !== "joint") return false;
  if (transformMode !== "rotate") return false;
  const mesh = rigVisual.joints[selection.id];
  if (!mesh) return false;
  const currentQuat = jointRotationHelper.quaternion;
  const prev = jointRotationPrevQuat;
  jointRotationPrevInverse.copy(prev).invert();
  jointRotationDelta.copy(currentQuat).multiply(jointRotationPrevInverse);
  if (jointRotationDelta.angleTo(identityQuat) < 1e-4) {
    return false;
  }
  prev.copy(currentQuat);
  jointRotationPivot.copy(mesh.position);
  let changed = false;
  for (const jointId of currentRotationDescendants) {
    const child = rigVisual.joints[jointId];
    if (!child) continue;
    jointRotationTemp.copy(child.position).sub(jointRotationPivot);
    jointRotationTemp.applyQuaternion(jointRotationDelta);
    child.position.copy(jointRotationPivot).add(jointRotationTemp);
    dirtyJointIds.add(jointId);
    changed = true;
  }
  if (changed) {
    selectionDirty = true;
    refreshBoneGeometryFromMeshes();
  }
  return changed;
}

function applyTargetsTranslationDelta(targets: string[]): boolean {
  if (transformMode !== "translate") return false;
  if (!targets.length) return false;
  jointTranslateDelta.copy(jointTranslateGroupHelper.position).sub(jointTranslatePrevPosition);
  if (jointTranslateDelta.lengthSq() < 1e-10) {
    return false;
  }
  jointTranslatePrevPosition.copy(jointTranslateGroupHelper.position);
  let changed = false;
  targets.forEach((jointId) => {
    const mesh = rigVisual.joints[jointId];
    if (!mesh) return;
    mesh.position.add(jointTranslateDelta);
    dirtyJointIds.add(jointId);
    changed = true;
  });
  if (changed) {
    selectionDirty = true;
    refreshBoneGeometryFromMeshes();
  }
  return changed;
}

function applyTargetsRotationDelta(targets: string[]): boolean {
  if (transformMode !== "rotate") return false;
  if (!targets.length) return false;
  const currentQuat = jointRotationHelper.quaternion;
  const prev = jointRotationPrevQuat;
  jointRotationPrevInverse.copy(prev).invert();
  jointRotationDelta.copy(currentQuat).multiply(jointRotationPrevInverse);
  if (jointRotationDelta.angleTo(identityQuat) < 1e-4) {
    return false;
  }
  prev.copy(currentQuat);
  let changed = false;
  targets.forEach((jointId) => {
    const pivotMesh = rigVisual.joints[jointId];
    if (!pivotMesh) return;
    jointRotationPivot.copy(pivotMesh.position);
    const descendants = getJointDescendants(jointId);
    descendants.forEach((childId) => {
      const child = rigVisual.joints[childId];
      if (!child) return;
      jointRotationTemp.copy(child.position).sub(jointRotationPivot);
      jointRotationTemp.applyQuaternion(jointRotationDelta);
      child.position.copy(jointRotationPivot).add(jointRotationTemp);
      dirtyJointIds.add(childId);
      changed = true;
    });
  });
  if (changed) {
    selectionDirty = true;
    refreshBoneGeometryFromMeshes();
  }
  return changed;
}

function applyTargetsScaleDelta(targets: string[]): boolean {
  if (transformMode !== "scale") return false;
  if (!targets.length) return false;
  const current = jointScaleHelper.scale;
  const limitComponent = (value: number) => {
    if (!Number.isFinite(value)) return 1;
    const magnitude = Math.min(Math.max(Math.abs(value), SCALE_MIN_FACTOR), SCALE_MAX_FACTOR);
    return value < 0 ? -magnitude : magnitude;
  };
  current.set(limitComponent(current.x), limitComponent(current.y), limitComponent(current.z));
  const prev = jointScalePrevScale;
  const safeComponent = (currentValue: number, prevValue: number) => {
    const denom = Math.abs(prevValue) < 1e-6 ? (prevValue < 0 ? -1 : 1) : prevValue;
    const ratio = currentValue / denom;
    return Number.isFinite(ratio) ? ratio : 1;
  };
  jointScaleRatio.set(
    safeComponent(current.x, prev.x),
    safeComponent(current.y, prev.y),
    safeComponent(current.z, prev.z)
  );
  if (
    Math.abs(jointScaleRatio.x - 1) < 1e-4 &&
    Math.abs(jointScaleRatio.y - 1) < 1e-4 &&
    Math.abs(jointScaleRatio.z - 1) < 1e-4
  ) {
    return false;
  }
  prev.copy(current);
  const pivot = jointScaleHelper.position;
  let changed = false;
  targets.forEach((jointId) => {
    const mesh = rigVisual.joints[jointId];
    if (!mesh) return;
    scaleTempVec.copy(mesh.position).sub(pivot);
    scaleTempVec.multiply(jointScaleRatio);
    mesh.position.copy(pivot).add(scaleTempVec);
    dirtyJointIds.add(jointId);
    changed = true;
  });
  if (changed) {
    selectionDirty = true;
    refreshBoneGeometryFromMeshes();
  }
  return changed;
}

function applyMultiJointTranslationDelta(): boolean {
  if (!selection || selection.kind !== "joint") return false;
  if (jointSelection.size <= 1) return false;
  return applyTargetsTranslationDelta(getJointSelectionSnapshot());
}

function applyMultiJointRotationDelta(): boolean {
  if (!selection || selection.kind !== "joint") return false;
  if (jointSelection.size <= 1) return false;
  return applyTargetsRotationDelta(getJointSelectionSnapshot());
}

function commitSelectionKey() {
  if (!selection) return;
  const frame = currentFrame;
  if (selection.kind === "joint" || selection.kind === "group") {
    const fallbackTargets =
      selection.kind === "joint" ? getJointSelectionSnapshot() : getGroupJointIds(selection.id);
    const targetIds = dirtyJointIds.size ? Array.from(dirtyJointIds) : fallbackTargets;
    if (!targetIds.length) return;
    targetIds.forEach((jointId) => {
      const mesh = rigVisual.joints[jointId];
      if (!mesh) return;
      const track = getJointTrack(state, jointId);
      setVec3Key(track, frame, { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z });
    });
    dirtyJointIds.clear();
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
  markTimelineDirty();
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
  syncJointTransformHelpers();
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
  ui.updateTimeline();
  refreshScaleUI();
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
  refreshScaleUI();
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
    getJointSelectionSnapshot().forEach((jointId) => {
      pushVec3(getJointTrack(state, jointId));
    });
    return targets;
  }
  if (selection.kind === "group") {
    getGroupJointIds(selection.id).forEach((jointId) => {
      pushVec3(getJointTrack(state, jointId));
    });
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

function stepFrame(delta: number) {
  setCurrentFrame(currentFrame + delta);
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

function getGroupJointIds(groupId: string): string[] {
  const definition = state.rigDef.groups[groupId];
  if (!definition) return [];
  return definition.joints.slice();
}

function setGroupScaleValue(groupId: string, value: Vec3): Vec3 {
  const snapped = {
    x: clampGroupScaleValue(value.x),
    y: clampGroupScaleValue(value.y),
    z: clampGroupScaleValue(value.z)
  };
  const track = getGroupScaleTrack(state, groupId);
  setVec3Key(track, currentFrame, snapped);
  markTimelineDirty();
  requestPoseUpdate();
  return snapped;
}

function switchProfile(id: RigProfileId) {
  if (id === state.rigProfileId) return;
  stopPlayback();
  const newState = createEditorState(id);
  state = newState;
  markTimelineDirty();
  rigVisual.group.remove(jointRotationHelper);
  rigVisual.group.remove(jointTranslateGroupHelper);
  rigVisual.group.remove(jointScaleHelper);
  disposeRigVisual(rigVisual);
  const profile = getProfile(id);
  rigVisual = buildRig(profile);
  rigVisual.group.add(jointRotationHelper);
  rigVisual.group.add(jointTranslateGroupHelper);
  rigVisual.group.add(jointScaleHelper);
  centroids = computeGroupCentroids(profile);
  jointChildren = buildJointChildren(profile);
  jointDescendantsCache = {};
  currentRotationDescendants = [];
  clearJointSelection();
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
      markTimelineDirty();
      stopPlayback();
      rigVisual.group.remove(jointRotationHelper);
      rigVisual.group.remove(jointTranslateGroupHelper);
      rigVisual.group.remove(jointScaleHelper);
      disposeRigVisual(rigVisual);
      const profile = getProfile(state.rigProfileId);
      rigVisual = buildRig(profile);
      rigVisual.group.add(jointRotationHelper);
      rigVisual.group.add(jointTranslateGroupHelper);
      rigVisual.group.add(jointScaleHelper);
      centroids = computeGroupCentroids(profile);
      jointChildren = buildJointChildren(profile);
      jointDescendantsCache = {};
      currentRotationDescendants = [];
      clearJointSelection();
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

function buildPanel(container: HTMLElement, timelineBar: TimelineBarController): UIController {
  container.innerHTML = `
    <section class="sequence-section">
      <header>Sequence Settings</header>
      <div class="field-row">
        <label>Width <input type="number" data-ctrl="out-width" min="1" /></label>
        <label>Height <input type="number" data-ctrl="out-height" min="1" /></label>
      </div>
      <div class="field-row">
        <label>Pixel Aspect <input type="number" step="0.01" data-ctrl="out-pa" /></label>
        <label>Render Scale <input type="number" step="0.1" data-ctrl="out-scale" /></label>
      </div>
      <label>Overscan % <input type="number" step="0.5" data-ctrl="out-overscan" /></label>
      <div class="sequence-subgroup">
        <div class="sequence-subgroup-title">Timeline</div>
        <div class="field-row">
          <label>FPS <input type="number" data-ctrl="fps" min="1" /></label>
          <label>Frames <input type="number" data-ctrl="frames" min="1" /></label>
        </div>
      </div>
      <div class="sequence-subgroup">
        <div class="sequence-subgroup-title">Camera</div>
        <label>FOV <input type="number" step="0.1" data-ctrl="camera-fov" /></label>
        <div class="button-row sequence-camera-buttons">
          <button data-ctrl="camera-preview">Preview</button>
          <button data-ctrl="camera-key">Key Camera</button>
        </div>
      </div>
      <div class="guides" data-ctrl="guides"></div>
      <div class="status" data-ctrl="status">Ready.</div>
    </section>
    <section>
      <header>Rig</header>
      <label>Profile
        <select data-ctrl="profile"></select>
      </label>
      <div class="button-row">
        <button data-ctrl="select-rig">Select Master Joint</button>
      </div>
    </section>
    <section class="video-plane-section">
      <header>Video Plane</header>
      <div class="button-row video-plane-select-row">
        <button data-ctrl="select-video">Select Video Plane</button>
      </div>
      <input class="video-plane-file" type="file" accept="video/*" data-ctrl="video-input" />
      <div class="button-row video-plane-action-row">
        <button data-ctrl="match-video">Match Video</button>
        <button data-ctrl="clear-video">Clear</button>
      </div>
      <label class="video-plane-lock"><span>Lock to camera</span><input type="checkbox" data-ctrl="lock-video" /></label>
      <label class="video-plane-offset">
        <span>Time Offset (s)</span>
        <input
          type="number"
          step="0.05"
          data-ctrl="video-offset"
          title="Shift the video playback earlier or later so it lines up with your poses."
        />
      </label>
    </section>
    <section class="pose-processing-section">
      <header>Pose Processing</header>
      <label class="pose-file-input">
        <span>Video Clip</span>
        <input type="file" accept="video/*" data-ctrl="pose-video" />
      </label>
      <div class="field-row">
        <label>Backend
          <select data-ctrl="pose-backend">
            <option value="hf">HF (ViTPose)</option>
            <option value="mmpose">MMPose (DWPose)</option>
          </select>
        </label>
        <label>Model
          <select data-ctrl="pose-model">
            <option value="vitpose">ViTPose</option>
            <option value="dwpose">DWPose</option>
          </select>
        </label>
      </div>
      <div class="field-row pose-variant-row" data-ctrl="pose-variant-row">
        <label>ViTPose Variant
          <select data-ctrl="pose-vitpose-variant">
            <option value="base-simple">Base (17 body joints)</option>
            <option value="l-wholebody">L WholeBody</option>
            <option value="l-wholebody-onnx">L WholeBody (ONNX)</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label>Device
          <select data-ctrl="pose-device">
            <option value="cpu">CPU</option>
            <option value="cuda">CUDA</option>
          </select>
        </label>
        <label>Person Mode
          <select data-ctrl="pose-person">
            <option value="single">Single</option>
            <option value="multi">Multi</option>
          </select>
        </label>
      </div>
      <div class="field-row">
        <label>Target FPS <input type="number" min="1" value="24" data-ctrl="pose-fps" /></label>
        <label>Resize W <input type="number" min="0" placeholder="auto" data-ctrl="pose-resize-w" /></label>
        <label>Resize H <input type="number" min="0" placeholder="auto" data-ctrl="pose-resize-h" /></label>
      </div>
      <div class="field-row">
        <label>Smooth <input type="number" min="0" max="1" step="0.1" value="0.6" data-ctrl="pose-smooth" /></label>
        <label class="pose-lift-toggle"><span>3D Lift</span><input type="checkbox" data-ctrl="pose-lift" checked /></label>
      </div>
      <div class="button-row pose-processing-actions">
        <button data-ctrl="pose-analyze">Analyze</button>
        <button data-ctrl="pose-insert" disabled>Insert @ Playhead</button>
        <button data-ctrl="pose-replace" disabled>Replace Timeline</button>
      </div>
      <progress data-ctrl="pose-progress" max="1" hidden></progress>
      <div class="pose-status" data-ctrl="pose-status">Select a clip and click Analyze.</div>
    </section>
    <section class="pose-export-section">
      <header>Pose Export</header>
      <label>Output Path
        <input type="text" data-ctrl="pose-export-path" value="exports/skeleton.mp4" />
      </label>
      <div class="button-row">
        <button data-ctrl="pose-export">Export Skeleton MP4</button>
      </div>
      <div class="pose-export-status" data-ctrl="pose-export-status"></div>
    </section>
    <section>
      <header>Animation</header>
      <div class="button-row">
        <button data-ctrl="toggle-autokey"></button>
        <button data-ctrl="key-selection" disabled>Set Manual Key</button>
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
    <section class="transform-section">
      <header>Transform</header>
      <div class="button-row" data-ctrl="transform-modes">
        <button data-mode="translate">Move</button>
        <button data-mode="rotate">Rotate</button>
        <button data-mode="scale">Scale</button>
      </div>
      <div class="scale-readout" data-ctrl="scale-readout" hidden>
        <span>Scale Δ</span>
        <div class="scale-value">
          <input type="number" step="0.01" min="0.1" data-ctrl="scale-value" value="1.00" />
          <span aria-hidden="true">×</span>
        </div>
      </div>
      <div class="selection-label" data-ctrl="selection-label">No selection</div>
    </section>
    <section>
      <header>Joints</header>
      <div class="joint-list" data-ctrl="joint-list"></div>
    </section>
    <section>
      <header>Groups</header>
      <div class="group-scale-list" data-ctrl="group-scales"></div>
    </section>
  `;

  const toggleSectionState = (section: HTMLElement, collapsed?: boolean) => {
    const targetState = collapsed ?? !section.classList.contains("collapsed");
    section.classList.toggle("collapsed", targetState);
    const header = section.querySelector<HTMLElement>("header");
    if (header) {
      header.setAttribute("aria-expanded", targetState ? "false" : "true");
    }
  };

  container.querySelectorAll<HTMLElement>("section > header").forEach((header) => {
    const section = header.parentElement as HTMLElement | null;
    if (!section) return;
    header.setAttribute("role", "button");
    header.setAttribute("aria-expanded", "true");
    header.tabIndex = 0;
    header.addEventListener("click", () => toggleSectionState(section));
    header.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleSectionState(section);
      }
    });
  });

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
  fpsInput.addEventListener("change", () => setTimelineValue("fps", parseFloat(fpsInput.value)));
  framesInput.addEventListener("change", () => setTimelineValue("frameCount", parseInt(framesInput.value, 10)));

  const autoKeyBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="toggle-autokey"]')!;
  const manualKeyBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="key-selection"]')!;
  autoKeyBtn.addEventListener("click", toggleAutoKey);
  manualKeyBtn.addEventListener("click", commitSelectionKey);

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
  const scaleReadout = container.querySelector<HTMLDivElement>('[data-ctrl="scale-readout"]')!;
  const scaleValueInput = container.querySelector<HTMLInputElement>('[data-ctrl="scale-value"]')!;
  scaleValueInput.addEventListener("change", () => {
    const nextValue = parseFloat(scaleValueInput.value);
    if (!Number.isFinite(nextValue)) {
      scaleValueInput.value = "1.00";
      return;
    }
    const applied = scaleSelectionByRatio(nextValue);
    scaleValueInput.value = "1.00";
    if (!applied) {
      return;
    }
    if (state.autoKey) {
      commitSelectionKey();
      selectionDirty = false;
    } else {
      ui.showStatus("Transform pending — click Key Selected to store");
    }
  });
  const syncTransformButtons = () => {
    transformButtons.forEach((btn) => {
      const mode = btn.dataset.mode as ("translate" | "rotate" | "scale" | undefined);
      btn.classList.toggle("active", mode === transformMode);
    });
  };
  transformButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode as ("translate" | "rotate" | "scale" | undefined);
      if (!mode) return;
      setTransformMode(mode);
      syncTransformButtons();
    });
  });
  syncTransformButtons();

  const selectionLabel = container.querySelector<HTMLDivElement>('[data-ctrl="selection-label"]')!;
  const groupScaleWrap = container.querySelector<HTMLDivElement>('[data-ctrl="group-scales"]')!;
  type GroupInputEntry = { inputs: Record<"x" | "y" | "z", HTMLInputElement>; row: HTMLDivElement; label: string };
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
    markTimelineDirty();
    ui.updateTimeline();
  });
  const videoOffset = container.querySelector<HTMLInputElement>('[data-ctrl="video-offset"]')!;
  videoOffset.addEventListener("change", () => {
    setFloatKey(state.anim.videoPlane.timeOffset, currentFrame, parseFloat(videoOffset.value));
    updateVideoPlane(currentFrame);
    markTimelineDirty();
    ui.updateTimeline();
  });

  const poseInsertBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="pose-insert"]')!;
  const poseReplaceBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="pose-replace"]')!;
  const poseProgress = container.querySelector<HTMLProgressElement>('[data-ctrl="pose-progress"]')!;
  const poseStatus = container.querySelector<HTMLDivElement>('[data-ctrl="pose-status"]')!;
  const updatePoseStatus = (message: string) => {
    poseStatus.textContent = message;
  };
  poseProgress.max = 100;
  poseProgress.value = 0;
  poseProgress.hidden = true;
  let poseProgressTimer: number | null = null;
  const startPoseProgress = () => {
    if (poseProgressTimer !== null) window.clearInterval(poseProgressTimer);
    poseProgress.hidden = false;
    poseProgress.value = 0;
    poseProgressTimer = window.setInterval(() => {
      const next = Math.min(95, poseProgress.value + Math.random() * 6 + 1);
      poseProgress.value = next;
    }, 400);
  };
  const stopPoseProgress = (success: boolean) => {
    if (poseProgressTimer !== null) {
      window.clearInterval(poseProgressTimer);
      poseProgressTimer = null;
    }
    poseProgress.value = success ? 100 : 0;
    window.setTimeout(() => {
      poseProgress.hidden = true;
      poseProgress.value = 0;
    }, 600);
  };
  const poseVideoInput = container.querySelector<HTMLInputElement>('[data-ctrl="pose-video"]')!;
  poseVideoInput.addEventListener("change", () => {
    poseVideoFile = poseVideoInput.files?.[0] ?? null;
    poseResult = null;
    poseInsertBtn.disabled = true;
    poseReplaceBtn.disabled = true;
    if (poseVideoFile) {
      updatePoseStatus(`Selected ${poseVideoFile.name}`);
    } else {
      updatePoseStatus("Select a clip and click Analyze.");
    }
  });
  const poseBackend = container.querySelector<HTMLSelectElement>('[data-ctrl="pose-backend"]')!;
  const poseModel = container.querySelector<HTMLSelectElement>('[data-ctrl="pose-model"]')!;
  const poseVariantRow = container.querySelector<HTMLDivElement>('[data-ctrl="pose-variant-row"]')!;
  const poseVitposeVariant = container.querySelector<HTMLSelectElement>('[data-ctrl="pose-vitpose-variant"]')!;
  const poseDevice = container.querySelector<HTMLSelectElement>('[data-ctrl="pose-device"]')!;
  const posePerson = container.querySelector<HTMLSelectElement>('[data-ctrl="pose-person"]')!;
  const poseFps = container.querySelector<HTMLInputElement>('[data-ctrl="pose-fps"]')!;
  const poseResizeW = container.querySelector<HTMLInputElement>('[data-ctrl="pose-resize-w"]')!;
  const poseResizeH = container.querySelector<HTMLInputElement>('[data-ctrl="pose-resize-h"]')!;
  const poseSmooth = container.querySelector<HTMLInputElement>('[data-ctrl="pose-smooth"]')!;
  const poseLift = container.querySelector<HTMLInputElement>('[data-ctrl="pose-lift"]')!;
  const poseAnalyzeBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="pose-analyze"]')!;

  const syncPoseVariantVisibility = () => {
    const shouldShow = poseBackend.value === "hf" && poseModel.value === "vitpose";
    poseVariantRow.style.display = shouldShow ? "" : "none";
  };

  const syncPoseModelOptions = () => {
    const backend = poseBackend.value;
    poseModel.querySelectorAll("option").forEach((opt) => {
      const valid = (backend === "hf" && opt.value === "vitpose") || (backend === "mmpose" && opt.value === "dwpose");
      opt.disabled = !valid;
    });
    if (backend === "hf") {
      poseModel.value = "vitpose";
    } else if (backend === "mmpose") {
      poseModel.value = "dwpose";
    }
    syncPoseVariantVisibility();
  };
  poseBackend.addEventListener("change", syncPoseModelOptions);
  poseModel.addEventListener("change", syncPoseVariantVisibility);
  syncPoseModelOptions();

  const setPoseBusy = (busy: boolean) => {
    poseAnalyzeBtn.disabled = busy;
    if (busy) {
      startPoseProgress();
    } else {
      stopPoseProgress(Boolean(poseResult));
    }
    poseInsertBtn.disabled = busy || !poseResult;
    poseReplaceBtn.disabled = busy || !poseResult;
  };

  const summarizePoseResult = (result: PoseProcessResult) => {
    const frames = result.kpts2d.length;
    const fpsValue = result.meta.effectiveFps.toFixed(2);
    const has3d = result.kpts3d && result.kpts3d.length > 0;
    return `${frames} frames @ ${fpsValue} fps • ${result.meta.model.toUpperCase()} via ${poseBackend.value.toUpperCase()} • 3D ${
      has3d ? "yes" : "no"
    }`;
  };

  const handlePoseAnalyze = async () => {
    if (!poseVideoFile) {
      updatePoseStatus("Choose a video clip first.");
      return;
    }
    setPoseBusy(true);
    updatePoseStatus("Analyzing… this can take a minute for longer clips.");
    try {
      const resizeWidth = parseInt(poseResizeW.value, 10);
      const resizeHeight = parseInt(poseResizeH.value, 10);
      const options = {
        backend: poseBackend.value as "hf" | "mmpose",
        model: poseModel.value as "vitpose" | "dwpose",
        vitposeVariant: poseVitposeVariant.value as VitPoseVariant,
        device: poseDevice.value as "cpu" | "cuda",
        fps: parseInt(poseFps.value, 10) || 24,
        resizeWidth: Number.isFinite(resizeWidth) && resizeWidth > 0 ? resizeWidth : undefined,
        resizeHeight: Number.isFinite(resizeHeight) && resizeHeight > 0 ? resizeHeight : undefined,
        personMode: posePerson.value as "single" | "multi",
        smoothStrength: parseFloat(poseSmooth.value) || 0.6,
        lift3D: poseLift.checked
      };
      const result = await processVideoPy(poseVideoFile, options);
      poseResult = result;
      poseInsertBtn.disabled = false;
      poseReplaceBtn.disabled = false;
      updatePoseStatus(`Done: ${summarizePoseResult(result)}`);
    } catch (error) {
      console.error(error);
      updatePoseStatus(error instanceof Error ? error.message : "Pose processing failed.");
      poseResult = null;
    } finally {
      setPoseBusy(false);
    }
  };

  poseAnalyzeBtn.addEventListener("click", handlePoseAnalyze);

  const insertPoseFrames = (clearExisting: boolean, start: number) => {
    if (!poseResult) {
      updatePoseStatus("Run Analyze first.");
      return;
    }
    const targetProfile = poseResult.meta.bodyProfile as RigProfileId;
    if (state.rigProfileId !== targetProfile) {
      const targetLabel = getProfile(targetProfile).label;
      let shouldSwitch = clearExisting;
      if (!shouldSwitch) {
        shouldSwitch = window.confirm(
          `${targetLabel} rig is required for this result. Switching rigs will reset existing animation. Continue?`
        );
      }
      if (!shouldSwitch) {
        updatePoseStatus(`Switch to ${targetLabel} rig before inserting.`);
        return;
      }
      switchProfile(targetProfile);
      fillProfiles();
      ui.showStatus(`Switched rig to ${targetLabel}`);
    }
    const stats = applyPoseResultToState(state, poseResult, {
      startFrame: start,
      use3D: poseLift.checked,
      clearExisting,
      autoFitTimeline: true
    });
    markTimelineDirty();
    ui.updateTimeline();
    requestPoseUpdate();
    ui.showStatus(`Applied ${stats.framesApplied} frames to timeline.`);
    updatePoseStatus(`Ready: ${summarizePoseResult(poseResult)}`);
  };

  poseInsertBtn.addEventListener("click", () => insertPoseFrames(false, currentFrame));
  poseReplaceBtn.addEventListener("click", () => insertPoseFrames(true, 0));

  const poseExportPath = container.querySelector<HTMLInputElement>('[data-ctrl="pose-export-path"]')!;
  const poseExportBtn = container.querySelector<HTMLButtonElement>('[data-ctrl="pose-export"]')!;
  const poseExportStatus = container.querySelector<HTMLDivElement>('[data-ctrl="pose-export-status"]')!;

  const handleExport = async () => {
    poseExportBtn.disabled = true;
    poseExportStatus.textContent = "Exporting...";
    try {
      const frames = buildExportFrames();
      if (!frames.length) {
        poseExportStatus.textContent = "No frames to export.";
        poseExportBtn.disabled = false;
        return;
      }
      const payload = {
        width: state.output.width,
        height: state.output.height,
        fps: state.timeline.fps,
        bones: state.rigDef.bones.map(([a, b]) => [a, b]),
        frames,
        outPath: poseExportPath.value || "exports/skeleton.mp4",
        skeletonOnly: true
      };
      const response = await exportSkeletonVideo(payload);
      poseExportStatus.textContent = `Saved to ${response.path}`;
      ui.showStatus("Skeleton MP4 exported.");
    } catch (error) {
      console.error(error);
      poseExportStatus.textContent = error instanceof Error ? error.message : "Export failed.";
    } finally {
      poseExportBtn.disabled = false;
    }
  };

  poseExportBtn.addEventListener("click", handleExport);

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
    markTimelineDirty();
    ui.updateTimeline();
    ui.showStatus(`Camera keyed @ frame ${currentFrame}`);
  });

  const jointList = container.querySelector<HTMLDivElement>('[data-ctrl="joint-list"]')!;

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
      row.dataset.groupId = groupId;
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
      const selectBtn = document.createElement("button");
      selectBtn.textContent = "Select";
      selectBtn.addEventListener("click", () => {
        clearJointSelection();
        selection = { kind: "group", id: groupId };
        setTransformMode("scale");
        updateSelection();
      });
      actions.appendChild(selectBtn);
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
      groupScaleInputs.set(groupId, { inputs: axisInputs, row, label: labelText });
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
        btn.addEventListener("click", (event: MouseEvent) => {
          const toggle = event.metaKey || event.ctrlKey;
          const additive = event.shiftKey && !toggle;
          selectJoint(joint.id, { additive, toggle });
        });
        jointList.appendChild(btn);
      }
    },
    updateTransformMode: () => {
      syncTransformButtons();
    },
    updateSelection: () => {
      if (!selection) {
        selectionLabel.textContent = "No selection";
      } else if (selection.kind === "joint") {
        const count = jointSelection.size || (selection ? 1 : 0);
        if (count > 1) {
          selectionLabel.textContent = `${count} joints selected`;
        } else {
          selectionLabel.textContent = `Joint: ${selection.id}`;
        }
      } else if (selection.kind === "group") {
        const groupDef = state.rigDef.groups[selection.id];
        const labelText = groupDef?.label || selection.id;
        selectionLabel.textContent = `Group: ${labelText}`;
      } else if (selection.kind === "rigRoot") {
        selectionLabel.textContent = "Master Joint";
      } else {
        selectionLabel.textContent = "Video Plane";
      }
      Array.from(jointList.children).forEach((child) => {
        const btn = child as HTMLButtonElement;
        const jointId = btn.dataset.jointId;
        btn.classList.toggle("active", Boolean(jointId && jointSelection.has(jointId)));
      });
      groupScaleInputs.forEach((entry, groupId) => {
        entry.row.classList.toggle("active", selection?.kind === "group" && selection.id === groupId);
      });
      manualKeyBtn.disabled = !selection || state.autoKey;
    },
    updateScaleFactor: (value: number | null) => {
      if (value == null) {
        scaleReadout.hidden = true;
        scaleValueInput.value = "1.00";
        return;
      }
      scaleReadout.hidden = false;
      scaleValueInput.value = value.toFixed(2);
    },
    updateTimeline: () => {
      fpsInput.value = String(state.timeline.fps);
      framesInput.value = String(state.timeline.frameCount);
      const frameCount = state.timeline.frameCount;
      const shouldRefreshMarkers = timelineMarkersDirty || timelineMarkerFrameCount !== frameCount;
      if (shouldRefreshMarkers) {
        timelineBar.setFrameLines(frameCount);
        timelineBar.setMarkers(getTimelineMarkerCache(), frameCount);
        timelineMarkerFrameCount = frameCount;
      }
      timelineBar.setFrame(currentFrame, frameCount);
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
      autoKeyBtn.textContent = state.autoKey ? "Auto-Key On" : "Auto-Key Off";
      autoKeyBtn.classList.toggle("active", state.autoKey);
      manualKeyBtn.disabled = !selection || state.autoKey;
    },
    updatePlaybackControls: () => {
      timelineBar.setPlaybackState({ playing: isPlaying, loop: loopPlayback });
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

function createTimelineBar(container: HTMLElement): TimelineBarController {
  const bar = document.createElement("div");
  bar.className = "timeline-bar";
  bar.innerHTML = `
    <div class="timeline-controls">
      <div class="timeline-buttons">
        <button type="button" data-timeline="prev" title="Step back one frame">Prev</button>
        <button type="button" data-timeline="play">Play</button>
        <button type="button" data-timeline="pause">Pause</button>
        <button type="button" data-timeline="next" title="Step forward one frame">Next</button>
        <button type="button" data-timeline="loop">Loop</button>
      </div>
      <div class="timeline-frame-readout" data-timeline="frame">Frame 0 / 0</div>
    </div>
  `;
  const track = document.createElement("div");
  track.className = "timeline-track";
  track.dataset.timeline = "track";
  const lineLayer = document.createElement("div");
  lineLayer.className = "timeline-frame-lines";
  lineLayer.dataset.timeline = "frame-lines";
  const keyLayer = document.createElement("div");
  keyLayer.className = "timeline-keyframes";
  keyLayer.dataset.timeline = "keys";
  const cursor = document.createElement("div");
  cursor.className = "timeline-cursor";
  cursor.dataset.timeline = "cursor";
  track.append(lineLayer, keyLayer, cursor);
  bar.appendChild(track);
  container.appendChild(bar);

  const playBtn = bar.querySelector<HTMLButtonElement>('[data-timeline="play"]')!;
  const pauseBtn = bar.querySelector<HTMLButtonElement>('[data-timeline="pause"]')!;
  const prevBtn = bar.querySelector<HTMLButtonElement>('[data-timeline="prev"]')!;
  const nextBtn = bar.querySelector<HTMLButtonElement>('[data-timeline="next"]')!;
  const loopBtn = bar.querySelector<HTMLButtonElement>('[data-timeline="loop"]')!;
  const frameLabel = bar.querySelector<HTMLDivElement>('[data-timeline="frame"]')!;

  playBtn.addEventListener("click", startPlayback);
  pauseBtn.addEventListener("click", stopPlayback);
  loopBtn.addEventListener("click", toggleLoopPlayback);
  prevBtn.addEventListener("click", () => {
    stopPlayback();
    stepFrame(-1);
  });
  nextBtn.addEventListener("click", () => {
    stopPlayback();
    stepFrame(1);
  });

  const scrubToEvent = (event: PointerEvent) => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const frameCount = state.timeline.frameCount;
    const frame = Math.round(ratio * frameCount);
    setCurrentFrame(frame);
  };

  const handlePointerMove = (event: PointerEvent) => {
    scrubToEvent(event);
  };
  const handlePointerUp = () => {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerUp);
  };

  track.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    stopPlayback();
    scrubToEvent(event);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  });

  return {
    setFrame: (frame, frameCount) => {
      const ratio = frameCount > 0 ? THREE.MathUtils.clamp(frame / frameCount, 0, 1) : 0;
      cursor.style.left = `${ratio * 100}%`;
      const displayFrame = Math.round(frame);
      frameLabel.textContent = `Frame ${displayFrame} / ${frameCount}`;
      keyLayer.querySelectorAll<HTMLDivElement>(".timeline-keyframe").forEach((marker) => {
        const markerFrame = Number(marker.dataset.frame ?? 0);
        marker.classList.toggle("active", Math.round(markerFrame) === displayFrame);
      });
    },
    setFrameLines: (frameCount) => {
      lineLayer.innerHTML = "";
      const denom = Math.max(frameCount, 1);
      const maxLines = 2000;
      const step = frameCount > maxLines ? Math.ceil(frameCount / maxLines) : 1;
      const frag = document.createDocumentFragment();
      for (let frame = 0; frame <= frameCount; frame += step) {
        const line = document.createElement("div");
        line.className = "timeline-frame-line";
        if (frame % 10 === 0) {
          line.classList.add("major");
        }
        const percent = denom > 0 ? (frame / denom) * 100 : 0;
        line.style.left = `${percent}%`;
        frag.appendChild(line);
      }
      if ((frameCount % step) !== 0) {
        const line = document.createElement("div");
        line.className = "timeline-frame-line major";
        line.style.left = "100%";
        frag.appendChild(line);
      }
      lineLayer.appendChild(frag);
    },
    setMarkers: (frames, frameCount) => {
      keyLayer.innerHTML = "";
      if (!frames.length) return;
      const frag = document.createDocumentFragment();
      const denom = Math.max(frameCount, 1);
      frames.forEach((frame) => {
        const marker = document.createElement("div");
        marker.className = "timeline-keyframe";
        marker.dataset.frame = String(frame);
        const clamped = THREE.MathUtils.clamp(frame, 0, frameCount);
        const percent = denom > 0 ? (clamped / denom) * 100 : 0;
        marker.style.left = `${percent}%`;
        frag.appendChild(marker);
      });
      keyLayer.appendChild(frag);
    },
    setPlaybackState: ({ playing, loop }) => {
      playBtn.classList.toggle("active", playing);
      pauseBtn.classList.toggle("active", !playing);
      loopBtn.classList.toggle("active", loop);
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
  syncJointTransformHelpers();
  renderer.autoClear = true;
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  overlay.render();
}

updateFrame(0);
animate();
