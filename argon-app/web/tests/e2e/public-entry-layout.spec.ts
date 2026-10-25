import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768, 1440]) {
  test(`public entry is contained and stable before/after dashboard CSS at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/welcome');
    await expect(page.locator('.ycbf-product')).toBeVisible();
    const measure = () => page.evaluate(() => {
      const selectors = ['.foundry-entry', '.ycbf-hero h1', '.ycbf-section-intro h2', '.ycbf-product-body h3', '.ycbf-lead', '.ycbf-cta', '.ycbf-product'];
      return selectors.map(selector => {
        const node = document.querySelector(selector)!;
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return { selector, font: style.font, color: style.color, background: style.backgroundColor, lineHeight: style.lineHeight, width: rect.width, height: rect.height };
      });
    });
    const before = await measure();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('a[href="/dashboard"]').click();
    await page.waitForURL('**/dashboard');
    await page.waitForFunction(() => [...document.styleSheets].some(sheet => {
      try { return [...sheet.cssRules].some(rule => rule.cssText.includes('.dashboard-shell')); } catch { return false; }
    }));
    await page.goBack();
    await expect(page.locator('.ycbf-product')).toBeVisible();
    expect(await measure()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.locator('.ycbf-hero a[href="/signin"]').click();
    await expect(page.getByLabel('Display name')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByRole('button', { name: 'Continue with local demo' }).click();
    await expect(page.locator('.onboarding-card')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByLabel('Founder name').fill('Layout Reviewer');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'What are we building?' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
