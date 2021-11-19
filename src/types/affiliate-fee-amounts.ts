import { BigNumber } from '@0x/utils';

export interface AffiliateFeeAmounts {
  gasCost: BigNumber;
  sellTokenFeeAmount: BigNumber;
  buyTokenFeeAmount: BigNumber;
}
