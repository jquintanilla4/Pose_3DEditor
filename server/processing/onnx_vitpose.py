"""ONNXRuntime-backed ViTPose pipeline (RT-DETR detector + ViTPose wholebody head)."""

from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
import torch
from PIL import Image
from transformers import AutoProcessor, RTDetrForObjectDetection

POSE_INPUT_SIZE = (192, 256)  # width, height
PIXEL_STD = 200.0
SCALE_FACTOR = 1.25
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def _pick_device(requested):
    if requested == "cuda" and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _select_providers(device):
    providers = ort.get_available_providers()
    if device == "cuda" and "CUDAExecutionProvider" in providers:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def _box_xywh(box_tensor):
    boxes = box_tensor.detach().clone()
    boxes[:, 2] -= boxes[:, 0]
    boxes[:, 3] -= boxes[:, 1]
    return boxes.cpu().numpy()


def _box_to_center_scale(box):
    x, y, w, h = box.tolist()
    if w < 1e-6 or h < 1e-6:
        return np.array([0.0, 0.0], dtype=np.float32), np.array([1.0, 1.0], dtype=np.float32)
    center = np.array([x + w * 0.5, y + h * 0.5], dtype=np.float32)
    aspect_ratio = POSE_INPUT_SIZE[0] / POSE_INPUT_SIZE[1]
    if w > aspect_ratio * h:
        h = w / aspect_ratio
    elif w < aspect_ratio * h:
        w = h * aspect_ratio
    scale = np.array([w / PIXEL_STD, h / PIXEL_STD], dtype=np.float32)
    scale = np.maximum(scale, 1e-3)
    scale *= SCALE_FACTOR
    return center, scale


def _get_dir(src_point, rot_rad):
    sin, cos = np.sin(rot_rad), np.cos(rot_rad)
    return np.array(
        [src_point[0] * cos - src_point[1] * sin, src_point[0] * sin + src_point[1] * cos],
        dtype=np.float32,
    )


def _get_3rd_point(a, b):
    direct = a - b
    return b + np.array([-direct[1], direct[0]], dtype=np.float32)


def _get_affine_transform(
    center,
    scale,
    rot,
    output_size,
    shift=(0.0, 0.0),
    inv=False,
):
    scale_tmp = scale * PIXEL_STD
    src_w = scale_tmp[0]
    dst_w, dst_h = output_size
    rot_rad = np.pi * rot / 180.0
    src_dir = _get_dir(np.array([0.0, src_w * -0.5], dtype=np.float32), rot_rad)
    dst_dir = np.array([0.0, dst_w * -0.5], dtype=np.float32)

    src = np.zeros((3, 2), dtype=np.float32)
    dst = np.zeros((3, 2), dtype=np.float32)
    src[0, :] = center + scale_tmp * shift
    src[1, :] = center + src_dir + scale_tmp * shift
    dst[0, :] = [dst_w * 0.5, dst_h * 0.5]
    dst[1, :] = np.array([dst_w * 0.5, dst_h * 0.5]) + dst_dir
    src[2, :] = _get_3rd_point(src[0, :], src[1, :])
    dst[2, :] = _get_3rd_point(dst[0, :], dst[1, :])

    if inv:
        return cv2.getAffineTransform(np.float32(dst), np.float32(src))
    return cv2.getAffineTransform(np.float32(src), np.float32(dst))


def _affine_transform(point, mat):
    augmented = np.array([point[0], point[1], 1.0], dtype=np.float32)
    return (mat @ augmented)[:2]


def _max_preds(heatmaps):
    n, k, h, w = heatmaps.shape
    reshaped = heatmaps.reshape(n, k, -1)
    idx = np.argmax(reshaped, axis=2)
    maxvals = np.max(reshaped, axis=2)
    maxvals = maxvals.reshape(n, k, 1)
    preds = np.tile(idx.reshape(n, k, 1), (1, 1, 2)).astype(np.float32)
    preds[..., 0] = idx % w
    preds[..., 1] = idx // w
    pred_mask = (maxvals > 0.0).astype(np.float32)
    preds *= pred_mask
    return preds, maxvals.squeeze(-1)


def _refine(coords, heatmaps):
    n, k = coords.shape[:2]
    _, _, h, w = heatmaps.shape
    for i in range(n):
        for j in range(k):
            px, py = int(coords[i, j, 0]), int(coords[i, j, 1])
            if 1 < px < w - 1 and 1 < py < h - 1:
                diff = np.array(
                    [
                        heatmaps[i, j, py, px + 1] - heatmaps[i, j, py, px - 1],
                        heatmaps[i, j, py + 1, px] - heatmaps[i, j, py - 1, px],
                    ],
                    dtype=np.float32,
                )
                coords[i, j] += np.sign(diff) * 0.25
    return coords


