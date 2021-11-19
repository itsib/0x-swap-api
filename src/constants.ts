import { ChainId } from '@0x/contract-addresses';
import { BigNumber } from '@0x/utils';
import { LogLevel } from './types';

export const DEFAULT_LOG_LEVEL = LogLevel.INFO;
export const DEFAULT_LOGGER_INCLUDE_TIMESTAMP = true;
export const DEFAULT_CHAIN_ID = ChainId.Kovan;
export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT = 5000;
export const DEFAULT_HTTP_HEADERS_TIMEOUT = 6000;
export const DEFAULT_ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT = 5000;
export const DEFAULT_ETH_GAS_STATION_API_URL = 'https://ethgasstation.api.0x.org/api/ethgasAPI.json';

export const ONE_WORD_LENGTH = 32;
export const NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
export const NULL_BYTES = '0x';
export const DEFAULT_PAGE = 1;
export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 1000;
export const ZERO = new BigNumber(0);
export const ONE = new BigNumber(1);
export const DEFAULT_VALIDATION_GAS_LIMIT = 10e6;

// Swap Quoter
export const QUOTE_ORDER_EXPIRATION_BUFFER_MS = 60000; // Ignore orders that expire in 60 seconds
export const GAS_LIMIT_BUFFER_MULTIPLIER = 1.2; // Add 20% to the estimated gas limit
export const DEFAULT_QUOTE_SLIPPAGE_PERCENTAGE = 0.01; // 1% Slippage
export const DEFAULT_FALLBACK_SLIPPAGE_PERCENTAGE = 0.015; // 1.5% Slippage in a fallback route
export const PERCENTAGE_SIG_DIGITS = 4;
export const TX_BASE_GAS = new BigNumber(21000);
export const AFFILIATE_FEE_TRANSFORMER_GAS = new BigNumber(15000);
export const POSITIVE_SLIPPAGE_FEE_TRANSFORMER_GAS = new BigNumber(30000);

// API namespaces
export const SWAP_PATH = '/swap/v1';
export const HEALTH_CHECK_PATH = '/healthz';
export const METRICS_PATH = '/metrics';

// Docs
export const SWAP_DOCS_URL = 'https://0x.org/docs/api#swap';

// Market Depth
export const MARKET_DEPTH_MAX_SAMPLES = 50;
export const MARKET_DEPTH_DEFAULT_DISTRIBUTION = 1.05;
export const MARKET_DEPTH_END_PRICE_SLIPPAGE_PERC = 20;
