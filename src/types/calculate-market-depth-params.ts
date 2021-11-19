import { ERC20BridgeSource } from '@0x/asset-swapper';
import { BigNumber } from '@0x/utils';

export interface CalculateMarketDepthParams {
  buyToken: string;
  sellToken: string;
  sellAmount: BigNumber;
  numSamples: number;
  sampleDistributionBase: number;
  excludedSources?: ERC20BridgeSource[];
  includedSources?: ERC20BridgeSource[];
}
