"""Runtime compatibility helpers for OpenMMLab dependencies."""

import importlib.util
import sys
import types
from pathlib import Path


_PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _ensure_repo_on_path():
    """Keep repo root ahead of site-packages so local shims win."""

    root = str(_PROJECT_ROOT)
    if root not in sys.path:
        sys.path.insert(0, root)


def _patch_mmcv_version():
    """Relax MMDetection's strict mmcv version guard when needed."""

    try:
        import mmcv  # type: ignore
    except Exception:
        return

    version = getattr(mmcv, "__version__", "")
    if version and version >= "2.2.0":
        mmcv.__version__ = "2.1.0"


def _stub_optional_mmpose_modules():
    """Provide fallbacks for modules that require missing C++ ops."""

    if importlib.util.find_spec("mmcv._ext") is not None:
        return

    module_name = "mmpose.models.heads.transformer_heads"
    if module_name in sys.modules:
        return

    stub = types.ModuleType(module_name)

    class _UnavailableEDPoseHead:  # pragma: no cover
        def __init__(self, *args, **kwargs):
            raise RuntimeError(
                "EDPoseHead requires mmcv CUDA/C++ ops that are unavailable in this build."
            )

    stub.EDPoseHead = _UnavailableEDPoseHead
    sys.modules[module_name] = stub


def apply():
    _ensure_repo_on_path()
    _patch_mmcv_version()
    _stub_optional_mmpose_modules()


apply()
