import { createMiddleware } from 'hono/factory';

import type { AppEnv } from '../env';
import { getSessionUser } from '../lib/sessions';

export const requireSession =
  createMiddleware<AppEnv>(async (c, next) => {
    const user = await getSessionUser(c);

    if (!user) {
      return c.json(
        {
          error: 'unauthorized',
        },
        401,
      );
    }

    c.set('user', user);

    await next();
  });
