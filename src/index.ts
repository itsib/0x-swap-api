import { createApp } from './app';
import { ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT, ETHEREUM_RPC_URL } from './config';
import { logger } from './logger';
import { createWeb3Provider } from './utils';

if (require.main === module) {
  (async () => {
    const provider = createWeb3Provider(ETHEREUM_RPC_URL, ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT);
    await createApp(provider);
  })().catch((err) => logger.error(err.stack));
}

process.on('uncaughtException', (err: Error) => {
  logger.error(err);
  process.exit(1);
});

process.on('unhandledRejection', (err: Error) => {
  if (err) {
    logger.error(err);
  }
});
