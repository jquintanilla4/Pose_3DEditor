"""FastAPI service orchestrating pose detection → editor export."""

import json
import logging
import os
import tempfile
import time
from pathlib import Path

import numpy as np
import orjson
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import compat as _compat  # noqa: F401  # Ensure OpenMMLab patches applied early.
from .processing.decoder import read_video_frames
from .processing.exporter import export_skeleton_mp4
from .processing.hf_vitpose import HFViTPose
from .processing.lift3d import get_lifter
from .processing.mappings import (
    MAP_DWPOSE_25_TO_EDITOR,
    MAP_VITPOSE_17_TO_EDITOR,
    MAP_VITPOSE_WHOLEBODY_133_TO_EDITOR,
)
from .processing.mmpose_dwpose import MMPoseDWPose
from .processing.onnx_vitpose import OnnxViTPose
from .processing.smooth import smooth_sequence
from .models import ensure_dwpose_assets, ensure_vitpose_assets
from .schemas import ExportRequest, ProcessorOptions

app = FastAPI(title="Pose Processor")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_hf_cache = {}
_onnx_cache = {}
_mmpose_cache = {}
_uvicorn_logger = logging.getLogger("uvicorn.error")
logger = _uvicorn_logger.getChild("pose")
logger.setLevel(logging.INFO)
logger.propagate = True
PROGRESS_INTERVAL = max(1, int(os.environ.get("POSE_PROGRESS_INTERVAL", "10")))


def _json_response(data):
    return JSONResponse(content=json.loads(orjson.dumps(data)))


def _normalize_point(x, y, width, height):
    nx = (x / width) * 2.0 - 1.0
    ny = 1.0 - (y / height) * 2.0
    return float(nx), float(ny)


def _get_hf_pipe(device, variant, det_path, pose_path, dataset_index):
    ds_key = dataset_index if dataset_index is not None else "none"
    key = f"vitpose:{variant}:{ds_key}:{device}"
    if key not in _hf_cache:
        _hf_cache[key] = HFViTPose(
            det_path, pose_path, device=device, pose_dataset_index=dataset_index)
    return _hf_cache[key]


def _get_onnx_pipe(device, variant, det_path, pose_path):
    key = f"vitpose-onnx:{variant}:{device}"
    if key not in _onnx_cache:
        _onnx_cache[key] = OnnxViTPose(det_path, pose_path, device=device)
    return _onnx_cache[key]


def _get_mmpose_pipe(cfg, ckpt, device, det_model="rtmdet-s", det_weights=None):
    key = f"dwpose:{cfg}:{ckpt}:{device}:{det_model}:{det_weights or 'none'}"
    if key not in _mmpose_cache:
        _mmpose_cache[key] = MMPoseDWPose(
            cfg,
            ckpt,
            device=device,
            det_model=det_model,
            det_weights=det_weights,
        )
    return _mmpose_cache[key]


def _maybe_log_progress(stage, current, total):
    if total <= 0:
        return
    if current == total or current % PROGRESS_INTERVAL == 0:
        percent = (current / total) * 100.0
        logger.info("%s progress: %d/%d (%.1f%%)",
                    stage, current, total, percent)


