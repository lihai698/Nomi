import type { NomiRenderAsset, NomiRenderClip, NomiRenderManifestV1, NomiRenderTrack } from "./exportManifest";

export type FfmpegFiltergraphInput = {
  manifest: NomiRenderManifestV1;
};

export type FfmpegFiltergraphPlanInput = {
  assetId: string;
  path: string;
  kind: "image" | "video" | "audio";
  inputArgs: string[];
};

export type FfmpegFiltergraphPlan = {
  inputs: FfmpegFiltergraphPlanInput[];
  filterComplex: string;
  videoOutputLabel: string;
  audioOutputLabel?: string;
  warnings: string[];
};

export type FfmpegFiltergraphErrorCode =
  | "missing_asset"
  | "unsupported_audio"
  | "unsupported_clip"
  | "invalid_manifest";

export class FfmpegFiltergraphError extends Error {
  readonly code: FfmpegFiltergraphErrorCode;

  constructor(code: FfmpegFiltergraphErrorCode, message: string) {
    super(message);
    this.name = "FfmpegFiltergraphError";
    this.code = code;
  }
}

type ResolvedClip = {
  track: NomiRenderTrack;
  trackIndex: number;
  clip: NomiRenderClip;
  asset: NomiRenderAsset;
  inputIndex: number;
};

function secondsFromFrames(frames: number, fps: number): number {
  return frames / fps;
}

function formatSeconds(seconds: number): string {
  if (Number.isInteger(seconds)) return String(seconds);
  return Number(seconds.toFixed(6)).toString();
}

function labelForClip(clipId: string, suffix: string): string {
  const safeId = clipId.replace(/[^a-zA-Z0-9_]/g, "_");
  return `clip_${safeId}_${suffix}`;
}

function isAudioTrack(track: NomiRenderTrack): boolean {
  return track.kind === "audio" || track.type === "audio";
}

function isVisualTrack(track: NomiRenderTrack): boolean {
  return track.kind === "visual" || track.kind === "video" || track.type === "visual" || track.type === "video";
}

function collectReferencedClips(manifest: NomiRenderManifestV1): ResolvedClip[] {
  const inputIndexByAssetId = new Map<string, number>();
  const resolved: ResolvedClip[] = [];

  manifest.timeline.tracks.forEach((track, trackIndex) => {
    track.clips.forEach((clip) => {
      if (!clip.assetId) {
        throw new FfmpegFiltergraphError("unsupported_clip", `Clip ${clip.id} has no assetId`);
      }

      const asset = manifest.assets[clip.assetId];
      if (!asset) {
        throw new FfmpegFiltergraphError("missing_asset", `Clip ${clip.id} references missing asset ${clip.assetId}`);
      }

      let inputIndex = inputIndexByAssetId.get(asset.id);
      if (inputIndex === undefined) {
        inputIndex = inputIndexByAssetId.size;
        inputIndexByAssetId.set(asset.id, inputIndex);
      }

      resolved.push({ track, trackIndex, clip, asset, inputIndex });
    });
  });

  return resolved;
}

function buildInputs(resolvedClips: ResolvedClip[], fps: number): FfmpegFiltergraphPlanInput[] {
  const byAsset = new Map<string, ResolvedClip[]>();
  for (const resolvedClip of resolvedClips) {
    byAsset.set(resolvedClip.asset.id, [...(byAsset.get(resolvedClip.asset.id) ?? []), resolvedClip]);
  }

  return [...byAsset.values()].map((clips) => {
    const { asset } = clips[0];
    const maxDurationSeconds = Math.max(...clips.map(({ clip }) => secondsFromFrames(clip.endFrame - clip.startFrame, fps)));

    return {
      assetId: asset.id,
      path: asset.absolutePath,
      kind: asset.kind,
      inputArgs: asset.kind === "image" ? ["-loop", "1", "-t", formatSeconds(maxDurationSeconds)] : [],
    };
  });
}

function assertSupportedAudio(
  audioClips: ResolvedClip[],
  profileAudioCodec: NomiRenderManifestV1["profile"]["audioCodec"],
  fps: number,
): string | undefined {
  if (profileAudioCodec === "none" || audioClips.length === 0) return undefined;

  const audioTrackIds = new Set(audioClips.map(({ track }) => track.id));
  if (audioTrackIds.size > 1 || audioClips.length > 1) {
    throw new FfmpegFiltergraphError(
      "unsupported_audio",
      "Multi-track or multi-clip audio requires delay/fade/amix support and is not implemented yet",
    );
  }

  const [{ clip, inputIndex }] = audioClips;
  const startMs = Math.round(secondsFromFrames(clip.startFrame, fps) * 1000);
  return `[${inputIndex}:a]asetpts=PTS-STARTPTS,adelay=${startMs}|${startMs}[aout]`;
}

