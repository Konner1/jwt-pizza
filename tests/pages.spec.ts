import { Page } from '@playwright/test';
import { test, expect } from 'playwright-test-coverage';

const diner = { id: 3, name: 'Kai Chen', email: 'd@jwt.com', roles: [{ role: 'diner' }] };
const franchisee = { id: 4, name: 'Fran Chisee', email: 'f@jwt.com', roles: [{ role: 'diner' }, { role: 'franchisee', objectId: '2' }] };
const admin = { id: 1, name: 'Ad Min', email: 'a@jwt.com', roles: [{ role: 'admin' }] };

const menu = [
  { id: 1, title: 'Veggie', image: 'pizza1.png', price: 0.0038, description: 'A garden of delight' },
  { id: 2, title: 'Pepperoni', image: 'pizza2.png', price: 0.0042, description: 'Spicy treat' },
];

const franchises = [
  {
    id: 2,
    name: 'LotaPizza',
    admins: [{ id: 4, name: 'Fran Chisee', email: 'f@jwt.com' }],
    stores: [
      { id: 4, name: 'Lehi', totalRevenue: 1.5 },
      { id: 5, name: 'Springville', totalRevenue: 2 },
    ],
  },
  { id: 3, name: 'PizzaCorp', admins: [{ id: 5, name: 'Corp Owner', email: 'c@jwt.com' }], stores: [{ id: 7, name: 'Spanish Fork', totalRevenue: 3 }] },
  { id: 4, name: 'topSpot', stores: [] },
];

// Mocks every backend endpoint the frontend uses. Pass a user to start logged in.
async function init(page: Page, user?: any, orders: any[] = []) {
  let currentUser = user;
  if (user) {
    await page.addInitScript(() => localStorage.setItem('token', 'abcdef'));
  }

  await page.route('*/**/api/auth', async (route) => {
    const method = route.request().method();
    if (method === 'DELETE') {
      currentUser = undefined;
      await route.fulfill({ json: { message: 'logout successful' } });
      return;
    }
    const body = route.request().postDataJSON();
    if (method === 'PUT' && body.password !== 'a') {
      await route.fulfill({ status: 401, json: { message: 'unknown user' } });
      return;
    }
    currentUser = method === 'POST' ? { id: 3, name: body.name, email: body.email, roles: [{ role: 'diner' }] } : diner;
    await route.fulfill({ json: { user: currentUser, token: 'abcdef' } });
  });

  await page.route('*/**/api/user/me', async (route) => {
    await route.fulfill({ json: currentUser });
  });

  await page.route('*/**/api/order/menu', async (route) => {
    await route.fulfill({ json: menu });
  });

  await page.route('*/**/api/order', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { id: 'd1', dinerId: 3, orders } });
      return;
    }
    const orderReq = route.request().postDataJSON();
    await route.fulfill({ json: { order: { ...orderReq, id: 23 }, jwt: 'eyJpYXQ' } });
  });

  // /api/franchise, /api/franchise/:id and the store endpoints under it
  await page.route(/\/api\/franchise/, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname === '/api/franchise' && method === 'GET') {
      await route.fulfill({ json: { franchises, more: true } });
    } else if (pathname === '/api/franchise' && method === 'POST') {
      await route.fulfill({ json: { ...request.postDataJSON(), id: 9, stores: [] } });
    } else if (method === 'GET') {
      await route.fulfill({ json: [franchises[0]] });
    } else if (method === 'POST') {
      await route.fulfill({ json: { ...request.postDataJSON(), id: 10 } });
    } else {
      await route.fulfill({ json: { message: 'deleted' } });
    }
  });

  await page.route('*/**/api/order/verify', async (route) => {
    await route.fulfill({ json: { message: 'valid', payload: { vendor: { id: 'test' } } } });
  });

  await page.route('*/**/api/docs', async (route) => {
    await route.fulfill({
      json: {
        endpoints: [{ requiresAuth: true, method: 'GET', path: '/api/order', description: 'Get the orders', example: 'curl localhost', response: { orders: [] } }],
      },
    });
  });
}

test('login with bad password shows an error', async ({ page }) => {
  await init(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'Login' }).click();
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('wrong');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByText('unknown user')).toBeVisible();
  await expect(page.getByRole('link', { name: 'KC' })).toBeHidden();
});

test('logout', async ({ page }) => {
  await init(page, diner);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'KC' })).toBeVisible();

  await page.getByRole('link', { name: 'Logout' }).click();

  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'KC' })).toBeHidden();
});

