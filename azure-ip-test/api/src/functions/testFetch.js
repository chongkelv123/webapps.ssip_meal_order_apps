import { app } from '@azure/functions';

const BASE_URL = 'https://ssip-cafeteria.whew.life';
const USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

app.http('testFetch', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'testFetch',
  handler: async (request, context) => {
    try {
      const res = await fetch(`${BASE_URL}/my-account/`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      const text = await res.text();
      const blocked = text.includes('Your access to this site has been limited');

      context.log('[testFetch] status:', res.status, 'blocked:', blocked);

      return {
        jsonBody: {
          status: res.status,
          url: res.url,
          length: text.length,
          blocked,
          snippet: text.slice(0, 500),
        },
      };
    } catch (err) {
      context.error('[testFetch] error:', err);
      return { status: 500, jsonBody: { error: err.message } };
    }
  },
});