@app.post("/process")
async def process(video: UploadFile = File(...), options: str = Form(...)):
    opts = ProcessorOptions.model_validate_json(options)

    suffix = os.path.splitext(video.filename or "video.mp4")[1] or ".mp4"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(await video.read())
        src_path = tmp.name

    decode_start = time.perf_counter()
    try:
        frames, meta = read_video_frames(
            src_path,
            target_fps=opts.fps,
            resize_width=opts.resizeWidth,
            resize_height=opts.resizeHeight,
        )
    finally:
        Path(src_path).unlink(missing_ok=True)

    decode_duration = time.perf_counter() - decode_start
    total_frames = frames.shape[0]
    height, width = frames.shape[1], frames.shape[2]
    effective_fps = float(meta.get("fps") or opts.fps or 24)
    k2d_frames = []

    logger.info(
        "Pose request backend=%s model=%s variant=%s frames=%d size=%dx%d fps=%.2f (decode %.2fs)",
        opts.backend,
        opts.model,
        getattr(opts, "vitposeVariant", "-"),
        total_frames,
        width,
        height,
        effective_fps,
        decode_duration,
    )

    if opts.backend == "hf":
        if opts.model != "vitpose":
            return _json_response({"error": "HF backend currently supports model='vitpose' only"})
        det_path, pose_path, dataset_index, pose_format, body_profile = ensure_vitpose_assets(
            opts.vitposeVariant)
        if pose_format == "onnx":
            pipe = _get_onnx_pipe(
                opts.device, opts.vitposeVariant, det_path, pose_path)
            stage_name = f"ONNX:{opts.vitposeVariant}"
        else:
            pipe = _get_hf_pipe(opts.device, opts.vitposeVariant,
                                det_path, pose_path, dataset_index)
            stage_name = f"HF:{opts.vitposeVariant}"
        if body_profile == "vitpose_wholebody_133":
            map_source = MAP_VITPOSE_WHOLEBODY_133_TO_EDITOR
        else:
            map_source = MAP_VITPOSE_17_TO_EDITOR
        mapping = {str(k): v for k, v in map_source.items()}

        logger.info("Running %s over %d frames on %s",
                    stage_name, total_frames, opts.device)
        for idx, frame in enumerate(frames):
            persons = pipe.infer_frame(frame, person_mode=opts.personMode)
            person_dicts = []
            for xy, sc in persons:
                entry = {}
                for j_idx, joint_id in map_source.items():
                    x, y = xy[j_idx]
                    nx, ny = _normalize_point(x, y, width, height)
                    entry[joint_id] = {"x": nx, "y": ny, "c": float(sc[j_idx])}
                person_dicts.append(entry)
            if not person_dicts:
                person_dicts = [{}]
            if opts.personMode == "single" and person_dicts:
                person_dicts = [person_dicts[0]]
            k2d_frames.append({"frame": idx, "time": idx /
                              effective_fps, "persons": person_dicts})
            _maybe_log_progress(stage_name, idx + 1, total_frames)

    else:
        if opts.model != "dwpose":
            return _json_response({"error": "MMPose backend expects model='dwpose'"})
        dwpose_cfg, dwpose_ckpt = ensure_dwpose_assets()
        pipe = _get_mmpose_pipe(dwpose_cfg, dwpose_ckpt, opts.device)
        body_profile = "dwpose_body_25"
        mapping = {str(k): v for k, v in MAP_DWPOSE_25_TO_EDITOR.items()}

        logger.info("Running DWPose over %d frames on %s",
                    total_frames, opts.device)
        for idx, frame in enumerate(frames):
            persons = pipe.infer_frame(frame, person_mode=opts.personMode)
            person_dicts = []
            for arr in persons:
                entry = {}
                for j_idx, joint_id in MAP_DWPOSE_25_TO_EDITOR.items():
                    x, y, c = arr[j_idx]
                    nx, ny = _normalize_point(
                        float(x), float(y), width, height)
                    entry[joint_id] = {"x": nx, "y": ny, "c": float(c)}
                person_dicts.append(entry)
            if not person_dicts:
                person_dicts = [{}]
            if opts.personMode == "single" and person_dicts:
                person_dicts = [person_dicts[0]]
            k2d_frames.append({"frame": idx, "time": idx /
                              effective_fps, "persons": person_dicts})
            _maybe_log_progress("DWPose", idx + 1, total_frames)

    # smoothing for first person track
    if k2d_frames and k2d_frames[0].get("persons") and k2d_frames[0]["persons"][0]:
        joint_ids = list(k2d_frames[0]["persons"][0].keys())
        sequence = []
        for fr in k2d_frames:
            if fr["persons"] and fr["persons"][0]:
                sequence.append({jid: (fr["persons"][0][jid]["x"], fr["persons"]
                                [0][jid]["y"], fr["persons"][0][jid]["c"]) for jid in joint_ids})
            else:
                sequence.append({jid: (np.nan, np.nan, 0.0)
                                for jid in joint_ids})
        smoothed = smooth_sequence(
            sequence, joint_ids, effective_fps, mode=opts.smooth.type, strength=opts.smooth.strength)
        for idx, fr in enumerate(k2d_frames):
            if not fr["persons"] or not fr["persons"][0]:
                continue
            for jid in joint_ids:
                fr["persons"][0][jid]["x"] = smoothed[idx][jid][0]
                fr["persons"][0][jid]["y"] = smoothed[idx][jid][1]

    k3d = None
    if opts.lift3D is not None and k2d_frames and k2d_frames[0].get("persons") and k2d_frames[0]["persons"][0]:
        joint_ids = list(k2d_frames[0]["persons"][0].keys())
        seq2d = []
        seq_frames = []
        for fr in k2d_frames:
            if not fr["persons"] or not fr["persons"][0]:
                continue
            seq2d.append({jid: (fr["persons"][0][jid]["x"], fr["persons"][0]
                         [jid]["y"], fr["persons"][0][jid]["c"]) for jid in joint_ids})
            seq_frames.append(fr["frame"])
        lifter = get_lifter(opts.lift3D.model, opts.device, fps=effective_fps)
        lifted = lifter(seq2d, joint_ids)
        k3d = []
        for idx, pose in enumerate(lifted):
            k3d.append({
                "frame": seq_frames[idx] if idx < len(seq_frames) else idx,
                "persons": [
                    {jid: {"x": pose[jid][0], "y": pose[jid][1], "z": pose[jid]
                           [2], "c": pose[jid][3]} for jid in joint_ids}
                ],
            })

    result = {
        "meta": {
            "source": meta,
            "effectiveFps": effective_fps,
            "model": opts.model,
            "bodyProfile": body_profile,
            "mapping": mapping,
        },
        "kpts2d": k2d_frames,
        "kpts3d": k3d,
    }
    return _json_response(result)


@app.post("/export/skeleton")
async def export_skeleton(req: ExportRequest):
    frames = []
    for frame in req.frames:
        if frame.persons:
            person = frame.persons[0]
            frames.append({jid: kp.model_dump() for jid, kp in person.items()})
        else:
            frames.append({})
    out = export_skeleton_mp4(
        frames, req.width, req.height, req.fps, req.outPath, req.bones)
    return {"ok": True, "path": out}
