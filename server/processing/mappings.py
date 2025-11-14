"""Joint index -> editor joint id maps for ViTPose and DWPose."""

MAP_VITPOSE_17_TO_EDITOR = {
    0: "nose",
    1: "leftEye",
    2: "rightEye",
    3: "leftEar",
    4: "rightEar",
    5: "leftShoulder",
    6: "rightShoulder",
    7: "leftElbow",
    8: "rightElbow",
    9: "leftWrist",
    10: "rightWrist",
    11: "leftHip",
    12: "rightHip",
    13: "leftKnee",
    14: "rightKnee",
    15: "leftAnkle",
    16: "rightAnkle",
}

MAP_DWPOSE_25_TO_EDITOR = {
    0: "nose",
    1: "neck",
    2: "rightShoulder",
    3: "rightElbow",
    4: "rightWrist",
    5: "leftShoulder",
    6: "leftElbow",
    7: "leftWrist",
    8: "midHip",
    9: "rightHip",
    10: "rightKnee",
    11: "rightAnkle",
    12: "leftHip",
    13: "leftKnee",
    14: "leftAnkle",
    15: "rightEye",
    16: "leftEye",
    17: "rightEar",
    18: "leftEar",
    19: "leftBigToe",
    20: "leftSmallToe",
    21: "leftHeel",
    22: "rightBigToe",
    23: "rightSmallToe",
    24: "rightHeel",
}


def _add_hand_section(start, side):
    """Create COCO-WholeBody style hand key mapping."""

    mapping = {start: f"{side}Palm"}
    idx = start + 1
    for finger in ["Thumb", "Index", "Middle", "Ring", "Pinky"]:
        for segment in range(1, 5):
            mapping[idx] = f"{side}{finger}{segment}"
            idx += 1
    return mapping


def _add_face_section(start, prefix, count):
    return {start + i: f"{prefix}{i}" for i in range(count)}


MAP_VITPOSE_WHOLEBODY_133_TO_EDITOR = dict(MAP_VITPOSE_17_TO_EDITOR)
MAP_VITPOSE_WHOLEBODY_133_TO_EDITOR.update(
    {
        17: "leftBigToe",
        18: "leftSmallToe",
        19: "leftHeel",
        20: "rightBigToe",
        21: "rightSmallToe",
        22: "rightHeel",
    }
)
MAP_VITPOSE_WHOLEBODY_133_TO_EDITOR.update(_add_hand_section(23, "left"))
MAP_VITPOSE_WHOLEBODY_133_TO_EDITOR.update(_add_hand_section(44, "right"))

face_idx = 65
for prefix, count in [
    ("faceContour", 17),
    ("rightEyebrow", 5),
    ("leftEyebrow", 5),
    ("noseBridge", 4),
    ("noseLower", 5),
    ("rightEye", 6),
    ("leftEye", 6),
    ("outerLip", 12),
    ("innerLip", 8),
]:
    section = _add_face_section(face_idx, prefix, count)
    MAP_VITPOSE_WHOLEBODY_133_TO_EDITOR.update(section)
    face_idx += count
