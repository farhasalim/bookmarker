import { expect, test } from '@playwright/test';
import { fillStable, runWorker, signIn } from './helpers';
import { resetE2E } from './reset';

// Each test (and each CI retry) starts from an empty database and mailbox.
test.beforeEach(() => resetE2E());

/**
 * The reading loop, end to end through the real UI:
 * host opens a room → friend joins → friend moves bookmark → posts unlock →
 * post → the other reader sees it live and is notified. Plus the gate: the
 * reader who is behind never sees the text.
 */
test('move bookmark → posts unlock → post → friend is notified', async ({ browser }) => {
  // 1. Anu starts a club and opens a 5-chapter room.
  const anu = await signIn(browser, 'anu@e2e.test');
  await anu.goto('/clubs/new');
  await anu.getByLabel('What’s it called?').fill('Thursday Readers');
  await anu.getByRole('button', { name: 'Create club' }).click();
  await expect(anu.getByRole('heading', { name: 'Thursday Readers' })).toBeVisible();
  await anu.getByRole('link', { name: 'Open a reading room' }).click();
  await anu.getByPlaceholder('Title, author or ISBN').fill('Pride and Prejudice');
  await anu.getByRole('button', { name: 'Enter the book by hand' }).click();
  await anu.getByLabel('How many chapters?').fill('5');
  await anu.getByRole('button', { name: 'Confirm chapters and open the room' }).click();
  await expect(anu.getByRole('heading', { name: 'Pride and Prejudice' })).toBeVisible();
  const roomUrl = anu.url();

  // 2. Anu invites Rahul; Rahul joins through the link.
  await anu.goto(roomUrl.replace(/\/rooms\/.*/, '/clubs'));
  await anu.getByRole('link', { name: /Thursday Readers/ }).click();
  await anu.getByRole('button', { name: 'Create invite link' }).click();
  const inviteUrl = await anu.getByLabel('New invite link (shown once)').inputValue();

  const rahul = await signIn(browser, 'rahul@e2e.test');
  await rahul.goto(inviteUrl);
  await rahul.getByRole('button', { name: 'Join the club' }).click();
  await expect(rahul.getByRole('heading', { name: 'Thursday Readers' })).toBeVisible();
  await rahul.goto(roomUrl);

  // 3. Rahul moves his bookmark to chapter 3 (tap + confirm) and posts there.
  await rahul.getByRole('button', { name: /Chapter 3, not read yet/ }).click();
  await rahul.getByRole('button', { name: 'Move bookmark', exact: true }).click();
  await expect(rahul.getByText('you’re on chapter 3')).toBeVisible();
  const rahulPost = rahul.getByRole('button', { name: 'Post', exact: true });
  await fillStable(
    rahul,
    'Your thought at chapter 3',
    'Mr Collins proposes. I laughed out loud.',
    rahulPost,
  );
  await rahulPost.click();
  await expect(rahul.getByText('Posted.')).toBeVisible();

  // 4. Anu, at chapter 0, sees a count and never the text.
  await anu.goto(roomUrl);
  await expect(
    anu.getByRole('button', { name: /Chapter 3, not read yet, 1 waiting/ }),
  ).toBeVisible();
  await expect(anu.getByText('Mr Collins proposes')).toHaveCount(0);

  // 5. Anu moves to chapter 3: the post unlocks with the "just opened" moment.
  await anu.getByRole('button', { name: /Chapter 3, not read yet/ }).click();
  await expect(anu.getByText('1 thought is waiting there.')).toBeVisible();
  await anu.getByRole('button', { name: 'Move bookmark', exact: true }).click();
  await expect(anu.getByText('just opened')).toBeVisible();
  await expect(anu.getByText('Mr Collins proposes. I laughed out loud.')).toBeVisible();

  // 6. Rahul keeps chapter 3 open; Anu replies with a post; it appears live for Rahul.
  await rahul.goto(roomUrl);
  await rahul.getByRole('link', { name: /Chapter 3, read/ }).click();
  await expect(rahul.getByText('Mr Collins proposes. I laughed out loud.')).toBeVisible();
  await anu.getByRole('link', { name: /Read all 1 and add yours/ }).click();
  const anuPost = anu.getByRole('button', { name: 'Post at chapter 3' });
  await fillStable(anu, 'Your thought at chapter 3', 'And Charlotte’s choice next. Oof.', anuPost);
  await anuPost.click();
  await expect(rahul.getByText('And Charlotte’s choice next. Oof.')).toBeVisible({ timeout: 5000 });

  // 7. The 30-minute batch runs: Rahul is notified in Letters (names and numbers only).
  runWorker('deliver', { in: '31m' });
  await rahul.goto('/letters');
  await expect(rahul.getByText(/left a thought at chapter 3/)).toBeVisible();
  await expect(rahul.getByText('Oof')).toHaveCount(0);
});

test('a reader behind is never shown, or notified about, a post ahead of them', async ({
  browser,
}) => {
  const host = await signIn(browser, 'host@e2e.test');
  await host.goto('/clubs/new');
  await host.getByLabel('What’s it called?').fill('Gate Check Club');
  await host.getByRole('button', { name: 'Create club' }).click();
  await host.getByRole('link', { name: 'Open a reading room' }).click();
  await host.getByPlaceholder('Title, author or ISBN').fill('Middlemarch');
  await host.getByRole('button', { name: 'Enter the book by hand' }).click();
  await host.getByLabel('How many chapters?').fill('4');
  await host.getByRole('button', { name: 'Confirm chapters and open the room' }).click();
  await expect(host.getByRole('heading', { name: 'Middlemarch' })).toBeVisible();
  const roomUrl = host.url();
  await host.goto(roomUrl.replace(/\/rooms\/.*/, '/clubs'));
  await host.getByRole('link', { name: /Gate Check Club/ }).click();
  await host.getByRole('button', { name: 'Create invite link' }).click();
  const invite = await host.getByLabel('New invite link (shown once)').inputValue();

  const slow = await signIn(browser, 'slow@e2e.test');
  await slow.goto(invite);
  await slow.getByRole('button', { name: 'Join the club' }).click();
  await slow.goto(roomUrl);
  await slow.getByRole('button', { name: /Chapter 1, not read yet/ }).click();
  await slow.getByRole('button', { name: 'Move bookmark', exact: true }).click();

  // Host jumps to chapter 4 and posts a spoiler while the slow reader watches the room.
  await host.goto(roomUrl);
  await host.getByRole('button', { name: /Chapter 4, not read yet/ }).click();
  await host.getByRole('button', { name: 'Move bookmark', exact: true }).click();
  const hostPost = host.getByRole('button', { name: 'Post', exact: true });
  await fillStable(host, 'Your thought at chapter 4', 'THE ENDING TWIST', hostPost);
  await hostPost.click();

  await expect(
    slow.getByRole('button', { name: /Chapter 4, not read yet, 1 waiting/ }),
  ).toBeVisible({ timeout: 5000 });
  await expect(slow.getByText('THE ENDING TWIST')).toHaveCount(0);
  runWorker('deliver', { in: '31m' });
  await slow.goto('/letters');
  await expect(slow.getByText(/chapter 4/)).toHaveCount(0);
});
