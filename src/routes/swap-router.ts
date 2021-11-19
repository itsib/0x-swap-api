import express from 'express';
import asyncHandler from 'express-async-handler';
import { SwapHandlers } from '../handlers/swap-handlers';
import { SwapService } from '../services/swap-service';

export function createSwapRouter(swapService: SwapService): express.Router {
  const router = express.Router();
  const handlers = new SwapHandlers(swapService);
  router.get('', asyncHandler(SwapHandlers.root.bind(SwapHandlers)));
  router.get('/tokens', asyncHandler(SwapHandlers.getTokens.bind(handlers)));
  router.get('/quote', asyncHandler(handlers.getQuoteAsync.bind(handlers)));
  router.get('/price', asyncHandler(handlers.getQuotePriceAsync.bind(handlers)));
  router.get('/depth', asyncHandler(handlers.getMarketDepthAsync.bind(handlers)));
  router.get('/sources', asyncHandler(SwapHandlers.getLiquiditySources.bind(handlers)));
  return router;
}
