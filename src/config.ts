import { assert } from '@0x/assert';
import {
  BlockParamLiteral,
  DEFAULT_TOKEN_ADJACENCY_GRAPH_BY_CHAIN_ID,
  ERC20BridgeSource,
  LiquidityProviderRegistry,
  OrderPrunerPermittedFeeTypes,
  RfqMakerAssetOfferings,
  SamplerOverrides,
  SOURCE_FLAGS,
  SwapQuoteRequestOpts,
  SwapQuoterOpts,
} from '@0x/asset-swapper';
import { valueByChainId } from '@0x/token-metadata';
import { BigNumber } from '@0x/utils';
import _ from 'lodash';
import validateUUID from 'uuid-validate';
import {
  DEFAULT_CHAIN_ID,
  DEFAULT_ETH_GAS_STATION_API_URL,
  DEFAULT_ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT,
  DEFAULT_FALLBACK_SLIPPAGE_PERCENTAGE,
  DEFAULT_HTTP_HEADERS_TIMEOUT,
  DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT,
  DEFAULT_HTTP_PORT,
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOGGER_INCLUDE_TIMESTAMP,
  DEFAULT_QUOTE_SLIPPAGE_PERCENTAGE,
  NULL_ADDRESS,
  QUOTE_ORDER_EXPIRATION_BUFFER_MS,
  TX_BASE_GAS,
} from './constants';
import { ChainId, LogLevel } from './types';

enum EnvVarType {
  AddressList,
  StringList,
  Integer,
  Port,
  KeepAliveTimeout,
  ChainId,
  ETHAddressHex,
  UnitAmount,
  Url,
  UrlList,
  WhitelistAllTokens,
  Boolean,
  NonEmptyString,
  APIKeys,
  RfqMakerAssetOfferings,
  LiquidityProviderRegistry,
  JsonStringList,
  LogLevel,
}

export const LOG_LEVEL: LogLevel = _.isEmpty(process.env.LOG_LEVEL)
  ? DEFAULT_LOG_LEVEL
  : assertEnvVarType('LOG_LEVEL', process.env.LOG_LEVEL, EnvVarType.LogLevel);

export const LOGGER_INCLUDE_TIMESTAMP = _.isEmpty(process.env.LOGGER_INCLUDE_TIMESTAMP)
  ? DEFAULT_LOGGER_INCLUDE_TIMESTAMP
  : assertEnvVarType('LOGGER_INCLUDE_TIMESTAMP', process.env.LOGGER_INCLUDE_TIMESTAMP, EnvVarType.Boolean);

export const CHAIN_ID: ChainId = _.isEmpty(process.env.CHAIN_ID)
  ? DEFAULT_CHAIN_ID
  : assertEnvVarType('CHAIN_ID', process.env.CHAIN_ID, EnvVarType.ChainId);

export const HTTP_PORT = _.isEmpty(process.env.HTTP_PORT)
  ? DEFAULT_HTTP_PORT
  : assertEnvVarType('HTTP_PORT', process.env.HTTP_PORT, EnvVarType.Port);

export const HEALTH_CHECK_HTTP_PORT = _.isEmpty(process.env.HEALTH_CHECK_HTTP_PORT)
  ? HTTP_PORT
  : assertEnvVarType('HEALTH_CHECK_HTTP_PORT', process.env.HEALTH_CHECK_HTTP_PORT, EnvVarType.Port);

// Number of milliseconds of inactivity the servers waits for additional
// incoming data aftere it finished writing last response before a socket will
// be destroyed.
// Ref: https://nodejs.org/api/http.html#http_server_keepalivetimeout
export const HTTP_KEEP_ALIVE_TIMEOUT = _.isEmpty(process.env.HTTP_KEEP_ALIVE_TIMEOUT)
  ? DEFAULT_HTTP_KEEP_ALIVE_TIMEOUT
  : assertEnvVarType('HTTP_KEEP_ALIVE_TIMEOUT', process.env.HTTP_KEEP_ALIVE_TIMEOUT, EnvVarType.KeepAliveTimeout);

