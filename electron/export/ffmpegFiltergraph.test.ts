import { describe, expect, it } from "vitest";
import type { NomiRenderManifestV1 } from "./exportManifest";
import type { ExportProfile } from "./exportTypes";
import { compileFfmpegFiltergraph, FfmpegFiltergraphError } from "./ffmpegFiltergraph";

const profile: ExportProfile = {
  preset: "publish",
  container: "mp4",
  videoCodec: "h264",
  audioCodec: "none",
  width: 1920,
  height: 1080,
  fps: 30,
  pixelFormat: "yuv420p",
  quality: "standard",
};

function manifest(overrides: Partial<NomiRenderManifestV1> = {}): NomiRenderManifestV1 {
  return {
    version: 1,
    projectId: "project-1",
    createdAt: "2026-05-24T00:00:00.000Z",
    timeline: {
      fps: 30,
      durationFrames: 150,
      range: { startFrame: 0, endFrame: 150 },
      tracks: [],
    },
    profile,
    assets: {},
    ...overrides,
  };
}

describe("compileFfmpegFiltergraph", () => {
  it("builds filtergraph for one image clip with 5s duration", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          image1: { id: "image1", kind: "image", absolutePath: "/media/still.png", width: 1000, height: 800 },
        },
        timeline: {
          fps: 30,
          durationFrames: 150,
          range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "image1", startFrame: 0, endFrame: 150 }] }],
        },
      }),
    });

    expect(plan.inputs).toEqual([{ assetId: "image1", path: "/media/still.png", kind: "image", inputArgs: ["-loop", "1", "-t", "5"] }]);
    expect(plan.filterComplex).toContain("color=black:size=1920x1080:rate=30:duration=5[base]");
    expect(plan.filterComplex).toContain("[0:v]trim=duration=5,setpts=PTS-STARTPTS");
    expect(plan.filterComplex).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(plan.filterComplex).toContain("pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black");
    expect(plan.filterComplex).toContain("format=yuv420p");
    expect(plan.filterComplex).toContain("overlay=shortest=0:eof_action=pass:enable='gte(t,0)*lt(t,5)'[vout]");
    expect(plan.videoOutputLabel).toBe("[vout]");
  });

  it("builds trim/scale graph for one video clip honoring source frames", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          video1: { id: "video1", kind: "video", absolutePath: "/media/source.mov", durationSeconds: 30, width: 3840, height: 2160, fps: 30 },
        },
        timeline: {
          fps: 30,
          durationFrames: 60,
          range: { startFrame: 0, endFrame: 60 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "video1", startFrame: 0, endFrame: 60, sourceStartFrame: 30, sourceEndFrame: 90 }] }],
        },
      }),
    });

    expect(plan.inputs).toEqual([{ assetId: "video1", path: "/media/source.mov", kind: "video", inputArgs: [] }]);
    expect(plan.filterComplex).toContain("[0:v]trim=start=1:end=3,setpts=PTS-STARTPTS");
    expect(plan.filterComplex).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(plan.filterComplex).toContain("pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black");
    expect(plan.filterComplex).toContain("overlay=shortest=0:eof_action=pass:enable='gte(t,0)*lt(t,2)'[vout]");
  });

  it("preserves deterministic bottom-to-top layer order for overlapping visual clips", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          bottom: { id: "bottom", kind: "image", absolutePath: "/media/bottom.png" },
          top: { id: "top", kind: "image", absolutePath: "/media/top.png" },
        },
        timeline: {
          fps: 30,
          durationFrames: 60,
          range: { startFrame: 0, endFrame: 60 },
          tracks: [
            { id: "bottom-track", kind: "visual", clips: [{ id: "clip-bottom", assetId: "bottom", startFrame: 0, endFrame: 60 }] },
            { id: "top-track", kind: "visual", clips: [{ id: "clip-top", assetId: "top", startFrame: 0, endFrame: 60 }] },
          ],
        },
      }),
    });

    expect(plan.filterComplex.indexOf("[clip_clip_bottom_fitted]")).toBeLessThan(plan.filterComplex.indexOf("[clip_clip_top_fitted]"));
    expect(plan.filterComplex).toContain("[base][clip_clip_bottom_fitted]overlay");
    expect(plan.filterComplex).toContain("[vstack0][clip_clip_top_fitted]overlay");
  });

  it("emits black background and shifts non-zero-start visual clips into timeline PTS", () => {
    const plan = compileFfmpegFiltergraph({
      manifest: manifest({
        assets: {
          image1: { id: "image1", kind: "image", absolutePath: "/media/still.png" },
        },
        timeline: {
          fps: 30,
          durationFrames: 150,
          range: { startFrame: 0, endFrame: 150 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "image1", startFrame: 60, endFrame: 90 }] }],
        },
      }),
    });

    expect(plan.filterComplex).toContain("color=black:size=1920x1080:rate=30:duration=5[base]");
    expect(plan.filterComplex).toContain("[0:v]trim=duration=1,setpts=PTS-STARTPTS+2/TB[clip_clip_1_segment]");
    expect(plan.filterComplex).toContain("overlay=shortest=0:eof_action=pass:enable='gte(t,2)*lt(t,3)'[vout]");
  });

  it("classifies missing asset before FFmpeg spawn", () => {
    expect(() => compileFfmpegFiltergraph({
      manifest: manifest({
        timeline: {
          fps: 30,
          durationFrames: 30,
          range: { startFrame: 0, endFrame: 30 },
          tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "missing", startFrame: 0, endFrame: 30 }] }],
        },
        assets: {},
      }),
    })).toThrow(FfmpegFiltergraphError);

    try {
      compileFfmpegFiltergraph({
        manifest: manifest({
          timeline: {
            fps: 30,
            durationFrames: 30,
            range: { startFrame: 0, endFrame: 30 },
            tracks: [{ id: "visual-1", kind: "visual", clips: [{ id: "clip-1", assetId: "missing", startFrame: 0, endFrame: 30 }] }],
          },
          assets: {},
        }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(FfmpegFiltergraphError);
      expect((error as FfmpegFiltergraphError).code).toBe("missing_asset");
    }
  });

  it.todo("contracts audio source preserve/mute, delay, fade, and amix for multi-track audio");

  it("classifies multi-track audio as unsupported until audio mixer implementation lands", () => {
    try {
      compileFfmpegFiltergraph({
        manifest: manifest({
          profile: { ...profile, audioCodec: "aac" },
          assets: {
            a1: { id: "a1", kind: "audio", absolutePath: "/media/a1.wav", durationSeconds: 10 },
            a2: { id: "a2", kind: "audio", absolutePath: "/media/a2.wav", durationSeconds: 10 },
          },
          timeline: {
            fps: 30,
            durationFrames: 300,
            range: { startFrame: 0, endFrame: 300 },
            tracks: [
              { id: "audio-1", kind: "audio", clips: [{ id: "a-clip-1", assetId: "a1", startFrame: 0, endFrame: 150 }] },
              { id: "audio-2", kind: "audio", clips: [{ id: "a-clip-2", assetId: "a2", startFrame: 30, endFrame: 180 }] },
            ],
          },
        }),
      });
      throw new Error("Expected unsupported_audio");
    } catch (error) {
      expect(error).toBeInstanceOf(FfmpegFiltergraphError);
      expect((error as FfmpegFiltergraphError).code).toBe("unsupported_audio");
    }
  });
});