function buildVisualGraph(manifest: NomiRenderManifestV1, visualClips: ResolvedClip[]): string[] {
  const { profile } = manifest;
  const fps = manifest.timeline.fps;
  const durationSeconds = secondsFromFrames(manifest.timeline.durationFrames, fps);
  const filters = [`color=black:size=${profile.width}x${profile.height}:rate=${fps}:duration=${formatSeconds(durationSeconds)}[base]`];

  const orderedVisualClips = [...visualClips].sort((left, right) => {
    return (
      left.trackIndex - right.trackIndex ||
      left.clip.startFrame - right.clip.startFrame ||
      left.clip.id.localeCompare(right.clip.id)
    );
  });

  orderedVisualClips.forEach(({ clip, asset, inputIndex }) => {
    const segmentLabel = labelForClip(clip.id, "segment");
    const fittedLabel = labelForClip(clip.id, "fitted");
    const start = secondsFromFrames(clip.startFrame, fps);
    const duration = secondsFromFrames(clip.endFrame - clip.startFrame, fps);
    const timelineSetpts = `PTS-STARTPTS+${formatSeconds(start)}/TB`;

    if (asset.kind === "image") {
      filters.push(
        `[${inputIndex}:v]trim=duration=${formatSeconds(duration)},setpts=${timelineSetpts}[${segmentLabel}]`,
      );
    } else if (asset.kind === "video") {
      const sourceStart = secondsFromFrames(clip.sourceStartFrame ?? 0, fps);
      const sourceEnd = secondsFromFrames(clip.sourceEndFrame ?? (clip.sourceStartFrame ?? 0) + (clip.endFrame - clip.startFrame), fps);
      filters.push(
        `[${inputIndex}:v]trim=start=${formatSeconds(sourceStart)}:end=${formatSeconds(sourceEnd)},setpts=${timelineSetpts}[${segmentLabel}]`,
      );
    } else {
      throw new FfmpegFiltergraphError("unsupported_clip", `Asset ${asset.id} is not visual`);
    }

    filters.push(
      `[${segmentLabel}]scale=${profile.width}:${profile.height}:force_original_aspect_ratio=decrease,` +
        `pad=${profile.width}:${profile.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=${profile.pixelFormat}[${fittedLabel}]`,
    );
  });

  let baseLabel = "base";
  orderedVisualClips.forEach(({ clip }, index) => {
    const fittedLabel = labelForClip(clip.id, "fitted");
    const outputLabel = index === orderedVisualClips.length - 1 ? "vout" : `vstack${index}`;
    const start = secondsFromFrames(clip.startFrame, fps);
    const end = secondsFromFrames(clip.endFrame, fps);
    filters.push(
      `[${baseLabel}][${fittedLabel}]overlay=shortest=0:eof_action=pass:enable='gte(t,${formatSeconds(start)})*lt(t,${formatSeconds(end)})'[${outputLabel}]`,
    );
    baseLabel = outputLabel;
  });

  if (orderedVisualClips.length === 0) {
    filters.push("[base]format=yuv420p[vout]");
  }

  return filters;
}

export function compileFfmpegFiltergraph(input: FfmpegFiltergraphInput): FfmpegFiltergraphPlan {
  const { manifest } = input;
  const fps = manifest.timeline.fps;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new FfmpegFiltergraphError("invalid_manifest", `Invalid timeline fps: ${fps}`);
  }

  const resolvedClips = collectReferencedClips(manifest);
  const visualClips = resolvedClips.filter(({ track, asset }) => isVisualTrack(track) || asset.kind === "image" || asset.kind === "video");
  const audioClips = resolvedClips.filter(({ track, asset }) => isAudioTrack(track) || asset.kind === "audio");

  const audioFilter = assertSupportedAudio(audioClips, manifest.profile.audioCodec, fps);
  const filters = buildVisualGraph(manifest, visualClips);
  if (audioFilter) filters.push(audioFilter);

  return {
    inputs: buildInputs(resolvedClips, fps),
    filterComplex: filters.join(";"),
    videoOutputLabel: "[vout]",
    audioOutputLabel: audioFilter ? "[aout]" : undefined,
    warnings: [],
  };
}
