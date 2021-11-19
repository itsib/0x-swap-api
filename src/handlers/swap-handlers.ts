import { isAPIError, isRevertError } from '@0x/api-utils';
import {
  ERC20BridgeSource,
  NATIVE_FEE_TOKEN_BY_CHAIN_ID,
  SELL_SOURCE_FILTER_BY_CHAIN_ID,
  SwapQuoterError,
} from '@0x/asset-swapper';
import {
  findTokenAddressOrThrow,
  isNativeSymbolOrAddress,
  isNativeWrappedSymbolOrAddress,
  TokenMetadatasForChains,
} from '@0x/token-metadata';
import { MarketOperation } from '@0x/types';
import { BigNumber, NULL_ADDRESS } from '@0x/utils';
import * as express from 'express';
import { StatusCodes } from 'http-status-codes';
import _ from 'lodash';
import { CHAIN_ID, NATIVE_WRAPPED_TOKEN_SYMBOL } from '../config';
import {
  DEFAULT_QUOTE_SLIPPAGE_PERCENTAGE,
  MARKET_DEPTH_DEFAULT_DISTRIBUTION,
  MARKET_DEPTH_MAX_SAMPLES,
  SWAP_DOCS_URL,
} from '../constants';
import {
  InternalServerError,
  RevertAPIError,
  ValidationError,
  ValidationErrorCodes,
  ValidationErrorReasons,
} from '../errors';
import { schemas } from '../schemas';
import { SwapService } from '../services/swap-service';
import { GetSwapQuoteParams, GetSwapQuoteResponse, PriceResponse } from '../types';
import {
  findTokenAddressOrThrowApiError,
  getPriceComparisonFromQuote,
  parseAffiliateFeeOptions,
  parseRequestForExcludedSources,
  parseStringArrForERC20BridgeSources,
  renameNative,
  validateSchema,
} from '../utils';

export class SwapHandlers {
  private readonly _swapService: SwapService;

  public static root(_req: express.Request, res: express.Response): void {
    const message = `This is the root of the Swap API. Visit ${SWAP_DOCS_URL} for details about this API.`;
    res.status(StatusCodes.OK).send({ message });
  }

  public static getTokens(_req: express.Request, res: express.Response): void {
    const tokens = TokenMetadatasForChains.map((tm) => ({
      symbol: tm.symbol,
      address: tm.tokenAddresses[CHAIN_ID],
      name: tm.name,
      decimals: tm.decimals,
    }));
    const filteredTokens = tokens.filter((t) => t.address !== NULL_ADDRESS);
    res.status(StatusCodes.OK).send({ records: filteredTokens });
  }

  public static getLiquiditySources(_req: express.Request, res: express.Response): void {
    const sources = SELL_SOURCE_FILTER_BY_CHAIN_ID[CHAIN_ID].sources
      .map((s) => (s === ERC20BridgeSource.Native ? '0x' : s))
      .sort((a, b) => a.localeCompare(b));
    res.status(StatusCodes.OK).send({ records: sources });
  }

  constructor(swapService: SwapService) {
    this._swapService = swapService;
  }

  public async getQuoteAsync(req: express.Request, res: express.Response): Promise<void> {
    const params = parseSwapQuoteRequestParams(req, 'quote');
    const quote = await this._getSwapQuoteAsync(params, req);
    const response = _.omit(
      {
        ...quote,
        orders: quote.orders.map((o: any) => _.omit(o, 'fills')),
      },
      'quoteReport',
      'priceComparisonsReport',
    );
    if (params.includePriceComparisons && quote.priceComparisonsReport) {
      const side = params.sellAmount ? MarketOperation.Sell : MarketOperation.Buy;
      const priceComparisons = getPriceComparisonFromQuote(CHAIN_ID, side, quote);
      response.priceComparisons = priceComparisons?.map((sc) => renameNative(sc));
    }
    res.status(StatusCodes.OK).send(response);
  }

  public async getQuotePriceAsync(req: express.Request, res: express.Response): Promise<void> {
    const params = parseSwapQuoteRequestParams(req, 'price');
    const quote = await this._getSwapQuoteAsync({ ...params, skipValidation: true }, req);
    req.log.info({
      indicativeQuoteServed: {
        taker: params.takerAddress,
        rawApiKey: params.apiKey,
        buyToken: params.buyToken,
        sellToken: params.sellToken,
        buyAmount: params.buyAmount,
        sellAmount: params.sellAmount,
      },
    });

    const response: PriceResponse = _.pick(
      quote,
      'chainId',
      'price',
      'value',
      'gasPrice',
      'gas',
      'estimatedGas',
      'protocolFee',
      'minimumProtocolFee',
      'buyTokenAddress',
      'buyAmount',
      'sellTokenAddress',
      'sellAmount',
      'sources',
      'allowanceTarget',
      'sellTokenToEthRate',
      'buyTokenToEthRate',
    );

    if (params.includePriceComparisons && quote.priceComparisonsReport) {
      const marketSide = params.sellAmount ? MarketOperation.Sell : MarketOperation.Buy;
      response.priceComparisons = getPriceComparisonFromQuote(CHAIN_ID, marketSide, quote)
        ?.map((sc) => renameNative(sc));
    }
    res.status(StatusCodes.OK).send(response);
  }

