import { createDefaultServer, HttpServiceConfig } from '@0x/api-utils';
import { SupportedProvider } from '@0x/asset-swapper';
import { getContractAddressesForChainOrThrow } from '@0x/contract-addresses';
import express from 'express';
import { Server } from 'http';
import { CHAIN_ID, HEALTH_CHECK_HTTP_PORT, HTTP_HEADERS_TIMEOUT, HTTP_KEEP_ALIVE_TIMEOUT, HTTP_PORT } from './config';
import { HEALTH_CHECK_PATH, METRICS_PATH, SWAP_PATH } from './constants';
import { logger } from './logger';
import { addressNormalizer } from './middleware/address-normalizer';
import { errorHandler } from './middleware/error-handling';
import { createSwapRouter } from './routes/swap-router';
import { SwapService } from './services/swap-service';
import { SwapperOrderbook } from './utils/swapper-orderbook';

export async function createApp(provider: SupportedProvider): Promise<{ app: Express.Application; server: Server }> {
  const app = express();

  const config: HttpServiceConfig = {
    httpPort: HTTP_PORT,
    healthcheckHttpPort: HEALTH_CHECK_HTTP_PORT,
    healthcheckPath: HEALTH_CHECK_PATH,
    httpKeepAliveTimeout: HTTP_KEEP_ALIVE_TIMEOUT,
    httpHeadersTimeout: HTTP_HEADERS_TIMEOUT,
    enablePrometheusMetrics: false,
    prometheusPort: 8080,
    prometheusPath: METRICS_PATH,
  };
  const server = createDefaultServer(config, app, logger, async () => Promise.resolve());

  const contractAddresses = getContractAddressesForChainOrThrow(CHAIN_ID as any);

  const swapService = new SwapService(new SwapperOrderbook(), provider, contractAddresses);

  app.use(addressNormalizer);

  app.use(SWAP_PATH, createSwapRouter(swapService));

  app.use(errorHandler);

  server.listen(config.httpPort);

  return { app, server };
}
