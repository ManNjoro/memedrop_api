import type { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';




type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodType, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    req[source] = result.data;
    next();
  };
}