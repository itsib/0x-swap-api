import { Orderbook, SignedNativeOrder } from '@0x/asset-swapper';

export class SwapperOrderbook extends Orderbook {

  public async getOrdersAsync(makerToken: string, takerToken: string, pruneFn?: (o: SignedNativeOrder) => boolean): Promise<SignedNativeOrder[]> {
    return [];
  }

  public async getBatchOrdersAsync(makerTokens: string[], takerToken: string, pruneFn?: (o: SignedNativeOrder) => boolean): Promise<SignedNativeOrder[][]> {
    return [];
  }

  public async destroyAsync(): Promise<void> {
    return;
  }
}
