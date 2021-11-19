import { BigNumber } from '@0x/utils';
import { QuoteBase } from './quote-base';
import { SourceComparison } from './source-comparison';

export interface PriceResponse extends QuoteBase {
  sellTokenAddress: string;
  buyTokenAddress: string;
  value: BigNumber;
  gas: BigNumber;
  priceComparisons?: SourceComparison[];
}
