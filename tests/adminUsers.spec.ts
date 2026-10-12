import { test, expect } from 'playwright-test-coverage';

const admin = { id: 1, name: 'Ad Min', email: 'a@jwt.com', roles: [{ role: 'admin' }] };

test('admin lists, filters, pages and deletes users', async ({ page }) => {
  let users = [
    admin,
    ...['Kai Chen', 'Buddy', 'Cara', 'Dan', 'Eve', 'Finn'].map((name, i) => ({ id: i + 2, name, email: `${name[0].toLowerCase()}@jwt.com`, roles: [{ role: 'diner' }] })),
  ];

  await page.addInitScript(() => localStorage.setItem('token', 'abcdef'));
  await page.route(/\/api\/user\/me$/, (route) => route.fulfill({ json: admin }));
  await page.route(/\/api\/franchise/, (route) => route.fulfill({ json: { franchises: [], more: false } }));
  await page.route(/\/api\/user\?/, async (route) => {
    const url = new URL(route.request().url());
    const name = (url.searchParams.get('name') ?? '*').replace(/\*/g, '');
    const p = Number(url.searchParams.get('page'));
    const limit = Number(url.searchParams.get('limit'));
    const matches = users.filter((u) => u.name.includes(name));
    await route.fulfill({ json: { users: matches.slice(p * limit, (p + 1) * limit), more: matches.length > (p + 1) * limit } });
  });
  await page.route(/\/api\/user\/\d+$/, async (route) => {
    const id = Number(route.request().url().split('/').pop());
    users = users.filter((u) => u.id !== id);
    await route.fulfill({ json: { message: 'user deleted' } });
  });

  await page.goto('/admin-dashboard');

  // list shows name, email, role (first page of 5)
  await expect(page.getByRole('row', { name: /Kai Chen/ })).toContainText('k@jwt.com');
  await expect(page.getByRole('row', { name: /Ad Min/ })).toContainText('admin');
  await expect(page.getByText('Finn')).toHaveCount(0);

  // pagination
  await page.getByRole('button', { name: 'Next users page' }).click();
  await expect(page.getByRole('row', { name: /Finn/ })).toBeVisible();
  await page.getByRole('button', { name: 'Previous users page' }).click();
  await expect(page.getByRole('row', { name: /Kai Chen/ })).toBeVisible();

  // filter
  await page.getByPlaceholder('Filter users').fill('Buddy');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByRole('row', { name: /Buddy b@jwt.com/ })).toBeVisible();
  await expect(page.getByText('Kai Chen')).toHaveCount(0);

  // delete
  await page.getByRole('row', { name: /Buddy b@jwt.com/ }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Buddy')).toHaveCount(0);
});
