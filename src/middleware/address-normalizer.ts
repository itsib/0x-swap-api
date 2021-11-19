import express from 'express';
import core from 'express-serve-static-core';

import { objectETHAddressNormalizer } from '../utils';

/**
 * Searches for query param values that match the ETH address format, and transforms them to lowercase
 */
export function addressNormalizer(req: express.Request, _: express.Response, next: core.NextFunction): void {
    req.query = objectETHAddressNormalizer(req.query);
    next();
}