def _transform_preds(
    coords,
    centers,
    scales,
    output_size,
):
    for i, coord in enumerate(coords):
        trans = _get_affine_transform(centers[i], scales[i], 0, output_size, inv=True)
        for j in range(coord.shape[0]):
            coords[i, j, 0:2] = _affine_transform(coord[j], trans)
    return coords


class _PoseSample:
    def __init__(self, input_tensor, center, scale):
        self.input_tensor = input_tensor
        self.center = center
        self.scale = scale


class OnnxViTPose:
    """Hybrid RT-DETR detector + ViTPose ONNX head."""

    def __init__(self, detector_path, pose_model_path, device="cpu"):
        self.device = _pick_device(device)
        self.det_proc = AutoProcessor.from_pretrained(detector_path)
        self.det_model = RTDetrForObjectDetection.from_pretrained(detector_path).to(self.device)

        pose_path = Path(pose_model_path)
        if not pose_path.exists():
            raise FileNotFoundError(f"ONNX ViTPose model missing at {pose_path}")
        providers = _select_providers(self.device)
        sess_options = ort.SessionOptions()
        sess_options.enable_mem_pattern = False
        sess_options.enable_cpu_mem_arena = True
        self.session = ort.InferenceSession(
            str(pose_path),
            sess_options=sess_options,
            providers=providers,
        )
        self.input_name = self.session.get_inputs()[0].name
        self.output_name = self.session.get_outputs()[0].name

    def _prepare_samples(self, frame, boxes_xywh):
        samples = []
        for box in boxes_xywh:
            center, scale = _box_to_center_scale(box)
            trans = _get_affine_transform(center, scale, 0, POSE_INPUT_SIZE)
            crop = cv2.warpAffine(frame, trans, POSE_INPUT_SIZE, flags=cv2.INTER_LINEAR)
            crop = crop.astype(np.float32) / 255.0
            crop = (crop - MEAN) / STD
            crop = crop.transpose(2, 0, 1)[None, ...]
            samples.append(_PoseSample(crop, center, scale))
        return samples

    @torch.no_grad()
    def infer_frame(
        self,
        frame,
        person_mode="single",
        det_threshold=0.35,
    ):
        image = Image.fromarray(frame)
        det_inputs = self.det_proc(images=image, return_tensors="pt").to(self.device)
        det_outputs = self.det_model(**det_inputs)
        processed = self.det_proc.post_process_object_detection(
            det_outputs,
            target_sizes=torch.tensor([(image.height, image.width)], device=self.device),
            threshold=det_threshold,
        )[0]
        mask = processed["labels"] == 0
        if not torch.any(mask):
            return []
        boxes_xyxy = processed["boxes"][mask]
        scores = processed["scores"][mask]
        if person_mode == "single":
            top_idx = int(torch.argmax(scores))
            boxes_xyxy = boxes_xyxy[top_idx : top_idx + 1]
        boxes_xywh = _box_xywh(boxes_xyxy)
        samples = self._prepare_samples(frame, boxes_xywh)
        if not samples:
            return []

        input_tensor = np.concatenate([s.input_tensor for s in samples], axis=0)
        heatmaps = self.session.run([self.output_name], {self.input_name: input_tensor})[0]
        persons = []
        centers = [s.center for s in samples]
        scales = [s.scale for s in samples]
        coords, confidences = self._decode_poses(heatmaps, centers, scales)
        for idx in range(coords.shape[0]):
            persons.append((coords[idx], confidences[idx]))
        return persons

    def _decode_poses(
        self,
        heatmaps,
        centers,
        scales,
    ):
        coords, maxvals = _max_preds(heatmaps)
        coords = _refine(coords, heatmaps)
        heatmap_h, heatmap_w = heatmaps.shape[2], heatmaps.shape[3]
        scale_x = POSE_INPUT_SIZE[0] / float(max(1, heatmap_w))
        scale_y = POSE_INPUT_SIZE[1] / float(max(1, heatmap_h))
        coords[..., 0] *= scale_x
        coords[..., 1] *= scale_y
        coords = _transform_preds(coords, centers, scales, POSE_INPUT_SIZE)
        conf = maxvals.astype(np.float32)
        return coords, conf


__all__ = ["OnnxViTPose"]
