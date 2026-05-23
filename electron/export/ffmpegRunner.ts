import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export type FfmpegProcessResult = {
  code: number | null;
  stderr: string;
};

export type RunFfmpegProcess = (command: string, args: string[]) => Promise<FfmpegProcessResult>;

export type TranscodeWebmToMp4Options = {
  projectDir: string;
  inputBytes: Buffer;
  outputName?: string;
  ffmpegPath?: string;
  resolution?: "720p" | "1080p";
  quality?: "small" | "standard" | "high";
  fps?: number;
  runProcess?: RunFfmpegProcess;
};

export type TimelineMp4ExportResult = {
  absolutePath: string;
  relativePath: string;
  size: number;
};

const RESOLUTION_SIZE: Record<"720p" | "1080p", { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

const QUALITY_CRF: Record<"small" | "standard" | "high", string> = {
  small: "28",
  standard: "23",
  high: "18",
};

function executablePathForRuntime(candidate: string): string {
  if (!candidate.includes("app.asar")) return candidate;
  return candidate.replace(/app\.asar(?!\.unpacked)/g, "app.asar.unpacked");
}

function commandExists(command: string, pathEnv = process.env.PATH || ""): boolean {
  if (!command) return false;
  const runtimeCommand = executablePathForRuntime(command);
  if (path.isAbsolute(runtimeCommand)) return fs.existsSync(runtimeCommand);
  const pathParts = String(pathEnv || "").split(path.delimiter).filter(Boolean);
  return pathParts.some((dir) => fs.existsSync(path.join(dir, runtimeCommand)));
}

type ResolveFfmpegPathOptions = {
  bundledPath?: string;
  resourcesPath?: string;
  pathEnv?: string;
};

function resolveBundledFfmpegPath(): string {
  try {
    // @ffmpeg-installer/ffmpeg resolves to the platform-specific binary shipped with the app.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bundled = require("@ffmpeg-installer/ffmpeg") as { path?: unknown };
    return typeof bundled.path === "string" ? bundled.path : "";
  } catch {
    return "";
  }
}

export function resolveFfmpegPath(explicitPath?: string, options: ResolveFfmpegPathOptions = {}): string {
  if (typeof explicitPath === "string") return explicitPath.trim();
  const explicit = String(process.env.NOMI_FFMPEG_PATH || "").trim();
  if (explicit) return explicit;
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const resourcesPath = options.resourcesPath ?? process.resourcesPath ?? "";
  const candidates = [
    options.bundledPath ?? resolveBundledFfmpegPath(),
    path.join(resourcesPath, "ffmpeg", executableName),
    path.join(resourcesPath, "app.asar.unpacked", "node_modules", "@ffmpeg-installer", process.platform === "win32" ? "win32-x64" : process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64" : process.platform === "darwin" ? "darwin-x64" : "linux-x64", executableName),
    executableName,
  ];
  return candidates.map(executablePathForRuntime).find((candidate) => commandExists(candidate, options.pathEnv)) || "";
}

function sanitizeOutputBaseName(value: string | undefined): string {
  const cleaned = String(value || "nomi-export")
    .trim()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "nomi-export";
}

function uniqueOutputPath(exportsDir: string, outputName?: string): string {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const base = `${sanitizeOutputBaseName(outputName)}-${stamp}`;
  let candidate = path.join(exportsDir, `${base}.mp4`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(exportsDir, `${base}-${suffix}.mp4`);
    suffix += 1;
  }
  return candidate;
}

function defaultRunProcess(command: string, args: string[]): Promise<FfmpegProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

export async function transcodeWebmToMp4(options: TranscodeWebmToMp4Options): Promise<TimelineMp4ExportResult> {
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
  if (!ffmpegPath) {
    throw new Error("导出失败：MP4 编码组件缺失，请重新安装 Nomi。你不需要单独安装 FFmpeg。");
  }
  if (!options.inputBytes || options.inputBytes.byteLength <= 0) {
    throw new Error("导出失败：输入视频为空");
  }

  const projectDir = path.resolve(options.projectDir);
  const exportsDir = path.join(projectDir, "exports");
  const cacheParent = path.join(projectDir, "cache");
  fs.mkdirSync(exportsDir, { recursive: true });
  fs.mkdirSync(cacheParent, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(cacheParent, "export-"));
  const inputPath = path.join(tempDir, "input.webm");
  const outputPath = uniqueOutputPath(exportsDir, options.outputName);
  fs.writeFileSync(inputPath, options.inputBytes);

  const resolution = RESOLUTION_SIZE[options.resolution || "1080p"];
  const fps = Math.max(1, Math.floor(options.fps || 30));
  const vf = `scale=${resolution.width}:${resolution.height}:force_original_aspect_ratio=decrease,pad=${resolution.width}:${resolution.height}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`;
  const args = [
    "-y",
    "-i", inputPath,
    "-an",
    "-vf", vf,
    "-r", String(fps),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", QUALITY_CRF[options.quality || "standard"],
    "-movflags", "+faststart",
    outputPath,
  ];

  try {
    const runProcess = options.runProcess || defaultRunProcess;
    const result = await runProcess(ffmpegPath, args);
    if (result.code !== 0) {
      const detail = result.stderr.trim() || `ffmpeg exited with code ${result.code}`;
      throw new Error(`导出失败：${detail}`);
    }
    const stat = fs.statSync(outputPath);
    if (stat.size <= 0) throw new Error("导出失败：MP4 文件为空");
    return {
      absolutePath: outputPath,
      relativePath: path.relative(projectDir, outputPath).split(path.sep).join("/"),
      size: stat.size,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
