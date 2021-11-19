import { ChainId } from '@0x/contract-addresses';
import { BigNumber } from '@0x/utils';
import { GetSwapQuoteResponseLiquiditySource } from './get-swap-quote-response-liquidity-source';

export interface QuoteBase {
  chainId: ChainId;
  price: BigNumber;
  buyAmount: BigNumber;
  sellAmount: BigNumber;
  sources: GetSwapQuoteResponseLiquiditySource[];
  gasPrice: BigNumber;
  estimatedGas: BigNumber;
  sellTokenToEthRate: BigNumber;
  buyTokenToEthRate: BigNumber;
  protocolFee: BigNumber;
  minimumProtocolFee: BigNumber;
  allowanceTarget?: string;
}
