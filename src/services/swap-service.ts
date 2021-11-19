import {
  AffiliateFeeAmount,
  AffiliateFeeType,
  artifacts,
  AssetSwapperContractAddresses,
  BlockParamLiteral,
  ContractAddresses,
  ERC20BridgeSource,
  FakeTakerContract,
  NATIVE_FEE_TOKEN_BY_CHAIN_ID,
  Orderbook,
  SwapQuote,
  SwapQuoteConsumer,
  SwapQuoteGetOutputOpts,
  SwapQuoter,
  SwapQuoteRequestOpts,
  SwapQuoterOpts,
} from '@0x/asset-swapper';
import { ChainId } from '@0x/contract-addresses';
import { WETH9Contract } from '@0x/contract-wrappers';
import { ETH_TOKEN_ADDRESS, RevertError } from '@0x/protocol-utils';
import { getTokenMetadataIfExists } from '@0x/token-metadata';
import { MarketOperation } from '@0x/types';
import { BigNumber, decodeThrownErrorAsRevertError } from '@0x/utils';
import { TxData, Web3Wrapper } from '@0x/web3-wrapper';
import { SupportedProvider } from 'ethereum-types';
import _ from 'lodash';
import {
  ASSET_SWAPPER_MARKET_ORDERS_OPTS,
  ASSET_SWAPPER_MARKET_ORDERS_OPTS_NO_VIP,
  CHAIN_ID,
  SWAP_QUOTER_OPTS,
  UNWRAP_QUOTE_GAS,
  UNWRAP_WETH_GAS,
  WRAP_ETH_GAS,
  WRAP_QUOTE_GAS,
} from '../config';
import {
  DEFAULT_VALIDATION_GAS_LIMIT,
  GAS_LIMIT_BUFFER_MULTIPLIER,
  NULL_ADDRESS,
  NULL_BYTES,
  ONE,
  ZERO,
} from '../constants';
import { GasEstimationError, InsufficientFundsError } from '../errors';
import { logger } from '../logger';
import {
  AffiliateFee,
  BucketedPriceDepth,
  CalculateMarketDepthParams,
  GetSwapQuoteParams,
  GetSwapQuoteResponse,
  TokenMetadataOptionalSymbol,
} from '../types';
import {
  attributeCallData,
  calculateCallDataGas,
  calculateDepthForSide,
  convertSourceBreakdownToArray,
  fixCallData,
  getAffiliateFeeAmounts,
} from '../utils';

export class SwapService {
  private readonly _provider: SupportedProvider;
  private readonly _fakeTaker: FakeTakerContract;
  private readonly _swapQuoter: SwapQuoter;
  private readonly _swapQuoteConsumer: SwapQuoteConsumer;
  private readonly _web3Wrapper: Web3Wrapper;
  private readonly _wethContract: WETH9Contract;
  private readonly _contractAddresses: ContractAddresses;

