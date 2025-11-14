"""Pydantic schemas shared across pose endpoints."""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel

PoseModelKind = Literal["vitpose", "dwpose"]
VitPoseVariant = Literal["base-simple", "l-wholebody", "l-wholebody-onnx"]


class Lift3DOpts(BaseModel):
    model: Literal["videopose3d"] = "videopose3d"
    receptiveFrames: int = 27
    scaleToRig: bool = True


class SmoothOpts(BaseModel):
    type: Literal["oneEuro", "savgol"] = "oneEuro"
    strength: float = 0.6


class ProcessorOptions(BaseModel):
    backend: Literal["hf", "mmpose"] = "hf"
    model: PoseModelKind = "vitpose"
    vitposeVariant: VitPoseVariant = "base-simple"
    device: Literal["cpu", "cuda"] = "cpu"
    fps: int = 24
    resizeWidth: Optional[int] = None
    resizeHeight: Optional[int] = None
    personMode: Literal["single", "multi"] = "single"
    includeHands: bool = False
    includeFace: bool = False
    smooth: SmoothOpts = SmoothOpts()
    lift3D: Optional[Lift3DOpts] = Lift3DOpts()


class Keypoint2D(BaseModel):
    x: float
    y: float
    c: float


class Frame2D(BaseModel):
    frame: int
    time: float
    persons: List[Dict[str, Keypoint2D]]


class Keypoint3D(BaseModel):
    x: float
    y: float
    z: float
    c: float


class Frame3D(BaseModel):
    frame: int
    persons: List[Dict[str, Keypoint3D]]


class ProcessMeta(BaseModel):
    source: Dict[str, float]
    effectiveFps: float
    model: PoseModelKind
    bodyProfile: Literal["vitpose_body_17", "vitpose_wholebody_133", "dwpose_body_25"]
    mapping: Dict[str, str]


class ProcessResult(BaseModel):
    meta: ProcessMeta
    kpts2d: List[Frame2D]
    kpts3d: Optional[List[Frame3D]] = None


class ExportRequest(BaseModel):
    width: int
    height: int
    fps: int
    bones: List[List[str]]
    frames: List[Frame2D]
    outPath: str = "out.mp4"
    skeletonOnly: bool = True


__all__ = [
    "ExportRequest",
    "Frame2D",
    "Frame3D",
    "Keypoint2D",
    "Keypoint3D",
    "Lift3DOpts",
    "ProcessMeta",
    "ProcessResult",
    "ProcessorOptions",
    "SmoothOpts",
]

