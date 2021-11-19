import { ERC20BridgeSource } from '@0x/asset-swapper';
import { BigNumber } from '@0x/utils';
import { AffiliateFee } from './affiliate-fee';

export interface SwapQuoteParamsBase {
  sellAmount?: BigNumber;
  buyAmount?: BigNumber;
  slippagePercentage?: number;
  excludedSources: ERC20BridgeSource[];
  includedSources?: ERC20BridgeSource[];
  affiliateAddress?: string;
  affiliateFee: AffiliateFee;
  includePriceComparisons?: boolean;
}
