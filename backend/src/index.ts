import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';

import type { AppEnv } from './env';

import auth from './routes/auth';
import chat from './routes/chat';

const app = new Hono<AppEnv>();

app.use('*', secureHeaders({
  crossOriginResourcePolicy: 'same-site',
  referrerPolicy: 'no-referrer',
  strictTransportSecurity: 'max-age=31536000; includeSubDomains',
}));

app.use('/api/*', bodyLimit({
  maxSize: 64 * 1024,
  onError: (c) => c.json({ error: 'request_too_large' }, 413),
}));

app.use('/api/*', async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');

    if (origin && origin !== c.env.APP_ORIGIN) {
      return c.json({ error: 'invalid_origin' }, 403);
    }
  }

  await next();
});

app.get('/health', (c) => {
  return c.json({
    ok: true,
  });
});

app.get('/ready', async (c) => {
  await c.env.DB.prepare('SELECT 1').first();
  return c.json({ ok: true });
});

app.route('/api/auth', auth);
app.route('/api/chat', chat);

app.notFound((c) => {
  return c.json(
    {
      error: 'not_found',
    },
    404,
  );
});

app.onError((error, c) => {
  console.error(error);

  return c.json(
    {
      error: 'internal_error',
    },
    500,
  );
});

export default app;
