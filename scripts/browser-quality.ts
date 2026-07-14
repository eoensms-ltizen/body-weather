import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright-core";
import { PNG } from "pngjs";
import { buildAtlasModel } from "../lib/atlas";
import { buildVerificationSummary } from "../lib/verification-fixture";

const mode = process.argv[2] ?? "browser";
const port = 3417;
const baseUrl = `http://localhost:${port}`;
const chromePath = process.platform === "win32"
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
let server: ChildProcess | null = null;
let browser: Browser | null = null;

async function serverReady(): Promise<boolean> {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(800) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverReady()) return;
  server = spawn(process.execPath, ["node_modules/vinext/dist/cli.js", "dev", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  server.stdout?.on("data", (chunk) => { diagnostics += String(chunk); });
  server.stderr?.on("data", (chunk) => { diagnostics += String(chunk); });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverReady()) return;
    if (server.exitCode !== null) throw new Error(`개발 서버가 종료되었습니다.\n${diagnostics}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`개발 서버 준비 시간이 초과되었습니다.\n${diagnostics}`);
}

async function openFixture(viewport = { width: 1440, height: 900 }): Promise<Page> {
  const page = await browser!.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`${baseUrl}/?__fixture=full`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /2026 — 2026/ }).waitFor({ state: "visible" });
  await page.locator("canvas.maplibregl-canvas").waitFor({ state: "visible" });
  await page.locator(".map-status").waitFor({ state: "hidden", timeout: 12_000 });
  const skipReveal = page.getByRole("button", { name: "건너뛰기" });
  if (await skipReveal.isVisible()) await skipReveal.click();
  return page;
}

async function runBrowser() {
  const pageErrors: string[] = [];
  const page = await openFixture();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.getByRole("button", { name: /Sport 종목별 색상/ }).click();
  assert.equal(await page.getByRole("button", { name: /Sport 종목별 색상/ }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "최근 3개월" }).click();
  assert.equal(await page.getByRole("button", { name: "최근 3개월" }).getAttribute("aria-pressed"), "true");

  const mapBox = await page.locator("canvas.maplibregl-canvas").boundingBox();
  assert.ok(mapBox, "지도 Canvas bounds가 있어야 합니다.");
  const drawerClose = page.getByRole("button", { name: "활동 상세 닫기" });
  const pickPoints = [[0.5, 0.5], [0.6, 0.45], [0.7, 0.35], [0.55, 0.65], [0.45, 0.7]];
  for (const [x, y] of pickPoints) {
    await page.mouse.click(mapBox.x + mapBox.width * x, mapBox.y + mapBox.height * y);
    await page.waitForTimeout(180);
    if (await drawerClose.isVisible()) break;
  }
  assert.equal(await drawerClose.isVisible(), true, "가시 경로를 클릭하면 활동 상세가 열려야 합니다.");
  await drawerClose.click();

  await page.getByRole("button", { name: "Forecast" }).click();
  const rangeBefore = await page.locator(".tomorrow-card strong").innerText();
  await page.getByRole("button", { name: /고강도/ }).click();
  const rangeAfter = await page.locator(".tomorrow-card strong").innerText();
  assert.notEqual(rangeBefore, rangeAfter, "운동 계획 강도가 내일 범위를 바꿔야 합니다.");
  assert.match(await page.locator("body").innerText(), /14일 전 관측/);

  await page.getByRole("button", { name: "Memories" }).click();
  assert.ok(await page.locator(".memory-card").count() > 0);
  assert.equal(await page.getByTestId("poster-download").isEnabled(), true);
  await page.getByRole("button", { name: "Data & Privacy" }).click();
  assert.match(await page.locator("body").innerText(), /Capability|미디어|마스킹/);
  assert.deepEqual(pageErrors, []);
  await page.close();
  console.log("browser: Atlas → drawer → Forecast scenario → Memories → Data 흐름 통과");
}

function variance(png: PNG): number {
  let sum = 0;
  let sumSquares = 0;
  const pixels = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    const luminance = png.data[i] * 0.2126 + png.data[i + 1] * 0.7152 + png.data[i + 2] * 0.0722;
    sum += luminance;
    sumSquares += luminance * luminance;
  }
  const mean = sum / pixels;
  return sumSquares / pixels - mean * mean;
}

async function runVisual() {
  const artifacts = path.join(process.cwd(), "test-artifacts");
  await mkdir(artifacts, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await openFixture(viewport);
    const file = path.join(artifacts, `atlas-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const png = PNG.sync.read(await readFile(file));
    assert.equal(png.width, viewport.width);
    assert.equal(png.height, viewport.height);
    assert.ok(variance(png) > 120, `${viewport.width}px 캡처가 빈 화면이 아니어야 합니다.`);
    assert.ok(await page.locator("canvas.maplibregl-canvas").isVisible());
    await page.close();
  }
  console.log("visual: 1440×900 및 390×844 실제 Chrome 렌더 캡처 통과");
}

async function runA11y() {
  const page = await openFixture();
  const axePath = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () => {
    const axe = (globalThis as typeof globalThis & { axe: { run: (options: unknown) => Promise<{ violations: Array<{ id: string; impact: string | null; nodes: unknown[] }> }> } }).axe;
    return axe.run({ rules: { "color-contrast": { enabled: false }, "region": { enabled: false } } });
  });
  const blocking = result.violations.filter((item) => item.impact === "critical" || item.impact === "serious");
  assert.deepEqual(blocking.map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length })), []);
  await page.getByRole("button", { name: "Forecast" }).click();
  assert.equal(await page.getByRole("button", { name: "Forecast" }).getAttribute("aria-current"), "page");
  await page.close();
  console.log("a11y: axe critical/serious 0건, 현재 화면 상태 전달 통과");
}

async function runPerformance() {
  const started = performance.now();
  const page = await openFixture({ width: 1440, height: 900 });
  const readyMs = Math.round(performance.now() - started);
  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry ? Math.round(entry.domContentLoadedEventEnd) : null;
  });
  assert.ok(readyMs < 12_000, `fixture 지도 준비 ${readyMs}ms가 12초 예산을 넘었습니다.`);
  await page.close();
  const fixture = buildVerificationSummary();
  const largeActivities = Array.from({ length: 100 }, (_, batch) => fixture.activities.map((activity) => ({
    ...activity,
    id: `${activity.id}-${batch}`,
    route: activity.route?.map((point) => ({ ...point, longitude: point.longitude + batch * 0.00002 })),
  }))).flat();
  const atlasStarted = performance.now();
  const largeAtlas = buildAtlasModel(largeActivities, true);
  const atlasMs = Math.round(performance.now() - atlasStarted);
  assert.equal(largeAtlas.routes.length, 2_400);
  assert.ok(Object.keys(largeAtlas.spatialIndex.cells).length > 0);
  assert.ok(atlasMs < 6_000, `2,400 경로 Atlas 계산 ${atlasMs}ms가 6초 예산을 넘었습니다.`);
  console.log(`performance: Chrome 준비 ${readyMs}ms, DOMContentLoaded ${navigation ?? "n/a"}ms, 2,400 경로 Atlas 계산 ${atlasMs}ms`);
}

try {
  await ensureServer();
  browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ["--disable-gpu-sandbox"] });
  if (mode === "browser") await runBrowser();
  else if (mode === "visual") await runVisual();
  else if (mode === "a11y") await runA11y();
  else if (mode === "performance") await runPerformance();
  else throw new Error(`알 수 없는 검증 모드: ${mode}`);
} finally {
  await browser?.close();
  const runningServer = server as ChildProcess | null;
  if (runningServer) runningServer.kill();
}
