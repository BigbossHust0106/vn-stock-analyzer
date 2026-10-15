import { randomBytes, randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { managementClient } from './sync-rankings';

/** Confirmed temporary user for browser checks; credentials stay in memory. */
export async function authenticateBrowser(
  page: Page,
  base: string,
  next = '/',
) {
  const { db } = await managementClient();
  const email = `codex-browser-${randomUUID()}@example.test`;
  const password = randomBytes(32).toString('base64url');
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user)
    throw new Error('Cannot create browser test account');
  const id = data.user.id;
  const cleanup = async () => {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) throw new Error('Browser test account cleanup failed');
  };
  try {
    await page.goto(base + '/login?next=' + encodeURIComponent(next));
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(
      page.getByRole('navigation', { name: 'Chức năng chính' }),
    ).toBeVisible({ timeout: 30000 });
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}
export async function openAccountMenu(page: Page) {
  await page
    .getByRole('button', { name: 'Menu tài khoản', exact: true })
    .click();
}
export async function enableChart(page: Page) {
  await page
    .getByRole('checkbox', { name: 'Tự động tải biểu đồ nến', exact: true })
    .check();
}
