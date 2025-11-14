"""Video decoding helpers for the pose processing backend."""

from pathlib import Path

import cv2
import numpy as np


class VideoDecodeError(RuntimeError):
    """Raised when OpenCV cannot read frames from the supplied file."""


def _coerce_resize_dims(src_w, src_h, width, height):
    if width and height:
        return int(width), int(height)
    if width and not height:
        scale = width / float(src_w)
        return int(width), max(1, int(round(src_h * scale)))
    if height and not width:
        scale = height / float(src_h)
        return max(1, int(round(src_w * scale))), int(height)
    return src_w, src_h


def read_video_frames(
    path,
    target_fps=None,
    resize_width=None,
    resize_height=None,
):
    """Decode a video into an RGB numpy tensor and return metadata."""

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():  # pragma: no cover - depends on runtime
        raise VideoDecodeError(f"Failed to open video: {path}")

    src_fps = cap.get(cv2.CAP_PROP_FPS) or 0
    if src_fps <= 0:
        src_fps = float(target_fps or 24)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    src_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    src_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)

    out_w, out_h = _coerce_resize_dims(src_w or 1, src_h or 1, resize_width, resize_height)
    fps = float(target_fps or src_fps)
    fps = fps if fps > 0 else src_fps
    step = max(1.0, src_fps / fps) if fps else 1.0

    frames = []
    next_capture = 0.0
    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx + 1 >= next_capture - 1e-6:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            if (rgb.shape[1], rgb.shape[0]) != (out_w, out_h):
                rgb = cv2.resize(rgb, (out_w, out_h), interpolation=cv2.INTER_AREA)
            frames.append(rgb)
            next_capture += step
        idx += 1
    cap.release()

    if not frames:
        raise VideoDecodeError("No frames decoded from video")

    array = np.stack(frames)
    duration = len(frames) / fps if fps else 0
    meta = {
        "width": float(out_w),
        "height": float(out_h),
        "fps": float(fps),
        "frames": float(len(frames)),
        "duration": float(duration),
        "sourceFps": float(src_fps),
        "sourceFrames": float(total_frames),
        "sourceWidth": float(src_w),
        "sourceHeight": float(src_h),
    }
    return array, meta
