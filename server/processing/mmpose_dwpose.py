"""MMPose inferencer wrapper for DWPose."""

import numpy as np

from .. import compat as _compat  # noqa: F401  # Ensure compatibility patches apply in standalone usage.

try:
    from mmpose.apis import MMPoseInferencer
except ModuleNotFoundError as exc:  # pragma: no cover - import guard
    if exc.name == "mmcv":
        raise ModuleNotFoundError(
            "mmcv is required for the DWPose backend. Install it via `pip install \"mmcv>=2.0.0\"` in your virtualenv."
        ) from exc
    raise


class MMPoseDWPose:
    def __init__(
        self,
        dwpose_cfg,
        dwpose_ckpt,
        device="cpu",
        det_model="rtmdet-s",
        det_weights=None,
    ):
        self.inf = MMPoseInferencer(
            pose2d=dwpose_cfg,
            pose2d_weights=dwpose_ckpt,
            det_model=det_model,
            det_weights=det_weights,
            det_cat_ids=0,
            device=device,
        )

    def infer_frame(self, frame, person_mode="single"):
        iterator = self.inf(frame, return_vis=False, show=False)
        result = next(iterator)
        persons = []
        if not result:
            return persons
        preds = result.get("predictions") or []
        if not preds:
            return persons
        keypoints = preds[0].get("keypoints", [])
        if not keypoints:
            return persons
        if person_mode == "single" and len(keypoints) > 1:
            idx = int(np.argmax([np.mean(p[:, 2]) for p in keypoints]))
            keypoints = [keypoints[idx]]
        for arr in keypoints:
            persons.append(np.asarray(arr))
        return persons
