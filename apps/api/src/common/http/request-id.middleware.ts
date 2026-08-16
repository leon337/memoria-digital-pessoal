import { createId } from '@mdp/shared';
import type { NextFunction, Request, Response } from 'express';

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.header('x-request-id');
  req.requestId = supplied && supplied.length <= 128 ? supplied : createId();
  res.setHeader('x-request-id', req.requestId);
  next();
}