  private static _getSwapQuotePrice(
    buyAmount: BigNumber | undefined,
    buyTokenDecimals: number,
    sellTokenDecimals: number,
    swapQuote: SwapQuote,
    affiliateFee: AffiliateFee,
  ): { price: BigNumber; guaranteedPrice: BigNumber } {
    const { makerAmount, totalTakerAmount } = swapQuote.bestCaseQuoteInfo;
    const { totalTakerAmount: guaranteedTotalTakerAmount, makerAmount: guaranteedMakerAmount } =
      swapQuote.worstCaseQuoteInfo;
    const unitMakerAmount = Web3Wrapper.toUnitAmount(makerAmount, buyTokenDecimals);
    const unitTakerAmount = Web3Wrapper.toUnitAmount(totalTakerAmount, sellTokenDecimals);
    const guaranteedUnitMakerAmount = Web3Wrapper.toUnitAmount(guaranteedMakerAmount, buyTokenDecimals);
    const guaranteedUnitTakerAmount = Web3Wrapper.toUnitAmount(guaranteedTotalTakerAmount, sellTokenDecimals);
    const affiliateFeeUnitMakerAmount = guaranteedUnitMakerAmount.times(affiliateFee.buyTokenPercentageFee);

    const isSelling = buyAmount === undefined;
    // NOTE: In order to not communicate a price better than the actual quote we
    // should make sure to always round towards a worse price
    const roundingStrategy = isSelling ? BigNumber.ROUND_FLOOR : BigNumber.ROUND_CEIL;
    // Best price
    const price = isSelling
      ? unitMakerAmount
        .minus(affiliateFeeUnitMakerAmount)
        .dividedBy(unitTakerAmount)
        .decimalPlaces(buyTokenDecimals, roundingStrategy)
      : unitTakerAmount
        .dividedBy(unitMakerAmount.minus(affiliateFeeUnitMakerAmount))
        .decimalPlaces(sellTokenDecimals, roundingStrategy);
    // Guaranteed price before revert occurs
    const guaranteedPrice = isSelling
      ? guaranteedUnitMakerAmount
        .minus(affiliateFeeUnitMakerAmount)
        .dividedBy(guaranteedUnitTakerAmount)
        .decimalPlaces(buyTokenDecimals, roundingStrategy)
      : guaranteedUnitTakerAmount
        .dividedBy(guaranteedUnitMakerAmount.minus(affiliateFeeUnitMakerAmount))
        .decimalPlaces(sellTokenDecimals, roundingStrategy);
    return {
      price,
      guaranteedPrice,
    };
  }

  constructor(
    orderbook: Orderbook,
    provider: SupportedProvider,
    contractAddresses: AssetSwapperContractAddresses,
  ) {
    this._provider = provider;

    const swapQuoterOpts: Partial<SwapQuoterOpts> = {
      ...SWAP_QUOTER_OPTS,
      contractAddresses,
    };
    if (CHAIN_ID === ChainId.Ganache) {
      swapQuoterOpts.samplerOverrides = {
        block: BlockParamLiteral.Latest,
        overrides: {},
        to: contractAddresses.erc20BridgeSampler,
        ...(swapQuoterOpts.samplerOverrides || {}),
      };
    }
    this._swapQuoter = new SwapQuoter(this._provider, orderbook, swapQuoterOpts);
    this._swapQuoteConsumer = new SwapQuoteConsumer(swapQuoterOpts);
    this._web3Wrapper = new Web3Wrapper(this._provider);

    this._contractAddresses = contractAddresses;
    this._wethContract = new WETH9Contract(this._contractAddresses.etherToken, this._provider);
    this._fakeTaker = new FakeTakerContract(NULL_ADDRESS, this._provider);
  }

