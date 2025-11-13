# DW/ViTPose 3D Editor

A lightweight Vite + TypeScript + three.js playground for posing ViTPose-17 and DWPose-25 bodies, keyframing rigs/camera/video references, and exporting JSON per the bundled `spec.md`.

## Getting Started

```bash
npm install
npm run dev
```

The dev server prints a local URL (default http://localhost:5173). `npm run build` performs a type-check and production bundle.

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

See `spec.md` for the complete project brief plus future requirements that haven’t landed yet.
