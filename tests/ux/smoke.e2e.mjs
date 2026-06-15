// Playwright _electron 冒烟 e2e（规则 13/14）—— 可断言、可重复、零额度。
// 启动构建产物 → 断言主链路的关键 UI 真实渲染（项目库 → 开项目 → 画布工具栏/导出入口）。
// 任一断言失败即抛错、非零退出（CI-ready）。不触发真实 AI 生成/导出（不花额度）。
//
// 用法：pnpm run build && pnpm run test:e2e
import { _electron as electron } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let passed = 0;
function assert(cond, label) {
  if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const app = await electron.launch({
  executablePath: require("electron"),
  args: ["."],
  cwd: repoRoot,
  env: { ...process.env, NOMI_E2E_SMOKE: "1" },
});

try {
  const win = await app.firstWindow();
  await win.waitForLoadState("domcontentloaded");
  await win.waitForTimeout(1500);

  // 1) 主进程启动 + 渲染层加载（runtime.ts 拆分后的回归底线）
  assert((await win.title()).toLowerCase().includes("nomi"), "窗口标题含 Nomi");

  // 1b) 内置模型 seed 在启动时生效（ensureBuiltinModelSeeds）——Seedance 开箱在目录里、带 archetypeId。
  const seed = await win.evaluate(() => {
    const mc = window.nomiDesktop?.modelCatalog;
    if (!mc) return { ok: false };
    const seedance = mc.listModels({ kind: "video", enabled: true }).find((m) => m.modelKey === "bytedance/seedance-2");
    return {
      ok: true,
      hasKie: mc.listVendors().some((v) => v.key === "kie"),
      archetypeId: seedance?.meta?.archetypeId ?? null,
      hasMapping: mc.listMappings().some((mp) => mp.vendorKey === "kie" && mp.taskKind === "image_to_video"),
    };
  });
  assert(seed.ok && seed.hasKie, "启动后目录里有内置 kie vendor（seed 生效）");
  assert(seed.archetypeId === "seedance-2", "Seedance 模型在位且 meta.archetypeId=seedance-2");
  assert(seed.hasMapping, "(kie, image_to_video) mapping 在位");

  // 2) 项目库渲染（渲染 → IPC listProjects → projects/repository 真实数据）
  // 空库与有项目走同一套布局：主入口动作卡片「新建空白项目」恒在（hero 介绍首屏已删）。
  await win.getByText("项目库", { exact: false }).first().waitFor({ timeout: 8000 });
  const primaryCard = win.locator('[data-variant="primary"]', { hasText: "新建空白项目" });
  assert((await primaryCard.count()) > 0, "项目库主入口动作卡片「新建空白项目」可见");

  // 3) 开项目 → 工作台画布（开项目 → readProject/资产 → 画布挂载）
  // 优先打开已有项目卡（不污染库）；空库时走「新建空白项目」。
  const projectCard = win.locator("[data-project-card]").first();
  if ((await projectCard.count()) > 0) {
    await projectCard.click();
  } else {
    await win.getByText("新建空白项目", { exact: false }).first().click();
  }
  await win.waitForTimeout(2500);
  for (const name of ["创作", "生成", "预览", "导出"]) {
    assert(await win.getByRole("button", { name, exact: false }).first().isVisible(), `工作台工具栏「${name}」可见`);
  }
  assert(/projectId=/.test(win.url()), "工作台 URL 含 projectId");

  console.log(`\nSMOKE PASS: ${passed} assertions`);
} catch (error) {
  console.error(`\n${error?.message || error}`);
  await app.close();
  process.exit(1);
} finally {
  await app.close().catch(() => undefined);
}
