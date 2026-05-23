import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveFfmpegPath, transcodeWebmToMp4 } from "./ffmpegRunner";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-export-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("resolveFfmpegPath", () => {
  it("prefers the bundled ffmpeg binary so users do not need to install ffmpeg", () => {
    const root = makeTempDir();
    const bundled = path.join(root, "node_modules", "@ffmpeg-installer", process.platform === "win32" ? "win32-x64" : process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64" : process.platform === "darwin" ? "darwin-x64" : "linux-x64", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    fs.mkdirSync(path.dirname(bundled), { recursive: true });
    fs.writeFileSync(bundled, "binary");

    expect(resolveFfmpegPath(undefined, { bundledPath: bundled, resourcesPath: root, pathEnv: "" })).toBe(bundled);
  });

  it("uses the unpacked ffmpeg binary when the app is packaged in an asar archive", () => {
    const root = makeTempDir();
    const asarPath = path.join(root, "app.asar", "node_modules", "@ffmpeg-installer", "darwin-arm64", "ffmpeg");
    const unpackedPath = asarPath.replace("app.asar", "app.asar.unpacked");
    fs.mkdirSync(path.dirname(unpackedPath), { recursive: true });
    fs.writeFileSync(unpackedPath, "binary");

    expect(resolveFfmpegPath(undefined, { bundledPath: asarPath, resourcesPath: root, pathEnv: "" })).toBe(unpackedPath);
  });

  it("falls back to the packaged resources ffmpeg binary before PATH", () => {
    const root = makeTempDir();
    const resourceBinary = path.join(root, "ffmpeg", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    fs.mkdirSync(path.dirname(resourceBinary), { recursive: true });
    fs.writeFileSync(resourceBinary, "binary");

    expect(resolveFfmpegPath(undefined, { bundledPath: "", resourcesPath: root, pathEnv: "" })).toBe(resourceBinary);
  });
});

describe("transcodeWebmToMp4", () => {
  it("writes input webm to a temp file and asks ffmpeg to create a playable 1080p mp4", async () => {
    const projectDir = makeTempDir();
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = await transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      outputName: "My Export!",
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: async (command, args) => {
        calls.push({ command, args });
        const outputPath = args[args.length - 1];
        fs.writeFileSync(outputPath, "mp4-bytes");
        return { code: 0, stderr: "" };
      },
    });

    expect(result.relativePath).toMatch(/^exports\/My-Export-\d+\.mp4$/);
    expect(result.absolutePath).toBe(path.join(projectDir, result.relativePath));
    expect(fs.readFileSync(result.absolutePath, "utf8")).toBe("mp4-bytes");
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("/usr/local/bin/ffmpeg");
    expect(calls[0].args).toContain("-c:v");
    expect(calls[0].args).toContain("libx264");
    expect(calls[0].args).toContain("-r");
    expect(calls[0].args).toContain("30");
    const vfIndex = calls[0].args.indexOf("-vf");
    expect(calls[0].args[vfIndex + 1]).toContain("scale=1920:1080:force_original_aspect_ratio=decrease");
    expect(fs.existsSync(path.join(projectDir, "cache", "exports"))).toBe(false);
  });

  it("surfaces ffmpeg stderr when conversion fails", async () => {
    const projectDir = makeTempDir();
    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "/usr/local/bin/ffmpeg",
      runProcess: async () => ({ code: 1, stderr: "Unknown encoder libx264" }),
    })).rejects.toThrow("Unknown encoder libx264");
  });

  it("reports a reinstallable encoder component instead of asking users to install ffmpeg", async () => {
    const projectDir = makeTempDir();
    await expect(transcodeWebmToMp4({
      projectDir,
      inputBytes: Buffer.from("webm-bytes"),
      ffmpegPath: "",
      runProcess: vi.fn(),
    })).rejects.toThrow("MP4 编码组件缺失，请重新安装 Nomi");
  });
});
