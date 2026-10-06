import { test, expect } from 'playwright-test-coverage';

test('home page', async ({ page }) => {
  await page.goto('/');

  expect(await page.title()).toBe('JWT Pizza');
});


test('login', async ({ page }) => {
  await page.route('*/**/api/auth', async (route) => {
    expect(route.request().method()).toBe('PUT');
    await route.fulfill({
      json: {
        user: { id: 3, name: 'Kai Chen', email: 'd@jwt.com', roles: [{ role: 'diner' }] },
        token: 'abcdef',
      },
    });
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Login' }).click();
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('link', { name: 'KC' })).toBeVisible();
});

test('register', async ({ page }) => {
  await page.route('*/**/api/auth', async (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toMatchObject({ name: 'Kai Chen', email: 'd@jwt.com', password: 'a' });
    await route.fulfill({
      json: {
        user: { id: 3, name: 'Kai Chen', email: 'd@jwt.com', roles: [{ role: 'diner' }] },
        token: 'abcdef',
      },
    });
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Register' }).click();
  await page.getByPlaceholder('Full name').fill('Kai Chen');
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByRole('link', { name: 'KC' })).toBeVisible();
});