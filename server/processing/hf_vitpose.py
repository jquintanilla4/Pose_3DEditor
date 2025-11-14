"""Hugging Face ViTPose + RT-DETR pipeline."""

import numpy as np
import torch
from PIL import Image
from transformers import AutoProcessor, RTDetrForObjectDetection, VitPoseForPoseEstimation


def _pick_device(requested):
    if requested == "cuda" and torch.cuda.is_available():
        return "cuda"
    return "cpu"


class HFViTPose:
    """Small helper that wraps RT-DETR + ViTPose following HF docs."""

    def __init__(
        self,
        detector_path,
        vitpose_path,
        device="cpu",
        pose_dataset_index=None,
    ):
        self.device = _pick_device(device)
        self.det_proc = AutoProcessor.from_pretrained(detector_path)
        self.det_model = RTDetrForObjectDetection.from_pretrained(detector_path).to(self.device)
        self.pose_proc = AutoProcessor.from_pretrained(vitpose_path)
        self.pose_model = VitPoseForPoseEstimation.from_pretrained(vitpose_path).to(self.device)
        self.pose_dataset_index = pose_dataset_index

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
        boxes_voc = processed["boxes"][mask]
        scores = processed["scores"][mask]
        boxes = boxes_voc.clone()
        boxes[:, 2] -= boxes[:, 0]
        boxes[:, 3] -= boxes[:, 1]

        if person_mode == "single":
            top_idx = int(torch.argmax(scores))
            boxes = boxes[top_idx : top_idx + 1]

        pose_inputs = self.pose_proc(image, boxes=[boxes], return_tensors="pt").to(self.device)
        dataset_kwargs = {}
        if self.pose_dataset_index is not None:
            batch = pose_inputs["pixel_values"].shape[0]
            dataset_tensor = torch.full((batch,), self.pose_dataset_index, dtype=torch.long, device=self.device)
            dataset_kwargs["dataset_index"] = dataset_tensor
        pose_outputs = self.pose_model(**pose_inputs, **dataset_kwargs)
        pose_results = self.pose_proc.post_process_pose_estimation(pose_outputs, boxes=[boxes])[0]

        persons = []
        for result in pose_results:
            keypoints = result["keypoints"].cpu().numpy()
            confidences = result["scores"].cpu().numpy()
            persons.append((keypoints, confidences))
        return persons
