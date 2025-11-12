# Lightweight 3D DW/ViTPose Editor — Consolidated Spec

## Purpose

A small web app to pose and animate a DW/ViTPose skeleton in true 3D, with keyframes for joints, rig transforms, and camera; optional rectilinear video on a plane to animate against; user-defined output dimensions with camera-locked guides.

## Implementation Snapshot (v0.1.0)

* Toolchain landed: Vite + TypeScript + three.js + OrbitControls + TransformControls in `/src/main.ts`.
* Rig profiles: `vitpose_body_17` and `dwpose_body_25` with rest poses, bones, groups, and default rest lengths.
* Editing: orbit camera, select via viewport or joint list, translate joints, manipulate rig root/video plane (translate/rotate/scale), auto-key toggle + manual "Key Selected".
* Timeline: FPS + frame-count inputs, frame slider/number, camera preview toggle, camera key-from-orbit button.
* Output controls: width/height/pixel aspect/render scale/overscan tied to camera + gate overlay (image gate, thirds, center, action/title safe).
* Video plane: load MP4/WebM, optional lock-to-camera, time offset tied to timeline, “Match Video” sets output dimensions (keeps current FPS), clear button.
* Persistence: Save/Load JSON matches `EditorSave` schema in this spec; includes rig tracks, camera, video plane, output, guides.

### TODO / still open

* UI for per-group scaling & non-uniform overrides (state + interpolation already wired, needs controls).
* Depth brush (ALT drag) and other quick-Z tweaks.
* Timeline easing curve editing UI (currently keys support ease fields but no UI to change them).
* Video plane extras: scrubbing thumbnails, lock toggle indicators inside HUD.
* Playback / auto-runner and camera preview blending.

## Tech (keep it minimal)

* TypeScript + **three.js** + **OrbitControls**; build with **Vite**.
* Simple state store (plain objects is fine for MVP).
* Browser file I/O for saving/loading JSON. No server needed.

## Scene & Units

* Three.js defaults, **Y-up**.
* 1 unit ≈ 1 meter (conceptual).
* Global timeline in **frames**; user sets **FPS** and **frameCount**.

## Skeleton (profiles)

* Ship one profile by default, selectable in UI:

  * `vitpose_body_17` (COCO-style) or `dwpose_body_25`.
* Each profile defines:

  * `joints: JointDef[]` (stable `id` strings).
  * `bones: [parentId, childId][]`.
  * `defaultRest[boneId]` (lengths for proportional scaling).
  * `groups` (Head, Torso, L/R Arm, L/R Leg, Hands).
* **RigRoot** transform = whole-rig pos/rot/scale (keyframeable).

## Editing & Transforms

* Select joint/bone/group; transform via gizmo (translate/rotate/scale).
* **Whole rig scale** on RigRoot (tiny human ↔ giant human).
* **Group scale** (e.g., “giant head”): scale local offsets about the group centroid (lengthens contained bones instead of just visually thickening lines).
* **Depth brush** (optional): ALT-drag for quick Z tweak.
* FK semantics: moving a parent carries children.

## Video Plane (rectilinear reference)

* Import MP4/WebM → HTMLVideoElement → VideoTexture on PlaneGeometry.
* Transformable plane; **Lock to camera** toggle (parent to camera).
* Playback tied to timeline scrubbing:

  * App-driven sync: `time = frame / fps + timeOffset`.
  * **Match Video**: set app FPS & frameCount from clip metadata.

## Camera

* OrbitControls for navigation.
* Keyframe **position**, **target**, **FOV**.
* Snapshot current Orbit state into a keyframe.

## Output Dimensions & Guides

* Project output:

  * `width`, `height`, `pixelAspect=1.0`, `renderScale`, `overscanPct`.
  * **Match Frame Size** from imported video (updates camera aspect).
* **Guides (camera-locked)**:

  * Image Gate, Rule of Thirds, Center mark, Action/Title Safe (%).
  * Optional custom aspect overlays; opacity/color controls.
  * Drawn as HUD/overlay; unaffected by scene depth.

## Keyframing & Interpolation

* Tracks:

  * RigRoot (pos/rot/scale), per-Group scales, per-Joint pos,
  * Camera (pos/target/fov), VideoPlane (pos/rot/scale, timeOffset, lock flag).
* Interp: vec3 linear, quat slerp, scale linear, bool stepped.
* Auto-key toggle; add/update/delete keys; linear/ease options.

## Data Model (save file)