  public async getMarketDepthAsync(req: express.Request, res: express.Response): Promise<void> {
    // NOTE: Internally all ETH trades are for WETH, we just wrap/unwrap automatically
    const buyTokenSymbolOrAddress = isNativeSymbolOrAddress(req.query.buyToken as string, CHAIN_ID)
      ? NATIVE_WRAPPED_TOKEN_SYMBOL
      : (req.query.buyToken as string);
    const sellTokenSymbolOrAddress = isNativeSymbolOrAddress(req.query.sellToken as string, CHAIN_ID)
      ? NATIVE_WRAPPED_TOKEN_SYMBOL
      : (req.query.sellToken as string);

    if (buyTokenSymbolOrAddress === sellTokenSymbolOrAddress) {
      throw new ValidationError([
        {
          field: 'buyToken',
          code: ValidationErrorCodes.InvalidAddress,
          reason: `Invalid pair ${sellTokenSymbolOrAddress}/${buyTokenSymbolOrAddress}`,
        },
      ]);
    }
    const response = await this._swapService.calculateMarketDepthAsync({
      buyToken: findTokenAddressOrThrow(buyTokenSymbolOrAddress, CHAIN_ID),
      sellToken: findTokenAddressOrThrow(sellTokenSymbolOrAddress, CHAIN_ID),
      sellAmount: new BigNumber(req.query.sellAmount as string),
      // tslint:disable-next-line:radix custom-no-magic-numbers
      numSamples: req.query.numSamples ? parseInt(req.query.numSamples as string) : MARKET_DEPTH_MAX_SAMPLES,
      sampleDistributionBase: req.query.sampleDistributionBase
        ? parseFloat(req.query.sampleDistributionBase as string)
        : MARKET_DEPTH_DEFAULT_DISTRIBUTION,
      excludedSources:
        req.query.excludedSources === undefined
          ? []
          : parseStringArrForERC20BridgeSources((req.query.excludedSources as string).split(',')),
      includedSources:
        req.query.includedSources === undefined
          ? []
          : parseStringArrForERC20BridgeSources((req.query.includedSources as string).split(',')),
    });
    res.status(StatusCodes.OK).send(response);
  }

  private async _getSwapQuoteAsync(params: GetSwapQuoteParams, req: express.Request): Promise<GetSwapQuoteResponse> {
    try {
      let swapQuote: GetSwapQuoteResponse;
      if (params.isUnwrap) {
        swapQuote = await this._swapService.getSwapQuoteForUnwrapAsync(params);
      } else if (params.isWrap) {
        swapQuote = await this._swapService.getSwapQuoteForWrapAsync(params);
      } else {
        swapQuote = await this._swapService.calculateSwapQuoteAsync(params);
      }
      return swapQuote;
    } catch (e) {
      // If this is already a transformed error then just re-throw
      if (isAPIError(e)) {
        throw e;
      }
      // Wrap a Revert error as an API revert error
      if (isRevertError(e)) {
        throw new RevertAPIError(e);
      }
      const errorMessage: string = e.message;
      // TODO AssetSwapper can throw raw Errors or InsufficientAssetLiquidityError
      if (
        errorMessage.startsWith(SwapQuoterError.InsufficientAssetLiquidity) ||
        errorMessage.startsWith('NO_OPTIMAL_PATH')
      ) {
        throw new ValidationError([
          {
            field: params.sellAmount ? 'sellAmount' : 'buyAmount',
            code: ValidationErrorCodes.ValueOutOfRange,
            reason: SwapQuoterError.InsufficientAssetLiquidity,
          },
        ]);
      }
      if (errorMessage.startsWith(SwapQuoterError.AssetUnavailable)) {
        throw new ValidationError([
          {
            field: 'token',
            code: ValidationErrorCodes.ValueOutOfRange,
            reason: e.message,
          },
        ]);
      }
      req.log.info('Uncaught error', e.message, e.stack);
      throw new InternalServerError(e.message);
    }
  }
}