  public async calculateSwapQuoteAsync(params: GetSwapQuoteParams): Promise<GetSwapQuoteResponse> {
    const {
      takerAddress,
      sellAmount,
      buyAmount,
      buyToken,
      sellToken,
      slippagePercentage,
      gasPrice: providedGasPrice,
      isMetaTransaction,
      isETHSell,
      isETHBuy,
      excludedSources,
      includedSources,
      affiliateFee,
      includePriceComparisons,
      skipValidation,
      shouldSellEntireBalance,
    } = params;

    let swapQuoteRequestOpts: Partial<SwapQuoteRequestOpts>;
    // tslint:disable-next-line:prefer-conditional-expression
    if (
      isMetaTransaction ||
      shouldSellEntireBalance ||
      // Note: We allow VIP to continue ahead when positive slippage fee is enabled
      affiliateFee.feeType === AffiliateFeeType.PercentageFee
    ) {
      swapQuoteRequestOpts = ASSET_SWAPPER_MARKET_ORDERS_OPTS_NO_VIP;
    } else {
      swapQuoteRequestOpts = ASSET_SWAPPER_MARKET_ORDERS_OPTS;
    }

    const assetSwapperOpts: Partial<SwapQuoteRequestOpts> = {
      ...swapQuoteRequestOpts,
      bridgeSlippage: slippagePercentage,
      gasPrice: providedGasPrice,
      excludedSources: swapQuoteRequestOpts.excludedSources?.concat(...(excludedSources || [])),
      includedSources,
      shouldIncludePriceComparisonsReport: !!includePriceComparisons,
    };

    const marketSide = sellAmount !== undefined ? MarketOperation.Sell : MarketOperation.Buy;
    const amount =
      marketSide === MarketOperation.Sell
        ? sellAmount
        : buyAmount!.times(affiliateFee.buyTokenPercentageFee + 1).integerValue(BigNumber.ROUND_DOWN);

    // Fetch the Swap quote
    const swapQuote = await this._swapQuoter.getSwapQuoteAsync(
      buyToken,
      sellToken,
      amount!, // was validated earlier
      marketSide,
      assetSwapperOpts,
    );

    const {
      makerAmount,
      totalTakerAmount,
      protocolFeeInWeiAmount: bestCaseProtocolFee,
    } = swapQuote.bestCaseQuoteInfo;
    const { protocolFeeInWeiAmount: protocolFee, gas: worstCaseGas } = swapQuote.worstCaseQuoteInfo;
    const { gasPrice, sourceBreakdown, quoteReport, priceComparisonsReport } = swapQuote;

    const {
      gasCost: affiliateFeeGasCost,
      buyTokenFeeAmount,
      sellTokenFeeAmount,
    } = getAffiliateFeeAmounts(swapQuote, affiliateFee);

    // Grab the encoded version of the swap quote
    const { to, value, data, gasOverhead } = await this._getSwapQuotePartialTransactionAsync(
      swapQuote,
      isETHSell,
      isETHBuy,
      isMetaTransaction,
      shouldSellEntireBalance,
      {
        recipient: affiliateFee.recipient,
        feeType: affiliateFee.feeType,
        buyTokenFeeAmount,
        sellTokenFeeAmount,
      },
    );

    let conservativeBestCaseGasEstimate = new BigNumber(worstCaseGas)
      .plus(affiliateFeeGasCost)
      .plus(isETHSell ? WRAP_ETH_GAS : 0)
      .plus(isETHBuy ? UNWRAP_WETH_GAS : 0);

    // If the taker address is provided we can provide a more accurate gas estimate
    // using eth_gasEstimate
    // If an error occurs we attempt to provide a better message then "Transaction Reverted"
    if (takerAddress && !skipValidation) {
      let estimateGasCallResult = await this._estimateGasOrThrowRevertErrorAsync({
        to,
        data,
        from: takerAddress,
        value,
        gasPrice,
      });
      // Add any underterministic gas overhead the encoded transaction has detected
      estimateGasCallResult = estimateGasCallResult.plus(gasOverhead);
      // Take the max of the faux estimate or the real estimate
      conservativeBestCaseGasEstimate = BigNumber.max(
        // Add a little buffer to eth_estimateGas as it is not always correct
        estimateGasCallResult.times(GAS_LIMIT_BUFFER_MULTIPLIER).integerValue(),
        conservativeBestCaseGasEstimate,
      );
    }
    // If any sources can be undeterministic in gas costs, we add a buffer
    const hasUndeterministicFills = _.flatten(swapQuote.orders.map((order) => order.fills)).some((fill) =>
      [ERC20BridgeSource.Native, ERC20BridgeSource.MultiBridge].includes(fill.source),
    );
    const undeterministicMultiplier = hasUndeterministicFills ? GAS_LIMIT_BUFFER_MULTIPLIER : 1;
    // Add a buffer to get the worst case gas estimate
    const worstCaseGasEstimate = conservativeBestCaseGasEstimate.times(undeterministicMultiplier).integerValue();
    const { makerTokenDecimals, takerTokenDecimals } = swapQuote;
    const { price, guaranteedPrice } = SwapService._getSwapQuotePrice(
      buyAmount,
      makerTokenDecimals,
      takerTokenDecimals,
      swapQuote,
      affiliateFee,
    );

    let adjustedValue = value;

    adjustedValue = isETHSell ? protocolFee.plus(swapQuote.worstCaseQuoteInfo.takerAmount) : protocolFee;

    // No allowance target is needed if this is an ETH sell, so set to 0x000..
    const allowanceTarget = isETHSell ? NULL_ADDRESS : this._contractAddresses.exchangeProxy;

    const { takerAmountPerEth: takerTokenToEthRate, makerAmountPerEth: makerTokenToEthRate } = swapQuote;

    // Convert into unit amounts
    const wethToken = getTokenMetadataIfExists('WETH', CHAIN_ID)!;
    const sellTokenToEthRate = takerTokenToEthRate
      .times(new BigNumber(10).pow(wethToken.decimals - takerTokenDecimals))
      .decimalPlaces(takerTokenDecimals);
    const buyTokenToEthRate = makerTokenToEthRate
      .times(new BigNumber(10).pow(wethToken.decimals - makerTokenDecimals))
      .decimalPlaces(makerTokenDecimals);

    const apiSwapQuote: GetSwapQuoteResponse = {
      chainId: CHAIN_ID,
      price,
      guaranteedPrice,
      to,
      data,
      value: adjustedValue,
      gas: worstCaseGasEstimate,
      estimatedGas: conservativeBestCaseGasEstimate,
      from: takerAddress,
      gasPrice,
      protocolFee,
      minimumProtocolFee: BigNumber.min(protocolFee, bestCaseProtocolFee),
      // NOTE: Internally all ETH trades are for WETH, we just wrap/unwrap automatically
      buyTokenAddress: isETHBuy ? ETH_TOKEN_ADDRESS : buyToken,
      sellTokenAddress: isETHSell ? ETH_TOKEN_ADDRESS : sellToken,
      buyAmount: makerAmount.minus(buyTokenFeeAmount),
      sellAmount: totalTakerAmount,
      sources: convertSourceBreakdownToArray(sourceBreakdown),
      orders: swapQuote.orders,
      allowanceTarget,
      sellTokenToEthRate,
      buyTokenToEthRate,
      quoteReport,
      priceComparisonsReport,
    };
    return apiSwapQuote;
  }

