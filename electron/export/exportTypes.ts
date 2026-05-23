export type ExportAspectRatio = "16:9" | "9:16" | "1:1" | "4:5" | "3:4" | "4:3" | "21:9";
export type ExportResolution = "720p" | "1080p" | "source";
export type ExportQuality = "small" | "standard" | "high";
export type ExportPreset = "publish" | "edit" | "share" | "webm";

export type ExportJobStatus =
  | "queued"
  | "preparing"
  | "planning"
  | "rendering"
  | "encoding"
  | "muxing"
  | "finalizing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ExportStage = Exclude<ExportJobStatus, "queued" | "succeeded" | "failed" | "cancelled">;

export type ExportProfile = {
  preset: Exclude<ExportPreset, "webm">;
  container: "mp4";
  videoCodec: "h264";
  audioCodec: "aac" | "none";
  width: number;
  height: number;
  fps: number;
  pixelFormat: "yuv420p";
  quality: ExportQuality;
};

export const EXPORT_PRESETS: readonly ExportPreset[] = ["publish", "edit", "share", "webm"];
export const EXPORT_JOB_STATUSES: readonly ExportJobStatus[] = [
  "queued",
  "preparing",
  "planning",
  "rendering",
  "encoding",
  "muxing",
  "finalizing",
  "succeeded",
  "failed",
  "cancelled",
];
export const EXPORT_STAGES: readonly ExportStage[] = ["preparing", "planning", "rendering", "encoding", "muxing", "finalizing"];

const PRODUCTION_PRESETS: readonly ExportProfile["preset"][] = ["publish", "edit", "share"];
const AUDIO_CODECS: readonly ExportProfile["audioCodec"][] = ["aac", "none"];
const EXPORT_QUALITIES: readonly ExportQuality[] = ["small", "standard", "high"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isMp4ExportProfile(value: unknown): value is ExportProfile {
  if (!isRecord(value)) {
    return false;
  }

  const { width, height, fps } = value;

  return (
    PRODUCTION_PRESETS.includes(value.preset as ExportProfile["preset"]) &&
    value.container === "mp4" &&
    value.videoCodec === "h264" &&
    AUDIO_CODECS.includes(value.audioCodec as ExportProfile["audioCodec"]) &&
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0 &&
    typeof fps === "number" &&
    Number.isFinite(fps) &&
    fps > 0 &&
    value.pixelFormat === "yuv420p" &&
    EXPORT_QUALITIES.includes(value.quality as ExportQuality)
  );
}
