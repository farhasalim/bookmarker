import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

/** AT-15: no serious axe violations on the core screens; the ribbon works by keyboard. */
async function noSeriousViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${name}: ${v.id} — ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test('core screens pass axe and the bookmark slider works by keyboard', async ({ browser }) => {
  const page = await signIn(browser, 'a11y@e2e.test');
  await noSeriousViolations(page, 'home');

  await page.goto('/clubs/new');
  await page.getByLabel('What’s it called?').fill('Access Club');
  await page.getByRole('button', { name: 'Create club' }).click();
  await expect(page.getByRole('heading', { name: 'Access Club' })).toBeVisible();
  await noSeriousViolations(page, 'club');

  await page.getByRole('link', { name: 'Open a reading room' }).click();
  await page.getByPlaceholder('Title, author or ISBN').fill('Persuasion');
  await page.getByRole('button', { name: 'Enter the book by hand' }).click();
  await page.getByLabel('How many chapters?').fill('6');
  await noSeriousViolations(page, 'new room');
  await page.getByRole('button', { name: 'Confirm chapters and open the room' }).click();
  await expect(page.getByRole('heading', { name: 'Persuasion' })).toBeVisible();
  await noSeriousViolations(page, 'reading room');

  // Keyboard: focus the ribbon slider, press ↓ twice → proposes chapter 2 → confirm.
  const slider = page.getByRole('slider', { name: 'Bookmark: the last chapter you finished' });
  await slider.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Chapter 2 of 6');
  await expect(page.getByText('Move your bookmark to chapter 2?')).toBeVisible();
  await page.keyboard.press('Tab'); // from the ribbon to the confirm bar
  await page.getByRole('button', { name: 'Move bookmark', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('you’re on chapter 2')).toBeVisible();

  await page.getByRole('link', { name: /Chapter 2, read/ }).click();
  await noSeriousViolations(page, 'chapter');
  await page.goto('/letters');
  await noSeriousViolations(page, 'letters');
  await page.goto('/settings');
  await noSeriousViolations(page, 'settings');
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await noSeriousViolations(page, 'profile');
});
