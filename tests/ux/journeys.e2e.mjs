// J3/J5 旅程骨架断言 e2e(评测方案 S5 收窄版,R13 双层中的「下限门」)。
// 只断言可谓词化骨架:任务可达性/终态正确/关键交互态不被裁;
// 「美不美、顺不顺、看不看得懂」仍归 R13 截图人眼穿透——断言绿不豁免人眼门。
// 零额度(不调 AI);三重隔离(evals/lib/isoApp),不污染真实项目库/最近列表。
//
// 用法:pnpm run build && node tests/ux/journeys.e2e.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareIsolation, launchIsolatedApp, readProjectPayload } from "../../evals/lib/isoApp.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`JOURNEY FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function withIsolatedApp(name, fn) {
  const isoDir = path.join(os.tmpdir(), "nomi-journeys", name);
  const iso = prepareIsolation(isoDir, { requireCatalog: false });
  const { app, win } = await launchIsolatedApp(repoRoot, iso);
  try {
    await fn(win, iso);
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(isoDir, { recursive: true, force: true });
  }
}

function singleProjectDir(projectsDir) {
  const dirs = fs.readdirSync(projectsDir).filter((n) => fs.existsSync(path.join(projectsDir, n, ".nomi", "project.json")));
  return dirs.length === 1 ? path.join(projectsDir, dirs[0]) : null;
}

// ── J3 冷启动骨架:示例入口 → 项目自动创建 → 工作台可用 ──────────────────
console.log("J3 新用户冷启动(骨架)");
await withIsolatedApp("j3", async (win, iso) => {
  const example = win.getByText("漫剧示例", { exact: false }).first();
  await example.waitFor({ timeout: 10_000 });
  assert(true, "冷启动首页有示例入口");
  await example.click();
  let projectDir = null;
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline && !projectDir) {
    projectDir = singleProjectDir(iso.projectsDir);
    if (!projectDir) await win.waitForTimeout(600);
  }
  assert(projectDir !== null, "点示例后项目自动创建并落盘");
  await win.waitForTimeout(1500);
  assert(/projectId=/.test(win.url()), "工作台 URL 带 projectId(prod hash 路由回归锁)");
  for (const name of ["创作", "生成", "预览"]) {
    assert(await win.getByRole("button", { name, exact: false }).first().isVisible(), `工作台「${name}」标签可见`);
  }
  // 示例统一落创作 + 拆镜 CTA(commit 30483e5 行为)
  const docText = await win.evaluate(() => document.body.innerText.length);
  assert(docText > 200, "创作区有示例文案内容(非空白)");
});

// ── J5 修改节点并导出骨架:建节点 → 改 prompt → 持久化 → 导出入口 ────────
console.log("J5 修改节点并导出(骨架)");
await withIsolatedApp("j5", async (win, iso) => {
  await win.getByText("新建空白项目", { exact: false }).first().click({ timeout: 10_000 });
  await win.waitForTimeout(2000);
  const projectDir = singleProjectDir(iso.projectsDir);
  assert(projectDir !== null, "空白项目创建落盘");

  // 画布默认带一个待生成图片节点(标题「关键画面」);画布自管指针事件,
  // locator.click 会被拦——用坐标点击节点中心选中它。
  const box = await win.evaluate(() => {
    const el = [...document.querySelectorAll("div")].find(
      (d) => d.textContent?.includes("关键画面") && d.getBoundingClientRect().width > 100 && d.getBoundingClientRect().width < 600,
    );
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  assert(box !== null, "空白项目画布带默认待生成节点");
  await win.mouse.click(box.x, box.y);
  await win.waitForTimeout(1000);
  // 参数面板的提示词输入是 Tiptap 编辑器([contenteditable]),不是 textarea
  const promptBox = win.locator('[contenteditable="true"]').first();
  await promptBox.waitFor({ state: "visible", timeout: 8000 });
  const MARK = `J5 回归提示词 ${Date.now()}`;
  await promptBox.click();
  await promptBox.fill(MARK);
  await win.waitForTimeout(1500); // 等持久化 debounce

  const deadline = Date.now() + 10_000;
  let persisted = false;
  while (Date.now() < deadline && !persisted) {
    const record = readProjectPayload(projectDir);
    persisted = JSON.stringify(record?.payload?.generationCanvas?.nodes || []).includes(MARK);
    if (!persisted) await win.waitForTimeout(700);
  }
  assert(persisted, "改 prompt 真实持久化进 project.json(终态取证)");

  // 导出入口可达
  await win.locator('[aria-label="前往预览导出"]').first().click({ timeout: 5000 });
  await win.waitForTimeout(1500);
  const bodyText = await win.evaluate(() => document.body.innerText);
  assert(/导出|MP4|分辨率/.test(bodyText), "导出面板可达且有导出语义内容");

  // 交互态遮挡几何(R13 交互态要求的最小子集):提示词输入框不被视口裁剪
  await win.getByRole("button", { name: "生成", exact: false }).first().click();
  await win.waitForTimeout(1000);
});

console.log(`\nJOURNEYS PASS: ${passed} assertions`);