// Limit the amount of time the parser will wait to receive the complete HTTP headers.
// NOTE: This value HAS to be higher than HTTP_KEEP_ALIVE_TIMEOUT.
// Ref: https://nodejs.org/api/http.html#http_server_headerstimeout
export const HTTP_HEADERS_TIMEOUT = _.isEmpty(process.env.HTTP_HEADERS_TIMEOUT)
  ? DEFAULT_HTTP_HEADERS_TIMEOUT
  : assertEnvVarType('HTTP_HEADERS_TIMEOUT', process.env.HTTP_HEADERS_TIMEOUT, EnvVarType.KeepAliveTimeout);

export const ETHEREUM_RPC_URL = assertEnvVarType('ETHEREUM_RPC_URL', process.env.ETHEREUM_RPC_URL, EnvVarType.UrlList);

export const ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT = _.isEmpty(process.env.ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT)
  ? DEFAULT_ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT
  : assertEnvVarType('ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT', process.env.ETHEREUM_RPC_KEEP_ALIVE_TIMEOUT, EnvVarType.KeepAliveTimeout);

// Eth Gas Station URL
export const ETH_GAS_STATION_API_URL: string = _.isEmpty(process.env.ETH_GAS_STATION_API_URL)
  ? DEFAULT_ETH_GAS_STATION_API_URL
  : assertEnvVarType('ETH_GAS_STATION_API_URL', process.env.ETH_GAS_STATION_API_URL, EnvVarType.Url);

// The fee recipient for orders
export const FEE_RECIPIENT_ADDRESS = _.isEmpty(process.env.FEE_RECIPIENT_ADDRESS)
  ? NULL_ADDRESS
  : assertEnvVarType('FEE_RECIPIENT_ADDRESS', process.env.FEE_RECIPIENT_ADDRESS, EnvVarType.ETHAddressHex);

export const LIQUIDITY_PROVIDER_REGISTRY: LiquidityProviderRegistry = _.isEmpty(process.env.LIQUIDITY_PROVIDER_REGISTRY)
  ? {}
  : assertEnvVarType(
    'LIQUIDITY_PROVIDER_REGISTRY',
    process.env.LIQUIDITY_PROVIDER_REGISTRY,
    EnvVarType.LiquidityProviderRegistry,
  );


const UNWRAP_GAS_BY_CHAIN_ID = valueByChainId<BigNumber>(
  {
    // NOTE: FTM uses a different WFTM implementation than WETH which uses more gas
    [ChainId.FANTOM]: new BigNumber(37000),
  },
  new BigNumber(25000),
);
export const UNWRAP_WETH_GAS = UNWRAP_GAS_BY_CHAIN_ID[CHAIN_ID];
export const WRAP_ETH_GAS = UNWRAP_WETH_GAS;
export const UNWRAP_QUOTE_GAS = TX_BASE_GAS.plus(UNWRAP_WETH_GAS);
export const WRAP_QUOTE_GAS = UNWRAP_QUOTE_GAS;

const EXCLUDED_SOURCES = (() => {
  const allERC20BridgeSources = Object.values(ERC20BridgeSource);
  switch (CHAIN_ID) {
    case ChainId.MAINNET:
      return [ERC20BridgeSource.MultiBridge];
    case ChainId.KOVAN:
      return allERC20BridgeSources.filter(
        (s) => s !== ERC20BridgeSource.Native && s !== ERC20BridgeSource.UniswapV2,
      );
    case ChainId.ROPSTEN:
      const supportedRopstenSources = new Set([
        ERC20BridgeSource.Kyber,
        ERC20BridgeSource.Native,
        ERC20BridgeSource.SushiSwap,
        ERC20BridgeSource.Uniswap,
        ERC20BridgeSource.UniswapV2,
        ERC20BridgeSource.UniswapV3,
        ERC20BridgeSource.Curve,
        ERC20BridgeSource.Mooniswap,
      ]);
      return allERC20BridgeSources.filter((s) => !supportedRopstenSources.has(s));
    case ChainId.BSC:
      return [ERC20BridgeSource.MultiBridge, ERC20BridgeSource.Native];
    case ChainId.MATIC:
      return [ERC20BridgeSource.MultiBridge, ERC20BridgeSource.Native];
    case ChainId.AVALANCHE:
      return [ERC20BridgeSource.MultiBridge, ERC20BridgeSource.Native];
    case ChainId.FANTOM:
      return [ERC20BridgeSource.MultiBridge, ERC20BridgeSource.Native];
    default:
      return allERC20BridgeSources.filter((s) => s !== ERC20BridgeSource.Native);
  }
})();

