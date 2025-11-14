"""Model asset management for the pose backend."""

import os
import shutil
import urllib.request
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

MODELS_ROOT = Path(__file__).resolve().parent.parent / "models"
DWPOSE_FOLDER = MODELS_ROOT / "dwpose"
DWPOSE_CFG_NAME = "dwpose_l-ll__coco-ubody-256x192.py"
DWPOSE_CFG_URL = (
    "https://raw.githubusercontent.com/IDEA-Research/DWPose/main/"
    "mmpose/configs/distiller/ubody/s2_dis/dwpose_l-ll__coco-ubody-256x192.py"
)
DWPOSE_CKPT_NAME = "dw-ll_ucoco_384.pth"
DWPOSE_CKPT_REPO = "camenduru/MuseTalk"
DWPOSE_CKPT_PATH = "dwpose/dw-ll_ucoco_384.pth"
VITPOSE_FOLDER = MODELS_ROOT / "vitpose"
RTDETR_FOLDER = MODELS_ROOT / "rtdetr"
RTDETR_REPO = "PekingU/rtdetr_r50vd_coco_o365"
VITPOSE_VARIANTS = {
    "base-simple": {
        "repo": os.environ.get("VITPOSE_BASE_REPO", "usyd-community/vitpose-base-simple"),
        "dataset_index": None,
        "body_profile": "vitpose_body_17",
        "format": "hf",
    },
    "l-wholebody": {
        "repo": os.environ.get("VITPOSE_LWHOLEBODY_REPO", "usyd-community/vitpose-plus-large"),
        "dataset_index": int(os.environ.get("VITPOSE_LWHOLEBODY_DATASET_INDEX", "5")),
        "body_profile": "vitpose_wholebody_133",
        "format": "hf",
    },
    "l-wholebody-onnx": {
        "repo": os.environ.get("VITPOSE_WHOLEBODY_ONNX_REPO", "JunkyByte/easy_ViTPose"),
        "dataset_index": None,
        "body_profile": "vitpose_wholebody_133",
        "format": "onnx",
        "download": {
            "type": os.environ.get("VITPOSE_WHOLEBODY_ONNX_DOWNLOAD", "hf_file"),
            "filename": os.environ.get(
                "VITPOSE_WHOLEBODY_ONNX_SUBPATH",
                "onnx/wholebody/vitpose-l-wholebody.onnx",
            ),
        },
    },
}
DEFAULT_VITPOSE_VARIANT = "base-simple"


def _download_file(url, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response, open(destination, "wb") as out:
        shutil.copyfileobj(response, out)


def _download_dwpose_cfg():
    cfg_path = DWPOSE_FOLDER / DWPOSE_CFG_NAME
    if cfg_path.exists():
        return cfg_path
    _download_file(DWPOSE_CFG_URL, cfg_path)
    return cfg_path


def _download_dwpose_ckpt():
    ckpt_path = DWPOSE_FOLDER / DWPOSE_CKPT_NAME
    if ckpt_path.exists():
        return ckpt_path
    ckpt_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = hf_hub_download(
        repo_id=DWPOSE_CKPT_REPO,
        filename=DWPOSE_CKPT_PATH,
        local_dir=ckpt_path.parent,
        resume_download=True,
    )
    if Path(tmp_path) != ckpt_path:
        shutil.move(tmp_path, ckpt_path)
    return ckpt_path


def _snapshot_model(repo_id, target_dir, allow_patterns=None):
    target_dir.mkdir(parents=True, exist_ok=True)
    marker = target_dir / ".complete"
    if marker.exists() and any(target_dir.iterdir()):
        return target_dir
    allow = list(allow_patterns) if allow_patterns else None
    snapshot_download(
        repo_id,
        local_dir=target_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
        allow_patterns=allow,
    )
    marker.touch(exist_ok=True)
    return target_dir


def _download_repo_file(repo_id, filename, target_dir):
    target_dir.mkdir(parents=True, exist_ok=True)
    path = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        local_dir=target_dir,
        local_dir_use_symlinks=False,
        resume_download=True,
    )
    return Path(path)


def ensure_dwpose_assets():
    """Ensure DW Pose config + checkpoint exist locally (downloading if needed)."""
    cfg_override = os.environ.get("DWPOSE_CFG")
    ckpt_override = os.environ.get("DWPOSE_CKPT")
    if cfg_override and ckpt_override:
        return cfg_override, ckpt_override

    cfg_path = _download_dwpose_cfg()
    ckpt_path = _download_dwpose_ckpt()

    os.environ.setdefault("DWPOSE_CFG", str(cfg_path))
    os.environ.setdefault("DWPOSE_CKPT", str(ckpt_path))
    return str(cfg_path), str(ckpt_path)


def ensure_vitpose_assets(variant=DEFAULT_VITPOSE_VARIANT):
    """Ensure RT-DETR + ViTPose checkpoints (Torch or ONNX) exist locally."""

    variant_key = variant or DEFAULT_VITPOSE_VARIANT
    variant_info = VITPOSE_VARIANTS.get(variant_key)
    if variant_info is None:
        raise ValueError(f"Unknown ViTPose variant '{variant}'.")

    det_override = os.environ.get("RTDETR_MODEL_DIR")
    pose_override = os.environ.get("VITPOSE_MODEL_DIR")

    dataset_index = variant_info.get("dataset_index")
    pose_format = str(variant_info.get("format", "hf"))
    body_profile = str(variant_info.get("body_profile", "vitpose_body_17"))
    allow_patterns = variant_info.get("snapshot_patterns")
    if isinstance(allow_patterns, str):
        allow_patterns = tuple(filter(None, (x.strip() for x in allow_patterns.split(","))))
    elif isinstance(allow_patterns, list):
        allow_patterns = tuple(str(x).strip() for x in allow_patterns if str(x).strip())
    elif allow_patterns is not None:
        allow_patterns = tuple(allow_patterns)

    det_path = det_override or _snapshot_model(RTDETR_REPO, RTDETR_FOLDER)

    download_info = variant_info.get("download") or {}
    download_type = str(download_info.get("type")) if download_info else None
    pose_artifact = None

    if download_type == "hf_file":
        filename = download_info.get("filename")
        if not filename:
            raise ValueError("hf_file download requires a filename")
        subpath = Path(str(filename))
        if pose_override:
            override_path = Path(pose_override)
            if override_path.is_dir():
                pose_artifact = override_path / subpath.name
            else:
                pose_artifact = override_path
        else:
            pose_artifact = _download_repo_file(
                str(variant_info["repo"]),
                str(filename),
                VITPOSE_FOLDER / variant_key,
            )
    else:
        pose_base_dir = pose_override or _snapshot_model(
            str(variant_info["repo"]),
            VITPOSE_FOLDER / variant_key,
            allow_patterns=allow_patterns,
        )
        pose_artifact = Path(pose_base_dir)
        subpath = variant_info.get("artifact_subpath")
        if subpath:
            subpath = Path(str(subpath))
            if pose_override:
                override_path = Path(pose_override)
                if override_path.is_dir():
                    pose_artifact = override_path / subpath
                else:
                    pose_artifact = override_path
            else:
                pose_artifact = pose_artifact / subpath

    if pose_artifact is None or not pose_artifact.exists():
        raise FileNotFoundError(f"ViTPose assets missing at {pose_artifact}. Delete the folder and retry download.")

    return str(det_path), str(pose_artifact), dataset_index, pose_format, body_profile


__all__ = ["ensure_dwpose_assets", "ensure_vitpose_assets"]
