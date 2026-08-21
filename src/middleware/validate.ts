// src/middleware/validate.ts
import type { Request, Response, NextFunction } from 'express';
import z, { ZodType } from 'zod';

type Source = 'body' | 'query' | 'params';

/** Validates req[source] against a zod schema, replacing it with the parsed (typed, defaulted) value on success. */
export function validate(schema: ZodType, source: Source = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: z.treeifyError(result.error),
      });
    }

    if (source === 'query') {
      // Express 5 made req.query a getter derived from the parsed URL —
      // a plain `req.query = ...` throws "Cannot set property query of
      // #<IncomingMessage> which has only a getter". Overriding the
      // property descriptor is the documented workaround (the same one
      // Express's own maintainers use for query-mutating middleware).
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    } else {
      // req.body and req.params remain plain writable properties in Express 5.
      req[source] = result.data;
    }

    next();
  };
}