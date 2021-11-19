import { BigNumber } from '@0x/utils';

export interface BucketedPriceDepth {
  cumulative: BigNumber;
  price: BigNumber;
  bucket: number;
  bucketTotal: BigNumber;
}
