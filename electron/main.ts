import { app, BrowserWindow, ipcMain, net, protocol, shell } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createProject,
  deleteProject,
  deleteModelCatalogMapping,
  deleteModelCatalogModel,
  deleteModelCatalogVendor,
  exportModelCatalogPackage,
  fetchModelCatalogDocs,
  fetchTaskResult,
  getModelCatalogHealth,
  importLocalFile,
  importModelCatalogPackage,
  importRemoteAsset,
  listProjectAssets,
  listModelCatalogMappings,
  listModelCatalogModels,
  listModelCatalogVendors,
  listProjects,
  readProject,
  resolveProjectRelativePath,
  runAgentChat,
  runTask,
  saveProject,
  startTimelineMp4Export,
  testModelCatalogMapping,
  upsertModelCatalogMapping,
  upsertModelCatalogModel,
  upsertModelCatalogVendor,
  upsertModelCatalogVendorApiKey,
  clearModelCatalogVendorApiKey,
} from "./runtime";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "nomi-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL || process.env.NOMI_DESKTOP_DEV);
const devRemoteDebuggingPort = process.env.NOMI_DESKTOP_REMOTE_DEBUGGING_PORT;
const DEV_RENDERER_LOAD_ATTEMPTS = 20;
const DEV_RENDERER_LOAD_RETRY_MS = 500;

if (isDev && devRemoteDebuggingPort) {
  app.commandLine.appendSwitch("remote-debugging-port", devRemoteDebuggingPort);
}

function registerDevDiagnostics(mainWindow: BrowserWindow, rendererUrl: string): void {
  if (!isDev) return;

  console.log(`[nomi:desktop] loading renderer: ${rendererUrl}`);

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[nomi:desktop] renderer load failed (${errorCode}): ${errorDescription} ${validatedURL}`);
  });
  mainWindow.webContents.on("did-finish-load", () => {
    console.log("[nomi:desktop] renderer did finish load");
  });
  mainWindow.webContents.on("dom-ready", () => {
    console.log("[nomi:desktop] renderer dom ready");
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("[nomi:desktop] renderer process gone:", details);
  });
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[nomi:desktop] preload failed: ${preloadPath}`, error);
  });
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const method = level >= 2 ? console.error : console.log;
    method(`[nomi:renderer:${level}] ${message} (${sourceId}:${line})`);
  });
}

function getRendererUrl(): string {
  const explicit = process.env.VITE_DEV_SERVER_URL || process.env.NOMI_RENDERER_URL;
  if (explicit) return explicit;
  if (isDev) return "http://127.0.0.1:5173";
  return pathToFileURL(path.join(__dirname, "../dist/index.html")).toString();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadRendererWithRetry(mainWindow: BrowserWindow, rendererUrl: string): Promise<void> {
  const attempts = isDev ? DEV_RENDERER_LOAD_ATTEMPTS : 1;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await mainWindow.loadURL(rendererUrl);
      return;
    } catch (error) {
      lastError = error;
      if (!isDev || mainWindow.isDestroyed() || attempt === attempts) break;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[nomi:desktop] renderer load attempt ${attempt}/${attempts} failed: ${message}`);
      await wait(DEV_RENDERER_LOAD_RETRY_MS);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function createWindow(): Promise<void> {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#f6f3ee",
    title: "Nomi",
    icon: path.join(__dirname, "../build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const rendererUrl = getRendererUrl();
  registerDevDiagnostics(mainWindow, rendererUrl);
  await loadRendererWithRetry(mainWindow, rendererUrl);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }
}

function registerSyncIpc<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult,
): void {
  ipcMain.on(channel, (event, ...args: TArgs) => {
    try {
      event.returnValue = { ok: true, value: handler(...args) };
    } catch (error) {
      event.returnValue = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function registerIpc(): void {
  registerSyncIpc("nomi:projects:list", listProjects);
  registerSyncIpc("nomi:projects:create", createProject);
  registerSyncIpc("nomi:projects:read", readProject);
  registerSyncIpc("nomi:projects:save", saveProject);
  registerSyncIpc("nomi:projects:delete", deleteProject);
  registerSyncIpc("nomi:model-catalog:vendors:list", listModelCatalogVendors);
  registerSyncIpc("nomi:model-catalog:models:list", listModelCatalogModels);
  registerSyncIpc("nomi:model-catalog:mappings:list", listModelCatalogMappings);
  registerSyncIpc("nomi:model-catalog:health", getModelCatalogHealth);
  registerSyncIpc("nomi:model-catalog:vendor:upsert", upsertModelCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor:delete", deleteModelCatalogVendor);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:upsert", upsertModelCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:vendor-api-key:clear", clearModelCatalogVendorApiKey);
  registerSyncIpc("nomi:model-catalog:model:upsert", upsertModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:model:delete", deleteModelCatalogModel);
  registerSyncIpc("nomi:model-catalog:mapping:upsert", upsertModelCatalogMapping);
  registerSyncIpc("nomi:model-catalog:mapping:delete", deleteModelCatalogMapping);
  registerSyncIpc("nomi:model-catalog:export", exportModelCatalogPackage);
  registerSyncIpc("nomi:model-catalog:import", importModelCatalogPackage);

  ipcMain.handle("nomi:model-catalog:docs:fetch", (_event, payload) => fetchModelCatalogDocs(payload));
  ipcMain.handle("nomi:model-catalog:mapping:test", (_event, id, payload) => testModelCatalogMapping(id, payload));
  ipcMain.handle("nomi:assets:import-remote-url", (_event, payload) => importRemoteAsset(payload));
  ipcMain.handle("nomi:assets:import-file", (_event, payload) => importLocalFile(payload));
  ipcMain.handle("nomi:assets:list", (_event, payload) => listProjectAssets(payload));
  ipcMain.handle("nomi:exports:start", (_event, payload) => startTimelineMp4Export(payload));
  ipcMain.handle("nomi:exports:show-in-folder", (_event, filePath) => {
    const resolved = path.resolve(String(filePath || ""));
    shell.showItemInFolder(resolved);
    return { ok: true };
  });
  ipcMain.handle("nomi:tasks:run", (_event, payload) => runTask(payload));
  ipcMain.handle("nomi:tasks:result", (_event, payload) => fetchTaskResult(payload));
  ipcMain.handle("nomi:agents:chat", (_event, payload) => runAgentChat(payload));
}

function registerLocalProtocol(): void {
  protocol.handle("nomi-local", async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "asset") {
        return new Response("Unsupported nomi-local host", { status: 404 });
      }
      const [projectId, ...relativeParts] = decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/");
      const relativePath = relativeParts.join("/");
      const filePath = resolveProjectRelativePath(projectId, relativePath);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      const message = error instanceof Error ? error.message : "local asset not found";
      return new Response(message, { status: 404 });
    }
  });
}

app.whenReady().then(async () => {
  registerLocalProtocol();
  registerIpc();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch((error) => {
        console.error("[nomi:desktop] failed to recreate window:", error);
      });
    }
  });
}).catch((error) => {
  console.error("[nomi:desktop] failed to start:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
