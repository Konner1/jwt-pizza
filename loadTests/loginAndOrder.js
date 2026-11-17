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

  group('Login and view menu', function () {
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

    if (!check(response, { 'status equals 200': (response) => response.status.toString() === '200' })) {
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
    check(response, { 'status equals 200': (response) => response.status.toString() === '200' });

    sleep(1);
  });
}