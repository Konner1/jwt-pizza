import { Page } from '@playwright/test';
import { test, expect } from 'playwright-test-coverage';

// Mocks the backend with one in-memory user so register, update, logout and login all behave consistently.
async function mockBackend(page: Page) {
  let user: any = null;
  let password = '';
  let loggedIn = false;

  await page.route(/\/api\/auth$/, async (route) => {
    const method = route.request().method();
    const body = route.request().postDataJSON();
    if (method === 'DELETE') {
      loggedIn = false;
      return route.fulfill({ json: { message: 'logout successful' } });
    }
    if (method === 'POST') {
      user = { id: 10, name: body.name, email: body.email, roles: [{ role: 'diner' }] };
      password = body.password;
    } else if (!user || body.email !== user.email || body.password !== password) {
      return route.fulfill({ status: 404, json: { message: 'unknown user' } });
    }
    loggedIn = true;
    await route.fulfill({ json: { user, token: 'abcdef' } });
  });

  await page.route(/\/api\/user\/me$/, (route) => route.fulfill({ json: loggedIn ? user : null }));

  await page.route(/\/api\/user\/\d+$/, async (route) => {
    const body = route.request().postDataJSON();
    user = { ...user, name: body.name, email: body.email };
    if (body.password) password = body.password;
    await route.fulfill({ json: { user, token: 'abcdef' } });
  });

  await page.route(/\/api\/order$/, (route) => route.fulfill({ json: { dinerId: 10, orders: [] } }));
}

async function registerAndOpenDashboard(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Register' }).click();
  await page.getByRole('textbox', { name: 'Full name' }).fill('pizza diner');
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill('diner');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.getByRole('link', { name: 'pd' }).click();
  await expect(page.getByRole('main')).toContainText('pizza diner');
}

async function logoutAndLogin(page: Page, email: string, password: string) {
  await page.getByRole('link', { name: 'Logout' }).click();
  await page.getByRole('link', { name: 'Login' }).click();
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
}

test('updateUser name persists after logout and login', async ({ page }) => {
  await mockBackend(page);
  const email = 'user1@jwt.com';
  await registerAndOpenDashboard(page, email);

  await page.getByRole('button', { name: 'Edit' }).click();
  await expect(page.locator('h3')).toContainText('Edit user');
  await page.getByRole('textbox').first().fill('pizza dinerx');
  await page.getByRole('button', { name: 'Update' }).click();
  await page.waitForSelector('[role="dialog"].hidden', { state: 'attached' });
  await expect(page.getByRole('main')).toContainText('pizza dinerx');

  await logoutAndLogin(page, email, 'diner');
  await page.getByRole('link', { name: 'pd' }).click();
  await expect(page.getByRole('main')).toContainText('pizza dinerx');
});

test('updateUser email and password can be used to log in again', async ({ page }) => {
  await mockBackend(page);
  await registerAndOpenDashboard(page, 'user2@jwt.com');

  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox').nth(1).fill('new@jwt.com');
  await page.getByRole('textbox').nth(2).fill('newpass');
  await page.getByRole('button', { name: 'Update' }).click();
  await page.waitForSelector('[role="dialog"].hidden', { state: 'attached' });
  await expect(page.getByRole('main')).toContainText('new@jwt.com');

  await logoutAndLogin(page, 'new@jwt.com', 'newpass');
  await page.getByRole('link', { name: 'pd' }).click();
  await expect(page.getByRole('main')).toContainText('new@jwt.com');
});
