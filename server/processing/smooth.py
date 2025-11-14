"""Temporal smoothing helpers."""

import math

import numpy as np
from scipy.signal import savgol_filter

def _interp_nans(values):
    arr = values.astype(np.float32, copy=True)
    mask = ~np.isfinite(arr)
    if not mask.any():
        return arr
    valid = np.where(np.isfinite(arr))[0]
    if not len(valid):
        return np.zeros_like(arr)
    arr[mask] = np.interp(np.where(mask)[0], valid, arr[valid])
    return arr


def _lowpass(prev, value, alpha):
    return alpha * value + (1.0 - alpha) * prev


def _alpha(cutoff, dt):
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


def _one_euro(series, fps, strength):
    dt = 1.0 / max(1e-3, fps)
    min_cutoff = np.interp(strength, [0.0, 1.0], [2.5, 0.4])
    beta = np.interp(strength, [0.0, 1.0], [0.0, 1.0])
    d_cutoff = 1.0
    out = np.zeros_like(series)
    prev = series[0]
    dx_prev = 0.0
    out[0] = prev
    for i in range(1, len(series)):
        value = series[i]
        dx = (value - prev) / dt
        alpha_d = _alpha(d_cutoff, dt)
        dx_hat = _lowpass(dx_prev, dx, alpha_d)
        cutoff = min_cutoff + beta * abs(dx_hat)
        alpha_val = _alpha(cutoff, dt)
        prev = _lowpass(prev, value, alpha_val)
        dx_prev = dx_hat
        out[i] = prev
    return out


def _savgol(series, strength):
    if len(series) < 3:
        return series
    # Map strength -> odd window length between 3 and 21
    window = int(3 + strength * 18)
    if window % 2 == 0:
        window += 1
    if window >= len(series):
        window = len(series) - 1 if len(series) % 2 == 0 else len(series)
    if window < 3:
        window = 3
    poly = 2
    return savgol_filter(series, window_length=window, polyorder=poly)


def smooth_sequence(sequence, joint_ids, fps, mode="oneEuro", strength=0.6):
    joints = list(joint_ids)
    frames = len(sequence)
    data = np.zeros((frames, len(joints), 3), dtype=np.float32)
    data[:] = np.nan
    for fi, frame in enumerate(sequence):
        for ji, jid in enumerate(joints):
            if jid in frame:
                data[fi, ji] = frame[jid]

    for ji in range(len(joints)):
        for axis in range(2):  # only smooth XY; keep confidence raw
            column = data[:, ji, axis]
            filled = _interp_nans(column)
            if mode == "savgol":
                smoothed = _savgol(filled, strength)
            else:
                smoothed = _one_euro(filled, fps, strength)
            data[:, ji, axis] = smoothed

    out = []
    for fi in range(frames):
        frame_dict = {}
        for ji, jid in enumerate(joints):
            x, y, c = data[fi, ji]
            if not math.isfinite(x) or not math.isfinite(y):
                continue
            frame_dict[jid] = (float(x), float(y), float(c if math.isfinite(c) else 0.0))
        out.append(frame_dict)
    return out
