// OWNER: mahin
import { test, expect } from "@playwright/test";
import manifest from "../../src/world/data/manifest.fallback.json" with { type: "json" };
test("all 13 departments are enterable and fast travel faces the correct agent", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/view?mock=1&quality=low");
  await page.waitForFunction(() => !!(window as any).__foundryDebug?.ready);
  for (const building of manifest.buildings) {
    const agent = manifest.npcs.find(
      (n) => n.building_id === building.building_id && n.is_lead,
    )!;
    await page.evaluate(async (id) => {
      await (window as any).__foundryDebug.travel(id);
    }, agent.agent_id);
    await expect(
      page.getByRole("region", {
        name: `Conversation with ${agent.display_name}`,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => (window as any).__foundryDebug.scene),
    ).toBe(`interior:${building.department_id}`);
    await page.evaluate(async () => {
      await (window as any).__foundryDebug.exit();
    });
    expect(
      await page.evaluate(() => (window as any).__foundryDebug.scene),
    ).toBe("city");
  }
  expect(errors).toEqual([]);
});
test("directory search, cited conversation and route card work", async ({
  page,
}) => {
  await page.goto("/view?mock=1&quality=low");
  await page.waitForFunction(() => !!(window as any).__foundryDebug?.ready);
  await page.evaluate(async () => {
    await (window as any).__foundryDebug.travel("concierge");
  });
  await page
    .getByRole("textbox", { name: "Message Nova" })
    .fill("Who wrote the pricing research?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText("Sources verified")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Competitor pricing" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Take me there ↗", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Conversation with Priya" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "City map" }).click();
  await page.getByPlaceholder("Try Priya, engineering, research…").fill("Zara");
  await expect(page.getByText("Zara", { exact: true })).toBeVisible();
  await expect(page.getByText("1 people", { exact: true })).toBeVisible();
});
test("kernel failure still renders the town and never fabricates live answers", async ({
  page,
}) => {
  await page.route("**/v1/**", (route) => route.abort());
  await page.goto("/view?quality=low");
  await page.waitForFunction(() => !!(window as any).__foundryDebug?.ready);
  await expect(page.getByText("OFFLINE EXPLORATION")).toBeVisible();
  await expect(
    page.getByText(
      "Conversations unavailable. You can still explore the entire town.",
    ),
  ).toBeVisible();
});
test("capture reports every fallback mode and real camera paths", async ({
  page,
}) => {
  test.setTimeout(180_000);
  for (const b of manifest.buildings)
    for (const mode of ["exterior", "interior"]) {
      await page.goto(
        `/view/capture?building=${b.department_id}&mode=${mode}&source=fallback`,
      );
      await page.waitForFunction(() => window.__foundryProbe?.ready);
      const result = await page.evaluate(() => ({
        error: window.__foundryProbe?.error,
        failed: window.__foundryProbe?.result?.probes.filter((p) => !p.pass),
      }));
      expect(result.error).toBeUndefined();
      expect(result.failed).toEqual([]);
    }
  const start = Date.now();
  await page.evaluate(async () => {
    await window.__foundryProbe!.playPath("int-walk");
  });
  expect(Date.now() - start).toBeGreaterThanOrEqual(5900);
  await page.goto("/view/capture?mode=portrait&agent=eng.builder");
  await page.waitForFunction(() => window.__foundryProbe?.ready);
  expect(
    await page.evaluate(() => window.__foundryProbe?.error),
  ).toBeUndefined();
  expect(
    await page.evaluate(() => window.__foundryProbe?.result?.probes),
  ).toEqual([]);
});

// OWNER: mahin
test('city grid loads, player drives a full street, and the minimap follows', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/view?mock=1&quality=low');
    await page.waitForFunction(() => !!(window as any).__foundryDebug?.ready);
    const data = await page.evaluate(() => { const d = (window as any).__foundryDebug; return { m: d.cityManifest(), pos: d.playerPos() }; });
    expect(data.m.roads.nodes.filter((n: any) => n.id.startsWith('J:'))).toHaveLength(49);
    expect(data.m.buildings).toHaveLength(13);
    expect(data.pos[0]).toBeCloseTo(65);
    await page.getByRole('button', { name: 'Drive the city' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__foundryDebug.mode)).toBe('car');
    const before = await page.evaluate(() => (window as any).__foundryDebug.playerPos());
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(3500);
    await page.keyboard.up('KeyW');
    const after = await page.evaluate(() => (window as any).__foundryDebug.playerPos());
    expect(after[2]).toBeLessThan(before[2] - 10);
    await page.keyboard.down('Space');
    await page.waitForTimeout(3500);
    await page.keyboard.up('Space');
    await page.getByRole('button', { name: 'Exit car · E' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__foundryDebug.mode)).toBe('foot');
    await page.getByRole('button', { name: 'Open city minimap' }).click();
    await expect(page.getByRole('dialog', { name: 'City directory' })).toBeVisible();
    await page.getByPlaceholder('Try Priya, engineering, research…').fill('Zara');
    await expect(page.getByText('Zara', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Race there' }).click();
    await expect.poll(() => page.evaluate(() => (window as any).__foundryDebug.mode)).toBe('race');
    expect(errors).toEqual([]);
});
test('western hills ground feet and the bayfront is visible', async ({ page }) => {
    await page.goto('/view?mock=1&quality=low');
    await page.waitForFunction(() => !!(window as any).__foundryDebug?.ready);
    await page.evaluate(() => (window as any).__foundryDebug.pose([-144, 1.65, -75], 0));
    await page.waitForTimeout(200);
    expect((await page.evaluate(() => (window as any).__foundryDebug.playerPos()))[1]).toBeGreaterThan(20);
    await page.evaluate(() => (window as any).__foundryDebug.pose([222, 1.65, 40], -Math.PI / 2));
    await page.waitForTimeout(200);
    expect((await page.evaluate(() => (window as any).__foundryDebug.playerPos()))[1]).toBeCloseTo(1.65, 1);
});

test("Nova opens remotely by button or N, guards text input, and restores driving", async ({ page }) => {
  await page.goto("/view?mock=1&quality=low");
  await page.waitForFunction(() => !!(window as any).__foundryDebug?.ready);
  await page.getByRole("button", { name: "Ask Nova · N" }).click();
  await expect(page.getByText("REMOTE CONNECTION · NOVA")).toBeVisible();
  await expect(page.getByRole("region", { name: "Conversation with Nova" })).toBeVisible();
  const input = page.getByRole("textbox", { name: "Message Nova" });
  await input.press("KeyN");
  await expect(input).toHaveValue("n");
  await page.getByRole("button", { name: "Close conversation" }).click();
  await page.getByRole("button", { name: "Drive the city" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__foundryDebug.mode)).toBe("car");
  await page.keyboard.press("KeyN");
  await expect(page.getByRole("region", { name: "Conversation with Nova" })).toBeVisible();
  await page.getByRole("button", { name: "Close conversation" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__foundryDebug.mode)).toBe("car");
});
