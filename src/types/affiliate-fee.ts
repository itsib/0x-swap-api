import { BigNumber } from '@0x/utils';

export declare enum AffiliateFeeType {
  None = 0,
  PercentageFee = 1,
  PositiveSlippageFee = 2
}
export interface AffiliateFeeAmount {
  feeType: AffiliateFeeType;
  recipient: string;
  buyTokenFeeAmount: BigNumber;
  sellTokenFeeAmount: BigNumber;
}

export interface AffiliateFee {
  feeType: AffiliateFeeType;
  recipient: string;
  sellTokenPercentageFee: number;
  buyTokenPercentageFee: number;
}