```ts
type EditorSave = {
  meta: { appVersion: string; createdAt: string; };
  timeline: { fps: number; frameCount: number; };
  rigProfile: "vitpose_body_17" | "dwpose_body_25";
  rigDef: {
    joints: { id: string; name?: string; }[];
    bones: [string, string][];
    defaultRest: Record<string, number>;
    groups: Record<string, { joints: string[] }>;
  };
  anim: {
    rigRoot: KeyTrackVec3 & KeyTrackQuat & KeyTrackVec3Scale;
    groupScales: Record<string, KeyTrackVec3Scale>;
    jointPositions: Record<string, KeyTrackVec3>;
    camera: { pos: KeyTrackVec3; target: KeyTrackVec3; fov: KeyTrackFloat; };
    videoPlane?: {
      enabled: boolean; mediaSrc?: string;
      transform: { pos: KeyTrackVec3; rot: KeyTrackQuat; scale: KeyTrackVec3; };
      timeOffset?: KeyTrackFloat; lockToCamera?: KeyTrackBool;
    };
  };
  output: {
    width: number; height: number; pixelAspect?: number;
    renderScale?: number; overscanPct?: number;
    guides: {
      showImageGate: boolean; showThirds: boolean; showCenter: boolean;
      showActionSafe: boolean; showTitleSafe: boolean;
      actionSafePct?: number; titleSafePct?: number;
      customAspects?: Array<{ label: string; width: number; height: number; enabled: boolean; }>;
      opacity?: number; color?: string;
    };
  };
};
type Key<T=number> = { f: number; v: T; ease?: "linear"|"in"|"out"|"inOut" };
type KeyTrackFloat = { keys: Key<number>[] };
type KeyTrackVec3   = { keysX: Key[]; keysY: Key[]; keysZ: Key[] };
type KeyTrackVec3Scale = KeyTrackVec3;
type KeyTrackQuat  = { keys: Key<[number,number,number,number]> };
type KeyTrackBool  = { keys: Key<0|1>[] };
```

## Eval order per frame

1. Interpolate tracks → RigRoot TRS.
2. Apply group scales to local offsets about each group centroid.
3. Apply per-joint absolute positions (overrides).
4. Compose world positions: `world(j) = RigRoot * joint(j)`.
5. Build camera (pos/target/fov) and video plane (transform + timeOffset).
6. Update guides overlay using **output aspect**.

## UI (MVP)

* Panels: Scene (rig/video), Timeline (fps, frames, play/loop, match video), Keyframe (add/del, interp), Transform (pos/rot/scale), Groups (scale), Render (width/height/pixelAspect/overscan, guides toggles).
* Hotkeys: `Q/W/E` mode, `A` auto-key, `K` keyframe, `Space` play, `,`/`.` frame step, `Shift+,/.` prev/next key, `V` add video, `L` lock plane, `G` guides, `Shift+G` ground grid, `F` frame selection.

## Acceptance (MVP)

* Pose/transform joints in 3D; keyframe pose and camera.
* RigRoot scale works; group scale (Head) creates “big head”.
* Video plane imports, syncs to timeline; lock/unlock to camera.
* User sets FPS/frames or matches video metadata.
* User sets output width/height (and pixelAspect); camera aspect updates.
* Guides overlay reflects output aspect and toggles work.
* Save/Load project JSON; export per-frame 3D (and optional 2D projected) joints.

---

# Tiny three.js Scaffold (gate overlay + aspect updates)

**What it does:** boots a scene with OrbitControls, tracks `output.width/height/pixelAspect`, updates camera aspect, and draws a camera-locked **image gate** overlay (plus thirds/center/safe areas). Exposes `setOutputSize(w,h,pa)` and `matchVideoFrameSize(video)`.

## `package.json`

```json
{
  "type": "module",
  "scripts": { "dev": "vite" },
  "dependencies": { "three": "^0.165.0" },
  "devDependencies": { "vite": "^5.3.0", "typescript": "^5.6.3" }
}
```

