import type {
  ExportSkeletonPayload,
  PoseProcessResult,
  PoseProcessorOptions,
  PoseModelKind,
  VitPoseVariant
} from "./types";

const DEFAULT_BASE_URL = import.meta.env.VITE_POSE_API ?? "http://localhost:8000";

export type ProcessVideoOptions = {
  backend?: "hf" | "mmpose";
  model: PoseModelKind;
  vitposeVariant?: VitPoseVariant;
  device?: "cpu" | "cuda";
  fps?: number;
  resizeWidth?: number;
  resizeHeight?: number;
  personMode?: "single" | "multi";
  includeHands?: boolean;
  includeFace?: boolean;
  smoothStrength?: number;
  lift3D?: boolean;
};

export async function processVideoPy(
  file: File,
  opts: ProcessVideoOptions,
  baseUrl: string = DEFAULT_BASE_URL
): Promise<PoseProcessResult> {
  const body = new FormData();
  body.append("video", file);
  const options: PoseProcessorOptions = {
    backend: opts.backend ?? "hf",
    model: opts.model,
    vitposeVariant: opts.vitposeVariant ?? "base-simple",
    device: opts.device ?? "cpu",
    fps: opts.fps ?? 24,
    resizeWidth: opts.resizeWidth ?? null,
    resizeHeight: opts.resizeHeight ?? null,
    personMode: opts.personMode ?? "single",
    includeHands: opts.includeHands ?? false,
    includeFace: opts.includeFace ?? false,
    smooth: { type: "oneEuro", strength: opts.smoothStrength ?? 0.6 },
    lift3D: opts.lift3D === false ? null : { model: "videopose3d", receptiveFrames: 27, scaleToRig: true }
  } as PoseProcessorOptions;
  body.append("options", JSON.stringify(options));
  const response = await fetch(`${baseUrl}/process`, { method: "POST", body });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Pose process failed (${response.status}): ${text}`);
  }
  return (await response.json()) as PoseProcessResult;
}

export async function exportSkeletonVideo(
  payload: ExportSkeletonPayload,
  baseUrl: string = DEFAULT_BASE_URL
): Promise<{ ok: boolean; path: string }> {
  const response = await fetch(`${baseUrl}/export/skeleton`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Export failed (${response.status}): ${text}`);
  }
  return (await response.json()) as { ok: boolean; path: string };
}
