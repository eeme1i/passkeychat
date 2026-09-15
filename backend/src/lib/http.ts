import type { Context } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../env';

export async function parseJson<T extends z.ZodType>(
  c: Context<AppEnv>,
  schema: T,
): Promise<z.output<T> | null> {
  const contentType = c.req.header('content-type')?.toLowerCase();

  if (!contentType?.startsWith('application/json')) {
    return null;
  }

  try {
    const result = schema.safeParse(await c.req.json());
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
