"""Skeleton exporter utilities."""

from pathlib import Path

import ffmpeg
import numpy as np
import cv2


COLOR_GRADIENT = [
    (99, 102, 241),
    (129, 140, 248),
    (248, 113, 113),
    (249, 168, 212),
    (248, 250, 109),
]


def _spectral_color(t):
    t = min(max(t, 0.0), 1.0)
    idx = t * (len(COLOR_GRADIENT) - 1)
    lo = int(np.floor(idx))
    hi = min(len(COLOR_GRADIENT) - 1, lo + 1)
    alpha = idx - lo
    c1 = COLOR_GRADIENT[lo]
    c2 = COLOR_GRADIENT[hi]
    r = int(c1[0] + (c2[0] - c1[0]) * alpha)
    g = int(c1[1] + (c2[1] - c1[1]) * alpha)
    b = int(c1[2] + (c2[2] - c1[2]) * alpha)
    return (r, g, b)


def _denormalize(point, width, height):
    nx = point.get("x", 0.0)
    ny = point.get("y", 0.0)
    x = (nx + 1.0) * 0.5 * width
    y = (1.0 - ny) * 0.5 * height
    return int(round(x)), int(round(y))


def _draw_skeleton(canvas, frame, bones):
    h, w, _ = canvas.shape
    overlay = canvas.copy()
    joint_radius = max(3, int(min(h, w) * 0.01))
    glow_radius = joint_radius + 3

    for idx, bone in enumerate(bones):
        if len(bone) != 2:
            continue
        a, b = bone
        if a not in frame or b not in frame:
            continue
        p1 = _denormalize(frame[a], w, h)
        p2 = _denormalize(frame[b], w, h)
        color = _spectral_color(idx / max(1, len(bones) - 1))
        glow = tuple(int(c * 0.45) for c in color)
        cv2.line(overlay, p1, p2, glow[::-1], thickness=6, lineType=cv2.LINE_AA)
        cv2.line(canvas, p1, p2, color[::-1], thickness=2, lineType=cv2.LINE_AA)

    for joint in frame.values():
        p = _denormalize(joint, w, h)
        cv2.circle(overlay, p, glow_radius, (255, 255, 255), thickness=-1, lineType=cv2.LINE_AA)
        cv2.circle(canvas, p, joint_radius, (255, 255, 255), thickness=-1, lineType=cv2.LINE_AA)

    cv2.addWeighted(overlay, 0.35, canvas, 0.65, 0, dst=canvas)


def export_skeleton_mp4(
    frames,
    width,
    height,
    fps,
    out_path,
    bones=None,
):
    if not frames:
        raise ValueError("No frames supplied for export")
    bones = bones or []
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    bgr_frames = []
    for frame in frames:
        canvas = np.zeros((height, width, 3), dtype=np.uint8)
        _draw_skeleton(canvas, frame, bones)
        bgr_frames.append(canvas)

    process = (
        ffmpeg
            .input(
                "pipe:",
                format="rawvideo",
                pix_fmt="rgb24",
                s=f"{width}x{height}",
                r=fps,
            )
            .output(
                out_path,
                pix_fmt="yuv420p",
                vcodec="libx264",
                r=fps,
                preset="fast",
                crf=20,
            )
            .overwrite_output()
            .run_async(pipe_stdin=True, pipe_stdout=True, pipe_stderr=True)
    )
    try:
        for frame in bgr_frames:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            process.stdin.write(rgb.astype(np.uint8).tobytes())
        process.stdin.close()
        process.wait()
    finally:
        if process.stdin and not process.stdin.closed:
            process.stdin.close()
    return str(Path(out_path).resolve())
