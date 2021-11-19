import { PriceComparisonsReport, QuoteReport } from '@0x/asset-swapper';
import { BigNumber } from '@0x/utils';
import { PriceResponse } from './price-response';

export interface GetSwapQuoteResponse extends PriceResponse {
  to: string;
  data: string;
  value: BigNumber;
  from?: string;
  guaranteedPrice: BigNumber;
  orders?: any;
  quoteReport?: QuoteReport;
  priceComparisonsReport?: PriceComparisonsReport;
}
