# DW/ViTPose 3D Editor

A lightweight Vite + TypeScript + three.js playground for posing ViTPose-17 and DWPose-25 bodies, keyframing rigs/camera/video references, and exporting JSON per the bundled `spec.md`.

## Getting Started

### Frontend

```bash
npm install # only use during first time setup
npm run dev
```

The dev server prints a local URL (default http://localhost:5173). `npm run build` performs a type-check and production bundle.

### Python Pose Backend

The ViTPose/DWPose inference service lives under `server/` (FastAPI + Uvicorn). `npm run dev` spawns it automatically alongside Vite via `scripts/dev-server.mjs`, so you only have to manage the Python environment once.

All of these commands should be executed inside the project folder (`Pose_3DEditor/`).

**First-time setup** (only run once):

```bash
uv venv --python 3.11 .venv   # downloads Python 3.11 if needed and creates .venv at repo root
source .venv/bin/activate
uv pip install -r server/requirements.txt
```

`uv` dramatically speeds up virtualenv creation and dependency installs; install it from https://github.com/astral-sh/uv if you don't already have it. We recommend Python **3.11.x** because Torch/Transformers/MM* ship stable builds there; newer versions (3.12+) are not guaranteed. Prefer classic tooling? `python3.11 -m venv` + `pip install -r server/requirements.txt` works the same. If you want to launch the backend without Vite (for CI, etc.), run `npm run pyserver`.

### Startup Commands

If frontend install and backend install process have been executed (only once), you can now just run the following commands to continue development.

```bash
source .venv/bin/activate      # reuse the existing environment
npm run dev                    # runs both Vite + uvicorn together
```

#### Auto-downloaded models

- **ViTPose / RT-DETR (HF backend):** checkpoints + processors for `usyd-community/vitpose-base-simple`, `usyd-community/vitpose-plus-large` (dataset index 5 = COCO-WholeBody), the ONNX export from `JunkyByte/easy_ViTPose` (`onnx/wholebody/vitpose-l-wholebody.onnx`), and `PekingU/rtdetr_r50vd_coco_o365` are mirrored into `models/vitpose/` and `models/rtdetr/` automatically, so the Hugging Face cache isn’t required at runtime. You can override the locations with `VITPOSE_MODEL_DIR` / `RTDETR_MODEL_DIR` if desired.
- **DWPose (MMPose backend):** the config + checkpoint land in `models/dwpose/` the first time you run that backend. Files come from the official IDEA-Research repositories (config via GitHub, checkpoint via Hugging Face). The resolved paths are exported as `DWPOSE_CFG` / `DWPOSE_CKPT` so power users can still override them if needed.

Set `VITE_POSE_API` if you host the backend somewhere other than `http://localhost:8000`.

### Pose Pipeline Workflow

1. **Analyze** – pick a clip in the Pose Processing panel, choose backend/model/device/FPS/resize, tweak smoothing + 3D lifting, then click **Analyze**. Progress + a summary string will appear once the Python backend returns.
2. **Insert / Replace** – after a successful analysis, inject the result at the playhead or replace the entire timeline. Joint keys are normalized to the rig bounds, optional 3D coordinates are respected, and the timeline auto-expands to fit.
3. **Edit** – tweak poses, blend with existing animation, retime, etc.
4. **Export** – use the Pose Export panel to stream the evaluated animation back to the backend, which renders the spectral skeleton look (black BG, glow joints/bones) to the requested MP4 path (default `exports/skeleton.mp4`).

## Current Feature Set

### Rig & Skeleton System
- **Dual Rig Profiles:** ViTPose-17 (17 joints) and DWPose-25 (25 joints with detailed facial/toe tracking)
- **Master Control Ring:** Visual ring at character base for full skeleton manipulation (translate/rotate/scale entire rig)
- **FK Parenting:** Joint hierarchy where rotating a parent affects all child joints
- **Joint Groups:** Head, Torso, LeftArm, RightArm, LeftLeg, RightLeg, Hands for efficient multi-joint manipulation
- **Group-based Scaling:** Non-uniform scaling (X/Y/Z) around group centroids for creative posing
- **Bone Visualization:** Line segments connecting joints with color-coded selection feedback

### Animation & Keyframing
- **Timeline System:** Editable FPS, frame count, scrubbing slider, playback controls (play/pause/loop/step)
- **Smart Keyframing:** Auto-key mode on by default, manual "Key Selected" override, keyframe markers
- **Multi-target Selection:** Ctrl/Cmd to toggle joints, Shift for additive selection
- **Easing Curves:** Linear, Ease In, Ease Out, Ease In-Out interpolation for smooth animations
- **Interpolation Types:** SLERP for rotations, linear for positions/scales, stepped for booleans
- **Keyframe Tracks:** Per-joint (position), Rig Root (transform), Group Scales, Camera, Video Plane

### Camera & Output
- **Animated Camera:** Keyframe position, target, and FOV with Preview mode toggle
- **Professional Output:** Width/height, pixel aspect, render scale, overscan percentage controls
- **Camera Guides:** Image gate, rule of thirds, center marks, action safe, title safe overlays
- **Video Reference:** Upload MP4/WebM videos as textured planes with time-offset keyframing
- **Lock to Camera:** Video planes can follow camera for perfect reference tracking

### User Interface & Controls
- **Transform Modes:** Move (W), Rotate (E), Scale (S) with visual gizmos
- **Keyboard Shortcuts:** G (select rig root), W/E/S (transform modes), Escape (deselect)
- **Depth Brush:** ALT+drag for quick Z-axis joint adjustments
- **Side Panel:** Collapsible sections with transform controls, joint lists, group scaling
- **Visual Feedback:** Color-coded joints, master ring highlighting, selection status display

### Persistence & Workflow
- **Save/Load JSON:** Export complete scenes with all tracks, timeline, and preferences
- **Match Video:** Auto-configure output dimensions and frame count from uploaded video
- **File I/O:** Import/export functionality for scene sharing and versioning

## Shortcuts & Tips

### Selection & Controls
- Click the **Master Control Ring** at the character's base to select and manipulate the entire skeleton
- Click joints in the viewport or joint list to edit; use **Rig Root** or **Video Plane** buttons to target other controls
- **Multi-select:** Hold `Ctrl`/`Cmd` to toggle joints, hold `Shift` to add joints to selection
- Press `G` to quickly select the Rig Root
- Press `W` for Move mode, `E` for Rotate mode, `S` for Scale mode
- Press `Escape` to deselect all

### Keyframing
- Auto-Key is on by default - transforms are automatically keyed as you move
- Turn Auto-Key off to pose freely, then use **Key Selected** to manually key the active element
- Use **Preview** in the Camera section to toggle whether timeline scrubbing controls the camera or leaves Orbit view free
- **Key Camera** button snapshots the current orbit view into a camera keyframe

### Posing Techniques
- **Depth Brush:** Hold `ALT` and drag to quickly adjust joint depth (Z-axis)
- Use **Group Scaling** in the side panel for creative effects (giant heads, long limbs, etc.)
- Group rotations follow FK hierarchy - rotate shoulders to move entire arms
- Timeline playback controls: play, pause, loop, and step forward/back frame by frame

### Video Reference
- Upload MP4/WebM videos as reference planes
- Enable **Lock to Camera** to keep video perfectly framed during camera moves
- Use **Match Video** to auto-configure output dimensions and timeline frame count from your video
- Keyframe the **Time Offset** track to sync video with your animation

## Known Gaps / Next Steps

- Timeline easing curve editor for visual curve manipulation
- Playback loop controls with in/out points and bounce options
- Additional HUD overlays: custom aspect ratios, guide color picker
- Gizmo snapping and constraint systems
- Timeline thumbnails for keyframe visualization
- Batch export presets and rendering pipeline
- Per-joint custom pivot points and IK solvers