const EXCLUDED_FEE_SOURCES = (() => {
  switch (CHAIN_ID) {
    case ChainId.MAINNET:
      return [];
    case ChainId.KOVAN:
      return [ERC20BridgeSource.Uniswap];
    case ChainId.ROPSTEN:
      return [];
    case ChainId.BSC:
      return [ERC20BridgeSource.Uniswap];
    case ChainId.MATIC:
      return [];
    default:
      return [ERC20BridgeSource.Uniswap, ERC20BridgeSource.UniswapV2];
  }
})();
const FILL_QUOTE_TRANSFORMER_GAS_OVERHEAD = new BigNumber(150e3);
const EXCHANGE_PROXY_OVERHEAD_NO_VIP = () => FILL_QUOTE_TRANSFORMER_GAS_OVERHEAD;
const MULTIPLEX_BATCH_FILL_SOURCE_FLAGS =
  SOURCE_FLAGS.Uniswap_V2 |
  SOURCE_FLAGS.SushiSwap |
  SOURCE_FLAGS.LiquidityProvider |
  SOURCE_FLAGS.RfqOrder |
  SOURCE_FLAGS.Uniswap_V3;
const MULTIPLEX_MULTIHOP_FILL_SOURCE_FLAGS =
  SOURCE_FLAGS.Uniswap_V2 | SOURCE_FLAGS.SushiSwap | SOURCE_FLAGS.LiquidityProvider | SOURCE_FLAGS.Uniswap_V3;
const EXCHANGE_PROXY_OVERHEAD_FULLY_FEATURED = (sourceFlags: bigint) => {
  if ([SOURCE_FLAGS.Uniswap_V2, SOURCE_FLAGS.SushiSwap].includes(sourceFlags)) {
    // Uniswap and forks VIP
    return TX_BASE_GAS;
  } else if (
    [
      SOURCE_FLAGS.SushiSwap,
      SOURCE_FLAGS.PancakeSwap,
      SOURCE_FLAGS.PancakeSwap_V2,
      SOURCE_FLAGS.BakerySwap,
      SOURCE_FLAGS.ApeSwap,
      SOURCE_FLAGS.CafeSwap,
      SOURCE_FLAGS.CheeseSwap,
      SOURCE_FLAGS.JulSwap,
    ].includes(sourceFlags) &&
    CHAIN_ID === ChainId.BSC
  ) {
    // PancakeSwap and forks VIP
    return TX_BASE_GAS;
  } else if (SOURCE_FLAGS.Uniswap_V3 === sourceFlags) {
    // Uniswap V3 VIP
    return TX_BASE_GAS.plus(5e3);
  } else if (SOURCE_FLAGS.Curve === sourceFlags) {
    // Curve pseudo-VIP
    return TX_BASE_GAS.plus(40e3);
  } else if (SOURCE_FLAGS.LiquidityProvider === sourceFlags) {
    // PLP VIP
    return TX_BASE_GAS.plus(10e3);
  } else if ((MULTIPLEX_BATCH_FILL_SOURCE_FLAGS | sourceFlags) === MULTIPLEX_BATCH_FILL_SOURCE_FLAGS) {
    // Multiplex batch fill
    return TX_BASE_GAS.plus(15e3);
  } else if (
    (MULTIPLEX_MULTIHOP_FILL_SOURCE_FLAGS | sourceFlags) ===
    (MULTIPLEX_MULTIHOP_FILL_SOURCE_FLAGS | SOURCE_FLAGS.MultiHop)
  ) {
    // Multiplex multi-hop fill
    return TX_BASE_GAS.plus(25e3);
  } else {
    return FILL_QUOTE_TRANSFORMER_GAS_OVERHEAD;
  }
};

export const NATIVE_WRAPPED_TOKEN_SYMBOL = nativeWrappedTokenSymbol(CHAIN_ID);

export const EXCHANGE_PROXY_ADDRESS: string | null = _.isEmpty(process.env.EXCHANGE_PROXY_ADDRESS)
  ? null
  : assertEnvVarType('EXCHANGE_PROXY_ADDRESS', process.env.EXCHANGE_PROXY_ADDRESS, EnvVarType.ETHAddressHex);

