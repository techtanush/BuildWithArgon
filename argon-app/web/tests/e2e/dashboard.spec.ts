// OWNER: tanush
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Approval, Artifact, ListPage, LiveRound, Run, TalkResponse, Ticket, Venture, WorldgenRun } from '../../src/shared/contracts';

// Core dashboard flows use the running fake-mode kernel, with real SQLite and SSE.
// Run with isolated ports using tests/unit/dashboard/dev.config.ts and E2E_BASE_URL.
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

async function data<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data as T;
}
async function post<T>(request: APIRequestContext, path: string, body: unknown = {}): Promise<T> {
  const response = await request.post(path, { data: body });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return (await response.json()).data as T;
}
async function company(request: APIRequestContext): Promise<Venture> {
  return post<Venture>(request, '/v1/ventures', { name: `Dashboard verification ${stamp()}`, founder_name: 'Tanush',
    idea: 'A pantry companion for busy families that tracks ingredients and suggests meals using food they already have.', budget_usd: 25 });
}
async function select(page: Page, venture: Venture, path = '/dashboard') {
  await page.addInitScript((id) => localStorage.setItem('foundry.venture', id), venture.id);
  await page.goto(path);
}

test.describe('dashboard', () => {
  test('D-01 onboarding uploads founder context and launches the real fake-mode company', async ({ page, request }) => {
    const name = `Pantry launch ${stamp()}`;
    const context = 'Must work for a household. Show expiry dates and a searchable pantry list.';
    await page.goto('/onboarding');
    await page.getByLabel('Founder name').fill('Tanush');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByLabel('Venture name').fill(name);
    await page.getByRole('textbox', { name: /^Idea/ }).fill('A pantry companion for busy families that records ingredients, flags food nearing expiry, and suggests meals from what is already available.');
    await page.getByLabel('Budget', { exact: true }).fill('25');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByLabel('Context files').setInputFiles({ name: 'requirements.txt', mimeType: 'text/plain', buffer: Buffer.from(context) });
    await expect(page.getByRole('listitem').filter({ hasText: 'requirements.txt' })).toBeVisible();
    const uploaded = page.waitForResponse((response) => response.url().includes('/files') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const uploadResponse = await uploaded;
    expect(uploadResponse.ok()).toBeTruthy();
    expect((await uploadResponse.json()).data.items[0]).toMatchObject({ name: 'requirements.txt', excerpt_chars: context.length });
    await page.getByRole('button', { name: 'Launch company', exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
    const id = await page.evaluate(() => localStorage.getItem('foundry.venture'));
    expect(id).toBeTruthy();
    const venture = await data<Venture>(request, `/v1/ventures/${id}`);
    expect(venture.name).toBe(name); expect(venture.status).toBe('running');
    await expect(page.getByRole('link', { name: /Enter World/ })).toHaveAttribute('href', `/view?venture=${id}`);
    await expect(page.getByText(/Your company is starting/)).toBeVisible();
  });

  test('D-02 every dashboard route and existing record detail renders without a browser exception', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const venture = await company(request);
    await post(request, `/v1/ventures/${venture.id}/start`);
    await expect.poll(async () => (await data<ListPage<Artifact>>(request, `/v1/ventures/${venture.id}/artifacts`)).items.length).toBeGreaterThan(0);
    await post(request, `/v1/ventures/${venture.id}/pause`);
    await select(page, venture);
    for (const [path, heading] of [['/dashboard', 'Overview'], ['/departments', 'Departments'], ['/agents', 'Agents'], ['/tickets', 'Tickets'], ['/runs', 'Runs'], ['/approvals', 'Approvals'], ['/chat', 'Chat'], ['/org', 'Org'], ['/artifacts', 'Artifacts'], ['/computers', 'Computers'], ['/world-lab', 'World Lab'], ['/metrics', 'Metrics'], ['/integrations', 'Integrations'], ['/settings', 'Settings']]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
    }
    const tickets = await data<ListPage<Ticket>>(request, `/v1/ventures/${venture.id}/tickets`);
    const artifacts = await data<ListPage<Artifact>>(request, `/v1/ventures/${venture.id}/artifacts`);
    const runs = await data<ListPage<Run>>(request, `/v1/ventures/${venture.id}/runs`);
    const runHeading = runs.items[0].job.replace(/[._-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    for (const [path, heading] of [[`/tickets/${tickets.items[0].id}`, tickets.items[0].title], [`/artifacts/${artifacts.items[0].id}`, artifacts.items[0].title], [`/runs/${runs.items[0].id}`, runHeading], ['/departments/engineering', /Engineering/], ['/agents/eng.builder', 'Zara']]) {
      await page.goto(path as string);
      await expect(page.getByRole('heading', { level: 1, name: heading, exact: typeof heading === 'string' })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('D-03 approving and rejecting gates records each founder decision and re-enters its ticket', async ({ page, request }) => {
    const venture = await company(request);
    const first = await post<Ticket>(request, `/v1/ventures/${venture.id}/tickets`, { type: 'qa.verify', department_id: 'engineering', title: 'Verify approval path' });
    const second = await post<Ticket>(request, `/v1/ventures/${venture.id}/tickets`, { type: 'qa.verify', department_id: 'engineering', title: 'Verify rejection path' });
    await post(request, `/v1/ventures/${venture.id}/start`);
    let approvals: Approval[] = [];
    await expect.poll(async () => {
      approvals = (await data<ListPage<Approval>>(request, `/v1/ventures/${venture.id}/approvals?status=pending`)).items.filter((approval) => approval.ticket_id === first.id || approval.ticket_id === second.id);
      return approvals.length;
    }, { timeout: 15_000 }).toBe(2);
    await post(request, `/v1/ventures/${venture.id}/pause`);
    await select(page, venture, '/approvals');
    const approved = approvals.find((approval) => approval.ticket_id === first.id)!, rejected = approvals.find((approval) => approval.ticket_id === second.id)!;
    const approveCard = page.locator(`#${approved.id}`), rejectCard = page.locator(`#${rejected.id}`);
    await approveCard.getByRole('textbox').fill('Verified in the dashboard browser test.');
    await approveCard.getByRole('button', { name: 'Approve', exact: true }).click();
    await rejectCard.getByRole('button', { name: 'Reject', exact: true }).click();
    await expect.poll(async () => (await data<ListPage<Approval>>(request, `/v1/ventures/${venture.id}/approvals`)).items.find((approval) => approval.id === approved.id)?.status).toBe('approved');
    await expect.poll(async () => (await data<ListPage<Approval>>(request, `/v1/ventures/${venture.id}/approvals`)).items.find((approval) => approval.id === rejected.id)?.status).toBe('rejected');
    expect((await data<Ticket>(request, `/v1/tickets/${first.id}`)).status).toBe('open');
    expect((await data<Ticket>(request, `/v1/tickets/${second.id}`)).status).toBe('open');
    await post(request, `/v1/ventures/${venture.id}/resume`);
    for (const ticket of [first, second]) await expect.poll(async () => (await data<Ticket>(request, `/v1/tickets/${ticket.id}`)).status, { timeout: 10_000 }).toBe('done');
  });

  test('D-04 real server events update a visible ticket list without a page reload', async ({ page, request }) => {
    const venture = await company(request);
    await select(page, venture, '/tickets');
    await expect(page.getByRole('heading', { name: 'Tickets', exact: true })).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No tickets yet', exact: true })).toBeVisible();
    let reloads = 0; page.on('load', () => reloads++);
    const title = `Live ticket ${stamp()}`;
    const ticket = await post<Ticket>(request, `/v1/ventures/${venture.id}/tickets`, { type: 'brief', department_id: 'intake', title });
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText('Live', { exact: true })).toBeVisible();
    await post(request, `/v1/tickets/${ticket.id}/cancel`);
    await expect(page.getByRole('row').filter({ hasText: title })).toContainText(/Cancelled/i);
    expect(reloads).toBe(0);
  });

  test('D-05 runtime badges, unavailable voice calls and world navigation keep their contracts', async ({ page, request }) => {
    const venture = await company(request);
    await select(page, venture, '/agents/eng.builder');
    await expect(page.getByRole('heading', { name: 'Zara', exact: true })).toBeVisible();
    await expect(page.getByText('Runs on', { exact: true })).toBeVisible();
    await expect(page.getByText(/Antigravity/).first()).toBeVisible();
    await page.getByLabel('Message Zara').fill('What are you working on right now?');
    const answerReady = page.waitForResponse((response) => response.url().endsWith('/agents/eng.builder/talk') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Ask agent', exact: true }).click();
    const response = await answerReady;
    expect(response.ok()).toBeTruthy();
    const answer = (await response.json()).data as TalkResponse;
    expect(answer.answer_id).toMatch(/^ans_/); expect(answer.text.length).toBeGreaterThan(0);
    await expect(page.getByText(answer.text, { exact: true }).last()).toBeVisible();
    const stored = await data<{ text: string }>(request, `/v1/answers/${answer.answer_id}`);
    expect(stored.text).toBe(answer.text);
    await page.getByRole('button', { name: 'Call Zara', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Call Zara' });
    await expect(dialog.getByText(/Voice calls unavailable/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Mute', exact: true })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close call', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByLabel('Message Zara')).toBeVisible();
    const find = page.getByRole('link', { name: /Find in the world/ });
    await expect(find).toHaveAttribute('href', `/view?venture=${venture.id}&goto=eng.builder`);
    await find.click();
    await expect(page).toHaveURL(new RegExp(`/view\\?venture=${venture.id}&goto=eng.builder$`));
    await page.goto('/dashboard');
    await page.getByRole('link', { name: /Enter World/ }).click();
    await expect(page).toHaveURL(new RegExp(`/view\\?venture=${venture.id}$`));
  });

  test('World Lab test fixtures show recorded evidence and a complete live-round promotion flow', async ({ page, request }) => {
    const venture = await company(request);
    const files = '/v1/world/worldgen/files/browser-test-fixture';
    const capture = (side: string) => ({ screenshots: { 'ext-1': `${files}/${side}-exterior.svg`, 'int-1': `${files}/${side}-interior.svg` }, videos: { ext: `${files}/${side}-walkthrough.webm` } });
    const issue = { severity: 'high' as const, where: 'Entrance', camera: 'ext-1', description: 'Test fixture: the facade blocks the entrance.', fix: 'Test fixture: move the door clear of the facade.' };
    const iteration = (n: number, score: number) => ({ n, probe_score: score, visual_score: score - .05, realism: score - .1, failed_probes: n === 0 ? ['P2'] : [], issues: [issue], keep: ['Test fixture: keep the roofline.'], captures: capture(`iteration-${n}`) });
    const run: WorldgenRun = { run_id: 'wgr_browser_test_fixture', created_at: '2026-10-25T18:00:00Z', status: 'succeeded',
      iterations: [{ n: 0, world_score: .4, visual_score: .35, realism: .3 }, { n: 1, world_score: .7, visual_score: .65, realism: .6 }],
      final_world_score: .7, final_visual_score: .65, final_realism: .6, generated: 2, fallback: 0,
      buildings: [{ department_id: 'engineering', status: 'generated', best_iteration: 1, iterations: [iteration(0, .3), iteration(1, .5)] },
        { department_id: 'intake', status: 'generated', best_iteration: 1, iterations: [iteration(0, .5), iteration(1, .9)] }] };
    const started: LiveRound = { id: 'wlr_browser_test_fixture', department_id: 'engineering', status: 'capturing', fast: true,
      created_at: new Date().toISOString(), finished_at: null, elapsed_s: 0, steps: [{ name: 'capture_before', status: 'running', started_at: null, finished_at: null, note: 'Test fixture: capture is running.' }],
      before: { captures: capture('before'), probe_score: .5, visual_score: .45, realism: .4 }, after: null, issues: [issue], used_managed_agent: true, promoted: false, error: null };
    let active: LiveRound | null = null;
    let complete = false;
    let promoteCalls = 0;
    await page.route('**/v1/world/worldgen/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith(`${files}/`)) {
        if (path.endsWith('.webm')) return route.fulfill({ status: 204, contentType: 'video/webm', body: '' });
        return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300"><rect width="480" height="300" fill="#e6e1d8"/><text x="30" y="150">Browser test fixture capture</text></svg>' });
      }
      if (path.endsWith('/promote')) {
        promoteCalls++;
        active = { ...active!, promoted: true };
        return route.fulfill({ json: { data: active } });
      }
      if (path.endsWith('/live-rounds') && route.request().method() === 'POST') {
        expect(route.request().postDataJSON()).toEqual({ department_id: 'engineering', fast: true });
        active = started;
        return route.fulfill({ json: { data: active } });
      }
      if (complete && active) active = { ...active, status: 'done', finished_at: new Date().toISOString(), elapsed_s: 12,
        steps: [{ name: 'capture_before', status: 'done', started_at: null, finished_at: null, note: 'Test fixture: capture complete.' }, { name: 'score', status: 'done', started_at: null, finished_at: null, note: 'Test fixture: scoring complete.' }],
        after: { captures: capture('after'), probe_score: .8, visual_score: .75, realism: .7 } };
      if (path.endsWith('/latest') || path === '/v1/world/worldgen/runs/wgr_browser_test_fixture') return route.fulfill({ json: { data: run } });
      if (path.endsWith('/runs')) return route.fulfill({ json: { data: { items: [run], next_cursor: null } } });
      if (path.endsWith('/live-rounds')) return route.fulfill({ json: { data: { items: active ? [active] : [], next_cursor: null } } });
      if (path.endsWith('/wlr_browser_test_fixture')) return route.fulfill({ json: { data: active } });
      return route.fulfill({ status: 404, json: { error: { code: 'not_found', message: 'No such browser test fixture', details: {} } } });
    });
    await select(page, venture, '/world-lab');
    await expect(page.getByRole('heading', { name: 'World Lab', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'World, visual and realism scores by iteration; iteration zero is the single-pass baseline' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Building/ })).toHaveValue('engineering');
    const strip = page.locator('details.wl-building').filter({ hasText: 'Engineering & Build' });
    await strip.locator('summary').click();
    await expect(strip.getByText(issue.description).first()).toBeVisible();
    const screenshot = strip.getByRole('img', { name: 'ext-1 · iteration 0', exact: true });
    await expect(screenshot).toBeVisible();
    await expect.poll(() => screenshot.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Improve live', exact: true }).click();
    await expect(page.getByText('Test fixture: capture is running.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Improve live', exact: true })).toBeDisabled();
    complete = true;
    await expect(page.getByRole('button', { name: 'Promote this result', exact: true })).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByRole('img', { name: 'ext-1 before improvement', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: 'ext-1 after improvement', exact: true })).toBeVisible();
    const comparison = page.getByRole('slider', { name: 'Before and after comparison', exact: true });
    await comparison.focus(); await comparison.press('Home'); await comparison.press('ArrowRight');
    await expect(comparison).toHaveValue('1');
    await expect(page.locator('video[aria-label="Before ext walkthrough"]')).toHaveAttribute('src', `${files}/before-walkthrough.webm`);
    await expect(page.locator('video[aria-label="After ext walkthrough"]')).toHaveAttribute('src', `${files}/after-walkthrough.webm`);
    await page.getByRole('button', { name: 'Promote this result', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Promoted', exact: true })).toBeDisabled();
    expect(promoteCalls).toBe(1);
    await expect(page.getByRole('link', { name: /Open in the world/ }).last()).toHaveAttribute('href', `/view?venture=${venture.id}&goto=eng.tech-lead`);
  });
});