test('purchase with login, then verify the pizza', async ({ page }) => {
  await init(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Order now' }).click();
  await expect(page.locator('h2')).toContainText('Awesome is a click away');
  await expect(page.getByRole('button', { name: 'Checkout' })).toBeDisabled();

  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('button', { name: /Veggie/ }).click();
  await page.getByRole('button', { name: /Pepperoni/ }).click();
  await expect(page.locator('form')).toContainText('Selected pizzas: 2');
  await page.getByRole('button', { name: 'Checkout' }).click();

  // not logged in, so payment sends us to login
  await page.getByPlaceholder('Email address').fill('d@jwt.com');
  await page.getByPlaceholder('Password').fill('a');
  await page.getByRole('button', { name: 'Login' }).click();

  await expect(page.getByRole('main')).toContainText('Send me those 2 pizzas right now!');
  await expect(page.locator('tbody')).toContainText('Veggie');
  await expect(page.locator('tbody')).toContainText('Pepperoni');
  await expect(page.locator('tfoot')).toContainText('0.008 ₿');
  await page.getByRole('button', { name: 'Pay now' }).click();

  await expect(page.getByText('order ID:')).toBeVisible();
  await expect(page.getByText('eyJpYXQ')).toBeVisible();
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /JWT Pizza - valid/ })).toBeVisible();
});

test('purchase a single pizza while logged in', async ({ page }) => {
  await init(page, diner);
  await page.goto('/menu');

  await page.getByRole('combobox').selectOption('5');
  await page.getByRole('button', { name: /Veggie/ }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();

  await expect(page.getByRole('main')).toContainText('Send me that pizza right now!');
  await expect(page.locator('tfoot')).toContainText('1 pie');
});

test('cancel payment returns to the menu with the selection kept', async ({ page }) => {
  await init(page, diner);
  await page.goto('/menu');

  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('button', { name: /Pepperoni/ }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await expect(page.locator('h2')).toContainText('Awesome is a click away');
  await expect(page.locator('form')).toContainText('Selected pizzas: 1');
});

test('payment failure shows the error', async ({ page }) => {
  await init(page, diner);
  await page.route('*/**/api/order', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 500, json: { message: 'Pizza oven on fire' } });
    } else {
      await route.fallback();
    }
  });
  await page.goto('/menu');

  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('button', { name: /Veggie/ }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Pay now' }).click();

  await expect(page.getByText('Pizza oven on fire')).toBeVisible();
});

test('invalid pizza fails verification', async ({ page }) => {
  await init(page, diner);
  await page.route('*/**/api/order/verify', async (route) => {
    await route.fulfill({ status: 400, json: { message: 'invalid' } });
  });
  await page.goto('/menu');

  await page.getByRole('combobox').selectOption('4');
  await page.getByRole('button', { name: /Veggie/ }).click();
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.getByRole('button', { name: 'Pay now' }).click();
  await page.getByRole('button', { name: 'Verify' }).click();

  await expect(page.getByRole('heading', { name: /JWT Pizza - invalid/ })).toBeVisible();
  await expect(page.getByText('Looks like you have a bad pizza!')).toBeVisible();
});

test('diner dashboard shows user details and order history', async ({ page }) => {
  const orders = [{ id: 'o1', franchiseId: 2, storeId: 4, date: '2024-06-05T05:14:40.000Z', items: [{ menuId: 1, description: 'Veggie', price: 0.0038 }] }];
  await init(page, franchisee, orders);
  await page.goto('/diner-dashboard');

  await expect(page.getByText('Your pizza kitchen')).toBeVisible();
  await expect(page.getByText('f@jwt.com')).toBeVisible();
  await expect(page.getByText('Franchisee on 2')).toBeVisible();
  await expect(page.getByText('Here is your history of all the good times.')).toBeVisible();
  await expect(page.locator('tbody')).toContainText('o1');
  await expect(page.locator('tbody')).toContainText('0.004 ₿');
});

test('diner dashboard with no orders', async ({ page }) => {
  await init(page, diner);
  await page.goto('/');
  await page.getByRole('link', { name: 'KC' }).click();

  await expect(page.getByText('How have you lived this long without having a pizza?')).toBeVisible();
  await page.getByRole('link', { name: 'Buy one' }).click();
  await expect(page.locator('h2')).toContainText('Awesome is a click away');
});

