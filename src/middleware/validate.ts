import type { Request, Response, NextFunction } from 'express';
import z, { ZodType } from 'zod';




type Source = 'body' | 'query' | 'params';

export function validate(schema: ZodType, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: z.treeifyError(result.error),
      });
    }
    req[source] = result.data;
    next();
  };
}