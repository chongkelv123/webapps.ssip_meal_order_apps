/**
 * Local dev API server — wraps Vercel serverless handlers for use with `npm run dev`.
 * Run with: node dev-server.js
 */
import http from 'http';

import loginHandler from './api/login.js';
import mealsHandler from './api/meals.js';
import ordersHandler from './api/orders.js';
import dashboardHandler from './api/dashboard.js';
import placeOrderHandler from './api/place-order.js';
import cancelOrderHandler from './api/cancel-order.js';

const PORT = 3001;

const routes = {
  '/api/login': loginHandler,
  '/api/meals': mealsHandler,
  '/api/orders': ordersHandler,
  '/api/dashboard': dashboardHandler,
  '/api/place-order': placeOrderHandler,
  '/api/cancel-order': cancelOrderHandler,
};

function makeRes(nodeRes) {
  let statusCode = 200;
  return {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      nodeRes.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      nodeRes.end(JSON.stringify(data));
    },
  };
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
    res.end();
    return;
  }

  const pathname = new URL(req.url, `http://localhost`).pathname;
  const handler = routes[pathname];

  if (!handler) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', async () => {
    try {
      req.body = body ? JSON.parse(body) : {};
    } catch {
      req.body = {};
    }

    try {
      await handler(req, makeRes(res));
    } catch (err) {
      console.error(`[${pathname}]`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, () => {
  console.log(`API dev server running at http://localhost:${PORT}`);
});
