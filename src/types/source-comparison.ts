import { ERC20BridgeSource } from '@0x/asset-swapper';
import { BigNumber } from '@0x/utils';

export interface SourceComparison {
  name: ERC20BridgeSource | '0x';
  price: BigNumber | null;
  gas: BigNumber | null;
  savingsInEth: BigNumber | null;
  buyAmount: BigNumber | null;
  sellAmount: BigNumber | null;
}
