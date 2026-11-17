import { sleep, check, group, fail } from 'k6';
import http from 'k6/http';

// JWT Pizza load test: log in, view the menu, buy a pizza, verify the pizza JWT.
// Set EMAIL and PASSWORD below to a real JWT Pizza user before running in Grafana.

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 5 },
    { duration: '30s', target: 0 },
  ],
};

const SERVICE = 'https://pizza-service.pizzakonner.click';
const FRONTEND = 'https://pizza.pizzakonner.click';
const FACTORY = 'https://pizza-factory.cs329.click';
const EMAIL = 'd@jwt.com';
const PASSWORD = 'PASSWORD';

export default function () {
  const vars = {};
  let response;

  group('Login and order pizza', () => {
    // 1. Login
    response = http.put(SERVICE + '/api/auth', JSON.stringify({ email: EMAIL, password: PASSWORD }), {
      headers: { accept: '*/*', 'content-type': 'application/json', origin: FRONTEND },
    });
    if (!check(response, { 'login status equals 200': (r) => r.status.toString() === '200' })) {
      console.log(response.body);
      fail('Login was *not* 200');
    }
    vars.authToken = response.json().token;
    const authHeaders = {
      accept: '*/*',
      'content-type': 'application/json',
      origin: FRONTEND,
      authorization: 'Bearer ' + vars.authToken,
    };
    sleep(1);

    // 2. Menu
    response = http.get(SERVICE + '/api/order/menu', { headers: authHeaders });
    check(response, { 'menu status equals 200': (r) => r.status.toString() === '200' });
    const menu = response.json();
    const pizza = menu[0];
    sleep(1);

    // 3. Franchises / stores
    response = http.get(SERVICE + '/api/franchise', { headers: authHeaders });
    check(response, { 'franchise status equals 200': (r) => r.status.toString() === '200' });
    const body = response.json();
    const franchises = Array.isArray(body) ? body : body.franchises;
    const franchise = franchises.find((f) => f.stores && f.stores.length > 0) || franchises[0];
    sleep(1);

    // 4. Buy the pizza
    response = http.post(
      SERVICE + '/api/order',
      JSON.stringify({
        items: [{ menuId: pizza.id, description: pizza.title, price: pizza.price }],
        storeId: franchise.stores[0].id,
        franchiseId: franchise.id,
      }),
      { headers: authHeaders }
    );
    if (!check(response, { 'purchase status equals 200': (r) => r.status.toString() === '200' })) {
      console.log(response.body);
      fail('Purchase was *not* 200');
    }
    vars.pizzaJwt = response.json().jwt; // read the JWT from the purchase response
    sleep(1);

    // 5. Verify the pizza JWT
    response = http.post(FACTORY + '/api/order/verify', JSON.stringify({ jwt: vars.pizzaJwt }), {
      headers: { accept: '*/*', 'content-type': 'application/json', origin: FRONTEND, authorization: 'Bearer ' + vars.authToken },
    });
    check(response, {
      'verify status equals 200': (r) => r.status.toString() === '200',
      'pizza JWT is valid': (r) => r.json().message === 'valid',
    });
  });
}
