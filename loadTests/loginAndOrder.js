import { sleep, check, group, fail } from 'k6';
import http from 'k6/http';

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 5 },
    { duration: '30s', target: 0 },
  ],
};

export default function () {
  let response;

  const vars = {};

  group('Login and order pizza', function () {
    // login
    response = http.put(
      'https://pizza-service.pizzakonner.click/api/auth',
      '{"email":"d@jwt.com","password":"PASSWORD"}',
      {
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          origin: 'https://pizza.pizzakonner.click',
        },
      }
    );

    if (!check(response, { 'login status equals 200': (response) => response.status.toString() === '200' })) {
      console.log(response.body);
      fail('Login was *not* 200');
    }

    vars.authToken = response.json().token;

    sleep(1);

    // get menu
    response = http.get('https://pizza-service.pizzakonner.click/api/order/menu', {
      headers: {
        accept: '*/*',
        authorization: `Bearer ${vars.authToken}`,
        origin: 'https://pizza.pizzakonner.click',
      },
    });
    check(response, { 'menu status equals 200': (response) => response.status.toString() === '200' });

    vars.pizza = response.json()[0];

    sleep(1);

    // get franchises
    response = http.get('https://pizza-service.pizzakonner.click/api/franchise', {
      headers: {
        accept: '*/*',
        authorization: `Bearer ${vars.authToken}`,
        origin: 'https://pizza.pizzakonner.click',
      },
    });
    check(response, { 'franchise status equals 200': (response) => response.status.toString() === '200' });

    const franchiseBody = response.json();
    const franchises = Array.isArray(franchiseBody) ? franchiseBody : franchiseBody.franchises;
    vars.franchise = franchises.find((f) => f.stores && f.stores.length > 0) || franchises[0];

    sleep(1);

    // buy a pizza
    response = http.post(
      'https://pizza-service.pizzakonner.click/api/order',
      JSON.stringify({
        items: [{ menuId: vars.pizza.id, description: vars.pizza.title, price: vars.pizza.price }],
        storeId: vars.franchise.stores[0].id,
        franchiseId: vars.franchise.id,
      }),
      {
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          authorization: `Bearer ${vars.authToken}`,
          origin: 'https://pizza.pizzakonner.click',
        },
      }
    );

    if (!check(response, { 'purchase status equals 200': (response) => response.status.toString() === '200' })) {
      console.log(response.body);
      fail('Purchase was *not* 200');
    }

    // read the pizza JWT from the purchase response
    vars.pizzaJwt = response.json().jwt;

    sleep(1);

    // verify the pizza JWT
    response = http.post(
      'https://pizza-factory.cs329.click/api/order/verify',
      JSON.stringify({ jwt: vars.pizzaJwt }),
      {
        headers: {
          accept: '*/*',
          'content-type': 'application/json',
          authorization: `Bearer ${vars.authToken}`,
          origin: 'https://pizza.pizzakonner.click',
        },
      }
    );
    check(response, {
      'verify status equals 200': (response) => response.status.toString() === '200',
      'pizza JWT is valid': (response) => response.json().message === 'valid',
    });

    sleep(1);
  });
}