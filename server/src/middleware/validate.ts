import type { Request, Response, NextFunction } from 'express';
import type { ZodType, ZodError } from 'zod';
import { fail } from '../lib/response.js';

type Source = 'body' | 'query' | 'params';

function formatZodError(err: ZodError): { path: string; message: string }[] {
  return err.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function validate<T>(schema: ZodType<T>, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const input = req[source];
    const result = schema.safeParse(input);
    if (!result.success) {
      res.status(400).json(fail('VALIDATION_ERROR', 'Invalid request', formatZodError(result.error)));
      return;
    }
    // Replace the source with parsed+coerced data so handlers get typed values.
    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
}