test('franchise page for someone who is not a franchisee', async ({ page }) => {
  await init(page, diner);
  await page.route(/\/api\/franchise\/3$/, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.goto('/franchise-dashboard');

  await expect(page.getByText('So you want a piece of the pie?')).toBeVisible();
  await expect(page.getByText('Unleash Your Potential')).toBeVisible();
});

test('franchisee can create and close a store', async ({ page }) => {
  await init(page, franchisee);
  await page.goto('/franchise-dashboard');

  await expect(page.getByRole('heading', { name: 'LotaPizza' })).toBeVisible();
  await expect(page.locator('tbody')).toContainText('Lehi');
  await expect(page.locator('tbody')).toContainText('Springville');

  // create
  await page.getByRole('button', { name: 'Create store' }).click();
  await page.getByPlaceholder('store name').fill('Orem');
  const createRequest = page.waitForRequest((r) => r.url().endsWith('/api/franchise/2/store') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Create' }).click();
  expect((await createRequest).postDataJSON()).toMatchObject({ name: 'Orem' });
  await expect(page.getByRole('heading', { name: 'LotaPizza' })).toBeVisible();

  // cancel out of a create
  await page.getByRole('button', { name: 'Create store' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'LotaPizza' })).toBeVisible();

  // close
  await page.getByRole('row', { name: /Lehi/ }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Are you sure you want to close the LotaPizza store Lehi')).toBeVisible();
  const closeRequest = page.waitForRequest((r) => r.url().endsWith('/api/franchise/2/store/4') && r.method() === 'DELETE');
  await page.getByRole('button', { name: 'Close' }).click();
  await closeRequest;
  await expect(page.getByRole('heading', { name: 'LotaPizza' })).toBeVisible();
});

test('admin dashboard lists franchises, filters and pages', async ({ page }) => {
  await init(page, admin);
  await page.goto('/admin-dashboard');

  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
  await expect(page.getByText('LotaPizza')).toBeVisible();
  await expect(page.getByText('PizzaCorp')).toBeVisible();
  await expect(page.getByText('Spanish Fork')).toBeVisible();
  await expect(page.getByRole('button', { name: '«' })).toBeDisabled();

  // next page
  const nextPage = page.waitForRequest((r) => r.url().includes('page=1'));
  await page.getByRole('button', { name: '»' }).click();
  await nextPage;
  await expect(page.getByRole('button', { name: '«' })).toBeEnabled();

  // filter
  const filter = page.waitForRequest((r) => r.url().includes('name=*Lota*'));
  await page.getByPlaceholder('Filter franchises').fill('Lota');
  await page.getByRole('button', { name: 'Submit' }).click();
  await filter;
});

test('admin can create a franchise', async ({ page }) => {
  await init(page, admin);
  await page.goto('/admin-dashboard');

  await page.getByRole('button', { name: 'Add Franchise' }).click();
  await page.getByPlaceholder('franchise name').fill('NewPizza');
  await page.getByPlaceholder('franchisee admin email').fill('f@jwt.com');
  const createRequest = page.waitForRequest((r) => r.url().endsWith('/api/franchise') && r.method() === 'POST');
  await page.getByRole('button', { name: 'Create' }).click();

  expect((await createRequest).postDataJSON()).toMatchObject({ name: 'NewPizza', admins: [{ email: 'f@jwt.com' }] });
  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();

  // cancel out of a create
  await page.getByRole('button', { name: 'Add Franchise' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
});

test('admin can close a franchise', async ({ page }) => {
  await init(page, admin);
  await page.goto('/admin-dashboard');

  await page.getByRole('row', { name: /PizzaCorp/ }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Are you sure you want to close the PizzaCorp franchise?')).toBeVisible();
  const closeRequest = page.waitForRequest((r) => r.url().endsWith('/api/franchise/3') && r.method() === 'DELETE');
  await page.getByRole('button', { name: 'Close' }).click();
  await closeRequest;
  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();

  // cancel out of a close
  await page.getByRole('row', { name: /PizzaCorp/ }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
});

test('admin can close a store', async ({ page }) => {
  await init(page, admin);
  await page.goto('/admin-dashboard');

  await page.getByRole('row', { name: /Spanish Fork/ }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByText('Are you sure you want to close the PizzaCorp store Spanish Fork')).toBeVisible();
  const closeRequest = page.waitForRequest((r) => r.url().endsWith('/api/franchise/3/store/7') && r.method() === 'DELETE');
  await page.getByRole('button', { name: 'Close' }).click();
  await closeRequest;
  await expect(page.getByText("Mama Ricci's kitchen")).toBeVisible();
});

test('admin dashboard is hidden from non-admins', async ({ page }) => {
  await init(page, diner);
  await page.goto('/admin-dashboard');

  await expect(page.getByText("Mama Ricci's kitchen")).toBeHidden();
  await expect(page.getByText('Oops')).toBeVisible();
});

test('static pages', async ({ page }) => {
  await init(page);

  await page.goto('/about');
  await expect(page.getByText('The secret sauce')).toBeVisible();

  await page.goto('/history');
  await expect(page.getByText('Mama Rucci, my my')).toBeVisible();

  await page.goto('/some/bad/path');
  await expect(page.getByText('Oops')).toBeVisible();
});

test('api docs', async ({ page }) => {
  await init(page);

  await page.goto('/docs/service');
  await expect(page.getByText('[GET] /api/order')).toBeVisible();
  await expect(page.getByText('Get the orders')).toBeVisible();

  await page.goto('/docs/factory');
  await expect(page.getByText('[GET] /api/order')).toBeVisible();
});