  public async getSwapQuoteForWrapAsync(params: GetSwapQuoteParams): Promise<GetSwapQuoteResponse> {
    return this._getSwapQuoteForNativeWrappedAsync(params, false);
  }

  public async getSwapQuoteForUnwrapAsync(params: GetSwapQuoteParams): Promise<GetSwapQuoteResponse> {
    return this._getSwapQuoteForNativeWrappedAsync(params, true);
  }

  public async calculateMarketDepthAsync(params: CalculateMarketDepthParams): Promise<{
    asks: { depth: BucketedPriceDepth[] };
    bids: { depth: BucketedPriceDepth[] };
    buyToken: TokenMetadataOptionalSymbol;
    sellToken: TokenMetadataOptionalSymbol;
  }> {
    const {
      buyToken: buyToken,
      sellToken: sellToken,
      sellAmount,
      numSamples,
      sampleDistributionBase,
      excludedSources,
      includedSources,
    } = params;

    const marketDepth = await this._swapQuoter.getBidAskLiquidityForMakerTakerAssetPairAsync(
      buyToken,
      sellToken,
      sellAmount,
      {
        numSamples,
        excludedSources: [
          ...(excludedSources || []),
          ERC20BridgeSource.MultiBridge,
          ERC20BridgeSource.MultiHop,
        ],
        includedSources,
        sampleDistributionBase,
      },
    );

    const maxEndSlippagePercentage = 20;
    const scalePriceByDecimals = (priceDepth: BucketedPriceDepth[]) =>
      priceDepth.map((b) => ({
        ...b,
        price: b.price.times(
          new BigNumber(10).pow(marketDepth.takerTokenDecimals - marketDepth.makerTokenDecimals),
        ),
      }));
    const askDepth = scalePriceByDecimals(
      calculateDepthForSide(
        marketDepth.asks,
        MarketOperation.Sell,
        numSamples * 2,
        sampleDistributionBase,
        maxEndSlippagePercentage,
      ),
    );
    const bidDepth = scalePriceByDecimals(
      calculateDepthForSide(
        marketDepth.bids,
        MarketOperation.Buy,
        numSamples * 2,
        sampleDistributionBase,
        maxEndSlippagePercentage,
      ),
    );
    return {
      // We're buying buyToken and SELLING sellToken (DAI) (50k)
      // Price goes from HIGH to LOW
      asks: { depth: askDepth },
      // We're BUYING sellToken (DAI) (50k) and selling buyToken
      // Price goes from LOW to HIGH
      bids: { depth: bidDepth },
      buyToken: {
        tokenAddress: buyToken,
        decimals: marketDepth.makerTokenDecimals,
      },
      sellToken: {
        tokenAddress: sellToken,
        decimals: marketDepth.takerTokenDecimals,
      },
    };
  }