export const ASSET_SWAPPER_MARKET_ORDERS_OPTS: Partial<SwapQuoteRequestOpts> = {
  excludedSources: EXCLUDED_SOURCES,
  excludedFeeSources: EXCLUDED_FEE_SOURCES,
  bridgeSlippage: DEFAULT_QUOTE_SLIPPAGE_PERCENTAGE,
  maxFallbackSlippage: DEFAULT_FALLBACK_SLIPPAGE_PERCENTAGE,
  numSamples: 5,
  sampleDistributionBase: 1.25,
  exchangeProxyOverhead: EXCHANGE_PROXY_OVERHEAD_FULLY_FEATURED,
  runLimit: 2 ** 8,
  shouldGenerateQuoteReport: true,
};

export const ASSET_SWAPPER_MARKET_ORDERS_OPTS_NO_VIP: Partial<SwapQuoteRequestOpts> = {
  ...ASSET_SWAPPER_MARKET_ORDERS_OPTS,
  exchangeProxyOverhead: EXCHANGE_PROXY_OVERHEAD_NO_VIP,
};

export const SAMPLER_OVERRIDES: SamplerOverrides | undefined = (() => {
  let samplerOverrides: SamplerOverrides | undefined;
  switch (CHAIN_ID) {
    case ChainId.GANACHE:
    case ChainId.KOVAN:
      samplerOverrides = { overrides: {}, block: BlockParamLiteral.Latest };
      break;
    default:
      // samplerOverrides = {
      //     to: QUOTER_BRIDGE_SAMPLER_CONTRACT_ADDRESS,
      //     block: BlockParamLiteral.Latest,
      //     overrides: {
      //         [QUOTER_BRIDGE_SAMPLER_CONTRACT_ADDRESS]: {
      //             code: _.get(artifacts.ERC20BridgeSampler, 'compilerOutput.evm.deployedBytecode.object'),
      //             balance: new BigNumber('100000000000000000000000'),
      //         }
      //     },
      // };
      break;
  }
  return samplerOverrides;
})();

export const SWAP_QUOTER_OPTS: Partial<SwapQuoterOpts> = {
  chainId: CHAIN_ID as any,
  expiryBufferMs: QUOTE_ORDER_EXPIRATION_BUFFER_MS,
  ethGasStationUrl: ETH_GAS_STATION_API_URL,
  permittedOrderFeeTypes: new Set([OrderPrunerPermittedFeeTypes.NoFees]),
  samplerOverrides: SAMPLER_OVERRIDES,
  tokenAdjacencyGraph: DEFAULT_TOKEN_ADJACENCY_GRAPH_BY_CHAIN_ID[CHAIN_ID],
  liquidityProviderRegistry: LIQUIDITY_PROVIDER_REGISTRY,
};