## `index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>DW/ViTPose 3D Editor — Scaffold</title>
    <style>
      html,body,#app{height:100%;margin:0}
      canvas{display:block;background:#0b0b0b}
    </style>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

## `src/main.ts`

```ts
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const app = document.getElementById("app")!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.AxesHelper(0.5));
scene.add(new THREE.GridHelper(10, 10));

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(0, 1.5, 4);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const output = { width: 1920, height: 1080, pixelAspect: 1.0 };

function setOutputSize(w: number, h: number, pixelAspect = 1.0) {
  output.width = Math.max(2, Math.floor(w));
  output.height = Math.max(2, Math.floor(h));
  output.pixelAspect = Math.max(1e-6, pixelAspect);
  const aspect = (output.width * output.pixelAspect) / output.height;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  overlay.update();
}
(window as any).setOutputSize = setOutputSize;
setOutputSize(1920, 1080, 1.0);

// ---------- Gate Overlay (camera-locked HUD) ----------
class GateOverlay {
  overlayScene = new THREE.Scene();
  overlayCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  showThirds = true;
  showCenter = true;
  showActionSafe = true;
  showTitleSafe = false;
  actionSafePct = 5;
  titleSafePct = 10;

  private makeRectLines(x: number, y: number, w: number, h: number, color = 0xffffff, opacity = 0.9) {
    const geo = new THREE.BufferGeometry();
    const v = new Float32Array([
      x, y, 0, x + w, y, 0,
      x + w, y, 0, x + w, y + h, 0,
      x + w, y + h, 0, x, y + h, 0,
      x, y + h, 0, x, y, 0
    ]);
    geo.setAttribute("position", new THREE.BufferAttribute(v, 3));
    return new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })
    );
  }

  update() {
    const W = renderer.domElement.clientWidth;
    const H = renderer.domElement.clientHeight;

    this.overlayCamera.left = 0; this.overlayCamera.right = W;
    this.overlayCamera.top = H;  this.overlayCamera.bottom = 0;
    this.overlayCamera.updateProjectionMatrix();

    // Clear prior overlay
    this.overlayScene.clear();

    // Fit the output aspect into the viewport (letter/pillarbox)
    const gateAspect = (output.width * output.pixelAspect) / output.height;
    const viewAspect = W / H;

    let gw: number, gh: number;
    if (viewAspect >= gateAspect) { gh = H; gw = H * gateAspect; }
    else { gw = W; gh = W / gateAspect; }

    const x = (W - gw) * 0.5;
    const y = (H - gh) * 0.5;

    // Image gate
    this.overlayScene.add(this.makeRectLines(x, y, gw, gh, 0xffffff, 0.85));

    // Thirds
    if (this.showThirds) {
      const x1 = x + gw / 3, x2 = x + 2 * gw / 3, y1 = y + gh / 3, y2 = y + 2 * gh / 3;
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array([
        x1, y, 0, x1, y + gh, 0,
        x2, y, 0, x2, y + gh, 0,
        x, y1, 0, x + gw, y1, 0,
        x, y2, 0, x + gw, y2, 0
      ]);
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      this.overlayScene.add(new THREE.LineSegments(
        geo, new THREE.LineBasicMaterial({ color: 0x66ffff, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false })
      ));
    }

    // Center mark
    if (this.showCenter) {
      const cx = x + gw / 2, cy = y + gh / 2, L = Math.min(gw, gh) * 0.03;
      const geo = new THREE.BufferGeometry();
      const arr = new Float32Array([
        cx - L, cy, 0, cx + L, cy, 0,
        cx, cy - L, 0, cx, cy + L, 0
      ]);
      geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      this.overlayScene.add(new THREE.LineSegments(
        geo, new THREE.LineBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false })
      ));
    }

    // Safe areas
    if (this.showActionSafe) {
      const m = this.actionSafePct / 100;
      this.overlayScene.add(this.makeRectLines(x + gw * m, y + gh * m, gw * (1 - 2 * m), gh * (1 - 2 * m), 0x00ff88, 0.6));
    }
    if (this.showTitleSafe) {
      const m = this.titleSafePct / 100;
      this.overlayScene.add(this.makeRectLines(x + gw * m, y + gh * m, gw * (1 - 2 * m), gh * (1 - 2 * m), 0x0088ff, 0.6));
    }
  }
}
const overlay = new GateOverlay();
overlay.update();

// Resize handling
window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  overlay.update();
});

// Render loop: main scene then overlay (clearing depth in between)
function loop() {
  requestAnimationFrame(loop);
  controls.update();
  renderer.autoClear = true;
  renderer.render(scene, camera);
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(overlay.overlayScene, overlay.overlayCamera);
}
loop();

// Convenience helper: set output from a loaded <video> element
(window as any).matchVideoFrameSize = (video: HTMLVideoElement) => {
  const w = video.videoWidth || 1920;
  const h = video.videoHeight || 1080;
  const pa = 1.0; // pixel aspect unknown in browsers; set if known
  setOutputSize(w, h, pa);
};
```

### How it works (concise)

* Keeps `output.width/height/pixelAspect`; updates `camera.aspect` accordingly.
* Draws the **image gate** + thirds/center/safe rectangles in a separate **overlay scene** with an **orthographic camera**, so guides are camera-locked and never occluded.
* On resize or `setOutputSize`, it recomputes the gate to fit inside the viewport without stretching (letter/pillarboxing).