  private async _getSwapQuoteForNativeWrappedAsync(
    params: GetSwapQuoteParams,
    isUnwrap: boolean,
  ): Promise<GetSwapQuoteResponse> {
    const {
      takerAddress,
      buyToken,
      sellToken,
      buyAmount,
      sellAmount,
      affiliateAddress,
      gasPrice: providedGasPrice,
    } = params;
    const amount = buyAmount || sellAmount;
    if (amount === undefined) {
      throw new Error('sellAmount or buyAmount required');
    }
    const data = (
      isUnwrap ? this._wethContract.withdraw(amount) : this._wethContract.deposit()
    ).getABIEncodedTransactionData();
    const value = isUnwrap ? ZERO : amount;
    const attributedCalldata = attributeCallData(data, affiliateAddress);
    // TODO: consider not using protocol fee utils due to lack of need for an aggresive gas price for wrapping/unwrapping
    const gasPrice = providedGasPrice || (await this._swapQuoter.getGasPriceEstimationOrThrowAsync());
    const gasEstimate = isUnwrap ? UNWRAP_QUOTE_GAS : WRAP_QUOTE_GAS;
    const apiSwapQuote: GetSwapQuoteResponse = {
      chainId: CHAIN_ID,
      price: ONE,
      guaranteedPrice: ONE,
      to: NATIVE_FEE_TOKEN_BY_CHAIN_ID[CHAIN_ID],
      data: attributedCalldata.affiliatedData,
      value,
      gas: gasEstimate,
      estimatedGas: gasEstimate,
      from: takerAddress,
      gasPrice,
      protocolFee: ZERO,
      minimumProtocolFee: ZERO,
      buyTokenAddress: buyToken,
      sellTokenAddress: sellToken,
      buyAmount: amount,
      sellAmount: amount,
      sources: [],
      orders: [],
      sellTokenToEthRate: new BigNumber(1),
      buyTokenToEthRate: new BigNumber(1),
      allowanceTarget: NULL_ADDRESS,
    };
    return apiSwapQuote;
  }

