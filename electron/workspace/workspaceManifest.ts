import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  workspaceAssetsGeneratedDir,
  workspaceAssetsImportedDir,
  workspaceExportsDir,
  workspaceNomiDir,
  workspaceProjectFile,
} from "./workspacePaths";
import { normalizeWorkspaceProjectRecord, type WorkspaceProjectRecordV2 } from "./workspaceTypes";

function readJsonFile(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function workspaceId(): string {
  return `workspace-${crypto.randomUUID()}`;
}

export function hasWorkspaceManifest(rootPath: string): boolean {
  return fs.existsSync(workspaceProjectFile(rootPath));
}

export function readWorkspaceManifest(rootPath: string): WorkspaceProjectRecordV2 | null {
  const filePath = workspaceProjectFile(rootPath);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return normalizeWorkspaceProjectRecord(readJsonFile(filePath));
}

export function writeWorkspaceManifest(rootPath: string, record: WorkspaceProjectRecordV2): WorkspaceProjectRecordV2 {
  const normalized = normalizeWorkspaceProjectRecord(record);
  writeJsonFile(workspaceProjectFile(rootPath), normalized);
  return normalized;
}

export function ensureWorkspaceFolders(rootPath: string): void {
  fs.mkdirSync(workspaceNomiDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsGeneratedDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceAssetsImportedDir(rootPath), { recursive: true });
  fs.mkdirSync(workspaceExportsDir(rootPath), { recursive: true });
}

export function initializeWorkspace(
  rootPath: string,
  input: { name?: string; payload?: unknown } = {},
): WorkspaceProjectRecordV2 {
  ensureWorkspaceFolders(rootPath);
  const existing = readWorkspaceManifest(rootPath);
  if (existing) {
    return existing;
  }

  const resolvedRoot = path.resolve(rootPath);
  const now = Date.now();
  const record: WorkspaceProjectRecordV2 = normalizeWorkspaceProjectRecord({
    id: workspaceId(),
    name: input.name?.trim() || path.basename(resolvedRoot) || "Untitled Workspace",
    version: 2,
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    revision: 0,
    lastKnownRootPath: resolvedRoot,
    payload: input.payload,
  });
  return writeWorkspaceManifest(rootPath, record);
}
