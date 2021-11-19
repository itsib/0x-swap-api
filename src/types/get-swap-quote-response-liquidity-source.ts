import { BigNumber } from '@0x/utils';

export interface GetSwapQuoteResponseLiquiditySource {
  name: string;
  proportion: BigNumber;
  intermediateToken?: string;
  hops?: string[];
}