  private async _estimateGasOrThrowRevertErrorAsync(txData: Partial<TxData>): Promise<BigNumber> {
    let revertError;
    let gasEstimate = ZERO;
    let callResult: {
      success: boolean;
      resultData: string;
      gasUsed: BigNumber;
    } = { success: false, resultData: NULL_BYTES, gasUsed: ZERO };
    let callResultGanacheRaw: string | undefined;
    try {
      // NOTE: Ganache does not support overrides
      if (CHAIN_ID === ChainId.Ganache) {
        // Default to true as ganache provides us less info and we cannot override
        callResult.success = true;
        const gas = await this._web3Wrapper.estimateGasAsync(txData).catch((_e) => {
          // If an estimate error happens on ganache we say it failed
          callResult.success = false;
          return DEFAULT_VALIDATION_GAS_LIMIT;
        });
        callResultGanacheRaw = await this._web3Wrapper.callAsync({
          ...txData,
          gas,
        });
        callResult.resultData = callResultGanacheRaw;
        callResult.gasUsed = new BigNumber(gas);
        gasEstimate = new BigNumber(gas);
      } else {
        const estimateGasMultiplier = 1.5;
        const balanceMultiplier = 1.1;
        const defaultGasLimit = 350000;
        const [gas, gasPrice] = await Promise.all([
          this._web3Wrapper.estimateGasAsync(txData)
            .then(estimateGas => new BigNumber(Math.round(estimateGas * estimateGasMultiplier)))
            .catch(() => new BigNumber(defaultGasLimit)),
          this._web3Wrapper.getGasPriceAsync(),
        ]);

        const value = txData.value ? new BigNumber(txData.value) : ZERO;
        const balance = value.plus(gasPrice.times(gas)).times(balanceMultiplier).integerValue(BigNumber.ROUND_DOWN);

        // Split out the `to` and `data` so it doesn't override
        const { data, to, ...rest } = txData;
        callResult = await this._fakeTaker.execute(to!, data!).callAsync({
          ...rest,
          // Set the `to` to be the user address with a fake contract at that address
          to: txData.from!,
          gas,
          gasPrice,
          overrides: {
            // Override the user address with the Fake Taker contract
            [txData.from!]: {
              code: _.get(artifacts.FakeTaker, 'compilerOutput.evm.deployedBytecode.object'),
              balance,
            },
          },
        });
      }
    } catch (e) {
      if (e.message && /insufficient funds/.test(e.message)) {
        throw new InsufficientFundsError();
      }
      // RPCSubprovider can throw if .error exists on the response payload
      // This `error` response occurs from Parity nodes (incl Alchemy) and Geth nodes >= 1.9.14
      // Geth 1.9.15
      if (e.message && /execution reverted/.test(e.message) && e.data) {
        try {
          revertError = RevertError.decode(e.data, false);
        } catch (e) {
          logger.error(`Could not decode revert error: ${e}`);
          throw new Error(e.message);
        }
      } else {
        try {
          revertError = decodeThrownErrorAsRevertError(e);
        } catch (e) {
          // Could not decode the revert error
        }
      }
      if (revertError) {
        throw revertError;
      }
    }
    try {
      if (callResultGanacheRaw) {
        revertError = RevertError.decode(callResultGanacheRaw, false);
      } else if (callResult! && !callResult.success) {
        revertError = RevertError.decode(callResult.resultData, false);
      }
    } catch (e) {
      // No revert error
    }
    if (revertError) {
      throw revertError;
    }
    // Add in the overhead of call data
    gasEstimate = callResult.gasUsed.plus(calculateCallDataGas(txData.data!));
    // If there's a revert and we still are unable to decode it, just throw it.
    // This can happen in VIPs where there are no real revert reasons
    if (!callResult.success) {
      throw new GasEstimationError();
    }
    return gasEstimate;
  }

  private async _getSwapQuotePartialTransactionAsync(
    swapQuote: SwapQuote,
    isFromETH: boolean,
    isToETH: boolean,
    isMetaTransaction: boolean,
    shouldSellEntireBalance: boolean,
    affiliateFee: AffiliateFeeAmount,
  ): Promise<{ to: string; data: string; value: BigNumber; gasOverhead: BigNumber }> {
    const opts: Partial<SwapQuoteGetOutputOpts> = {
      extensionContractOpts: { isFromETH, isToETH, isMetaTransaction, shouldSellEntireBalance, affiliateFee },
    };

    const {
      calldataHexString: data,
      ethAmount: value,
      toAddress: to,
      gasOverhead,
    } = await this._swapQuoteConsumer.getCalldataOrThrowAsync(swapQuote, opts);

    const fixedCallData = fixCallData(data, swapQuote.takerToken, swapQuote.makerToken);

    return {
      to,
      value,
      data: fixedCallData,
      gasOverhead,
    };
  }
}