function parseSwapQuoteRequestParams(req: express.Request, endpoint: 'price' | 'quote'): GetSwapQuoteParams {
  // HACK typescript typing does not allow this valid json-schema
  validateSchema(req.query, schemas.swapQuoteRequestSchema as any);

  // Parse string params
  const { takerAddress, affiliateAddress } = req.query;

  // Parse boolean params and defaults
  const skipValidation = req.query.skipValidation === undefined ? false : req.query.skipValidation === 'true';
  const includePriceComparisons = req.query.includePriceComparisons === 'true';
  // Whether the entire callers balance should be sold, used for contracts where the
  // amount available is non-deterministic
  const shouldSellEntireBalance = req.query.shouldSellEntireBalance === 'true';

  // Parse tokens and eth wrap/unwraps
  const sellTokenRaw = req.query.sellToken as string;
  const buyTokenRaw = req.query.buyToken as string;
  const isNativeSell = isNativeSymbolOrAddress(sellTokenRaw, CHAIN_ID);
  const isNativeBuy = isNativeSymbolOrAddress(buyTokenRaw, CHAIN_ID);
  // NOTE: Internally all Native token (like ETH) trades are for their wrapped equivalent (ie WETH), we just wrap/unwrap automatically
  const sellToken = findTokenAddressOrThrowApiError(
    isNativeSell ? NATIVE_FEE_TOKEN_BY_CHAIN_ID[CHAIN_ID] : sellTokenRaw,
    'sellToken',
    CHAIN_ID,
  ).toLowerCase();
  const buyToken = findTokenAddressOrThrowApiError(
    isNativeBuy ? NATIVE_FEE_TOKEN_BY_CHAIN_ID[CHAIN_ID] : buyTokenRaw,
    'buyToken',
    CHAIN_ID,
  ).toLowerCase();
  const isWrap = isNativeSell && isNativeWrappedSymbolOrAddress(buyToken, CHAIN_ID);
  const isUnwrap = isNativeWrappedSymbolOrAddress(sellToken, CHAIN_ID) && isNativeBuy;
  // if token addresses are the same but a unwrap or wrap operation is requested, ignore error
  if (!isUnwrap && !isWrap && sellToken === buyToken) {
    throw new ValidationError(
      ['buyToken', 'sellToken'].map((field) => {
        return {
          field,
          code: ValidationErrorCodes.RequiredField,
          reason: 'buyToken and sellToken must be different',
        };
      }),
    );
  }

  if (sellToken === NULL_ADDRESS || buyToken === NULL_ADDRESS) {
    throw new ValidationError(
      ['buyToken', 'sellToken'].map((field) => {
        return {
          field,
          code: ValidationErrorCodes.FieldInvalid,
          reason: 'Invalid token combination',
        };
      }),
    );
  }

  // Parse number params
  const sellAmount = req.query.sellAmount === undefined ? undefined : new BigNumber(req.query.sellAmount as string);
  const buyAmount = req.query.buyAmount === undefined ? undefined : new BigNumber(req.query.buyAmount as string);
  const gasPrice = req.query.gasPrice === undefined ? undefined : new BigNumber(req.query.gasPrice as string);
  const slippagePercentage =
    req.query.slippagePercentage === undefined
      ? DEFAULT_QUOTE_SLIPPAGE_PERCENTAGE
      : Number.parseFloat(req.query.slippagePercentage as string);
  if (slippagePercentage > 1) {
    throw new ValidationError([
      {
        field: 'slippagePercentage',
        code: ValidationErrorCodes.ValueOutOfRange,
        reason: ValidationErrorReasons.PercentageOutOfRange,
      },
    ]);
  }

  // Parse sources
  const { excludedSources, includedSources, nativeExclusivelyRFQT } = parseRequestForExcludedSources(
    {
      excludedSources: req.query.excludedSources as string | undefined,
      includedSources: req.query.includedSources as string | undefined,
      intentOnFilling: req.query.intentOnFilling as string | undefined,
      takerAddress: takerAddress as string,
    },
    endpoint,
  );

  const isAllExcluded = Object.values(ERC20BridgeSource).every((s) => excludedSources.includes(s));
  if (isAllExcluded) {
    throw new ValidationError([
      {
        field: 'excludedSources',
        code: ValidationErrorCodes.ValueOutOfRange,
        reason: 'Request excluded all sources',
      },
    ]);
  }

  // Log the request if it passes all validations
  req.log.info({
    type: 'swapRequest',
    endpoint,
    excludedSources,
    nativeExclusivelyRFQT,
  });

  const affiliateFee = parseAffiliateFeeOptions(req);

  return {
    takerAddress: takerAddress as string,
    sellToken,
    buyToken,
    sellAmount,
    buyAmount,
    slippagePercentage,
    gasPrice,
    excludedSources,
    includedSources,
    affiliateAddress: affiliateAddress as string,
    skipValidation,
    affiliateFee,
    includePriceComparisons,
    shouldSellEntireBalance,
    isMetaTransaction: false,
    isETHSell: isNativeSell,
    isETHBuy: isNativeBuy,
    isUnwrap,
    isWrap,
  };
}
