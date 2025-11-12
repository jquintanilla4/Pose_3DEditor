# DW/ViTPose 3D Editor

A lightweight Vite + TypeScript + three.js playground for posing ViTPose-17 and DWPose-25 bodies, keyframing rigs/camera/video references, and exporting JSON per the bundled `spec.md`.

## Getting Started

```bash
npm install
npm run dev
```

The dev server prints a local URL (default http://localhost:5173). `npm run build` performs a type-check and production bundle.

## Current Feature Set

- **Rig profiles:** ViTPose 17 + DWPose 25 with rest poses, FK parenting, bone lines, and TransformControls for rig root/joints/video plane.
- **Timeline:** editable FPS/frame-count, frame slider/number field, auto-key toggle, manual “Key Selected”, camera preview toggle + “Key Camera” snapshot of the current orbit view.
- **Output & guides:** width/height/pixel aspect/render scale/overscan inputs tied to the perspective camera and a camera-locked HUD (image gate, thirds, center, action/title safe).
- **Video plane:** MP4/WebM upload → VideoTexture plane with lock-to-camera toggle, time-offset track, Match Video (copies width/height & derives frameCount), and clear/reset controls.
- **Persistence:** Save/Load JSON that matches the spec’s `EditorSave` schema. Files capture rig/joint/group/camera/video tracks plus output+guide preferences.

## Shortcuts & Tips

- Click joints in the viewport or joint list to edit; click **Rig Root** or **Video Plane** buttons to target other controls.
- Press `G` to quickly select the Rig Root.
- Auto-Key is on by default. Turn it off to pose first, then use **Key Selected** for the active element.
- Use **Preview** in the Camera section to toggle whether timeline scrubbing enforces keyed camera transforms or leaves the Orbit view free.

## Known Gaps / Next Steps

- Dedicated UI for per-group scaling (state + interpolation exist but no knobs yet).
- Depth brush / ALT-drag Z tweaks and other posing helpers.
- Timeline easing curve editing and playback loop controls.
- Additional HUD overlays (custom aspects, guide color picker) and gizmo snapping.

See `spec.md` for the complete project brief plus future requirements that haven’t landed yet.
