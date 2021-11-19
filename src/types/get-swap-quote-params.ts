import { BigNumber } from '@0x/utils';
import { SwapQuoteParamsBase } from './swap-quote-params-base';

export interface GetSwapQuoteParams extends SwapQuoteParamsBase {
  sellToken: string;
  buyToken: string;
  takerAddress?: string;
  apiKey?: string;
  gasPrice?: BigNumber;
  skipValidation: boolean;
  shouldSellEntireBalance: boolean;
  isWrap: boolean;
  isUnwrap: boolean;
  isETHSell: boolean;
  isETHBuy: boolean;
  isMetaTransaction: boolean;
}