function assertEnvVarType(name: string, value: any, expectedType: EnvVarType): any {
  let returnValue;
  switch (expectedType) {
    case EnvVarType.Port:
      returnValue = parseInt(value, 10);
      const isWithinRange = returnValue >= 0 && returnValue <= 65535;
      if (isNaN(returnValue) || !isWithinRange) {
        throw new Error(`${name} must be between 0 to 65535, found ${value}.`);
      }
      return returnValue;
    case EnvVarType.ChainId:
      returnValue = parseInt(value, 10);
      if (isNaN(returnValue)) {
        throw new Error(`${name} must be a valid integer, found ${value}.`);
      }
      const supportedChainIds = Object.values(ChainId).filter(i => typeof i === 'number') as ChainId[];
      if (!supportedChainIds.includes(returnValue)) {
        throw new Error(`${name} must be a supported chain id ${supportedChainIds.join(', ')}, found ${value}.`);
      }
      return returnValue;
    case EnvVarType.KeepAliveTimeout:
    case EnvVarType.Integer:
      returnValue = parseInt(value, 10);
      if (isNaN(returnValue)) {
        throw new Error(`${name} must be a valid integer, found ${value}.`);
      }
      return returnValue;
    case EnvVarType.ETHAddressHex:
      assert.isETHAddressHex(name, value);
      return value;
    case EnvVarType.Url:
      assert.isUri(name, value);
      return value;
    case EnvVarType.UrlList:
      assert.isString(name, value);
      const urlList = (value as string).split(',');
      urlList.forEach((url, i) => assert.isUri(`${name}[${i}]`, url));
      return urlList;
    case EnvVarType.Boolean:
      return value === 'true';
    case EnvVarType.UnitAmount:
      returnValue = new BigNumber(parseFloat(value));
      if (returnValue.isNaN() || returnValue.isNegative()) {
        throw new Error(`${name} must be valid number greater than 0.`);
      }
      return returnValue;
    case EnvVarType.AddressList:
      assert.isString(name, value);
      const addressList = (value as string).split(',').map((a) => a.toLowerCase());
      addressList.forEach((a, i) => assert.isETHAddressHex(`${name}[${i}]`, a));
      return addressList;
    case EnvVarType.StringList:
      assert.isString(name, value);
      const stringList = (value as string).split(',');
      return stringList;
    case EnvVarType.WhitelistAllTokens:
      return '*';
    case EnvVarType.NonEmptyString:
      assert.isString(name, value);
      if (value === '') {
        throw new Error(`${name} must be supplied`);
      }
      return value;
    case EnvVarType.APIKeys:
      assert.isString(name, value);
      const apiKeys = (value as string).split(',');
      apiKeys.forEach((apiKey) => {
        const isValidUUID = validateUUID(apiKey);
        if (!isValidUUID) {
          throw new Error(`API Key ${apiKey} isn't UUID compliant`);
        }
      });
      return apiKeys;
    case EnvVarType.JsonStringList:
      assert.isString(name, value);
      return JSON.parse(value);
    case EnvVarType.RfqMakerAssetOfferings:
      const offerings: RfqMakerAssetOfferings = JSON.parse(value);
      // tslint:disable-next-line:forin
      for (const makerEndpoint in offerings) {
        assert.isWebUri('market maker endpoint', makerEndpoint);

        const assetOffering = offerings[makerEndpoint];
        assert.isArray(`value in maker endpoint mapping, for index ${makerEndpoint},`, assetOffering);
        assetOffering.forEach((assetPair, i) => {
          assert.isArray(`asset pair array ${i} for maker endpoint ${makerEndpoint}`, assetPair);
          assert.assert(
            assetPair.length === 2,
            `asset pair array ${i} for maker endpoint ${makerEndpoint} does not consist of exactly two elements.`,
          );
          assert.isETHAddressHex(
            `first token address for asset pair ${i} for maker endpoint ${makerEndpoint}`,
            assetPair[0],
          );
          assert.isETHAddressHex(
            `second token address for asset pair ${i} for maker endpoint ${makerEndpoint}`,
            assetPair[1],
          );
          assert.assert(
            assetPair[0] !== assetPair[1],
            `asset pair array ${i} for maker endpoint ${makerEndpoint} has identical assets`,
          );
        });
      }
      return offerings;
    case EnvVarType.LiquidityProviderRegistry:
      const registry: LiquidityProviderRegistry = JSON.parse(value);
      // tslint:disable-next-line:forin
      for (const liquidityProvider in registry) {
        assert.isETHAddressHex('liquidity provider address', liquidityProvider);

        const { tokens } = registry[liquidityProvider];
        assert.isArray(`token list for liquidity provider ${liquidityProvider}`, tokens);
        tokens.forEach((token, i) => {
          assert.isETHAddressHex(`address of token ${i} for liquidity provider ${liquidityProvider}`, token);
        });
        // TODO jacob validate gas cost callback in registry
        // assert.isNumber(`gas cost for liquidity provider ${liquidityProvider}`, gasCost);
      }
      return registry;
    case EnvVarType.LogLevel:
      const supportedLogLevels = Object.values(LogLevel).filter(i => typeof i === 'string');
      const logLevelIndex = supportedLogLevels.indexOf(value.toUpperCase());
      if (logLevelIndex === -1) {
        throw new Error(`Unsupported log level - ${value}. Supported log levels ${supportedLogLevels.join(', ')}`);
      }
      return logLevelIndex;

    default:
      throw new Error(`Unrecognised EnvVarType: ${expectedType} encountered for variable ${name}.`);
  }
}

function nativeWrappedTokenSymbol(chainId: ChainId): string {
  switch (chainId) {
    case ChainId.BSC:
      return 'WBNB';
    case ChainId.MATIC:
      return 'WMATIC';
    case ChainId.AVALANCHE:
      return 'WAVAX';
    case ChainId.FANTOM:
      return 'WFTM';
    case ChainId.CELO:
      return 'CELO';
    default:
      return 'WETH';
  }
}
