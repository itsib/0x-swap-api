import {
    AffiliateFeeType,
    ERC20BridgeSource,
    SELL_SOURCE_FILTER_BY_CHAIN_ID,
    SwapQuote,
    SwapQuoteOrdersBreakdown,
} from '@0x/asset-swapper';
import { ETH_TOKEN_ADDRESS } from '@0x/order-utils';
import { AbiEncoder, BigNumber } from '@0x/utils';
import { utils } from 'ethers';
import { CHAIN_ID, FEE_RECIPIENT_ADDRESS } from '../config';
import {
    AFFILIATE_FEE_TRANSFORMER_GAS,
    NULL_ADDRESS,
    ONE_WORD_LENGTH,
    PERCENTAGE_SIG_DIGITS,
    POSITIVE_SLIPPAGE_FEE_TRANSFORMER_GAS,
    ZERO,
} from '../constants';
import { AffiliateFee, AffiliateFeeAmounts, GetSwapQuoteResponseLiquiditySource } from '../types';
import { randomHexNumberOfLength } from './number-utils';

const PAY_TAKER_TRANSFORMER_START_WORDS = `${utils.hexZeroPad('0x7', ONE_WORD_LENGTH).substr(2)}${utils.hexZeroPad('0x40', ONE_WORD_LENGTH).substr(2)}`;
const PAY_TAKER_TRANSFORMER_MIDDLE_WORDS = `${utils.hexZeroPad('0x20', ONE_WORD_LENGTH).substr(2)}${utils.hexZeroPad('0x40', ONE_WORD_LENGTH).substr(2)}`;
const ZERO_WORD = utils.hexZeroPad('0x0', ONE_WORD_LENGTH).substr(2);
const NATIVE_TOKEN_WORD = utils.hexZeroPad(ETH_TOKEN_ADDRESS.toLowerCase(), ONE_WORD_LENGTH).substr(2);

export function attributeCallData(data: string, affiliateAddress?: string): { affiliatedData: string; decodedUniqueId: string } {
    const affiliateAddressOrDefault = affiliateAddress ? affiliateAddress : FEE_RECIPIENT_ADDRESS;
    const affiliateCallDataEncoder = new AbiEncoder.Method({
        constant: true,
        outputs: [],
        name: 'ZeroExAPIAffiliate',
        inputs: [
            { name: 'affiliate', type: 'address' },
            { name: 'timestamp', type: 'uint256' },
        ],
        payable: false,
        stateMutability: 'view',
        type: 'function',
    });

    // Generate unique identifier
    const timestampInSeconds = new BigNumber(Date.now() / 1000).integerValue();
    const hexTimestamp = timestampInSeconds.toString(16);
    const randomNumber = randomHexNumberOfLength(10);

    // Concatenate the hex identifier with the hex timestamp
    // In the final encoded call data, this will leave us with a 5-byte ID followed by
    // a 4-byte timestamp, and won't break parsers of the timestamp made prior to the
    // addition of the ID
    const uniqueIdentifier = new BigNumber(`${randomNumber}${hexTimestamp}`, 16);

    // Encode additional call data and return
    const encodedAffiliateData = affiliateCallDataEncoder.encode([affiliateAddressOrDefault, uniqueIdentifier]);
    const affiliatedData = `${data}${encodedAffiliateData.slice(2)}`;
    return { affiliatedData, decodedUniqueId: `${randomNumber}-${timestampInSeconds}` };
}

/**
 * Add the missing token addresses to the payTakerTransformer txData, if necessary
 */
export function fixCallData(data: string, takerToken: string, makerToken: string): string {
    const makerTokenWord = utils.hexZeroPad(makerToken.toLowerCase(), ONE_WORD_LENGTH).substr(2);
    const takerTokenWord = utils.hexZeroPad(takerToken.toLowerCase(), ONE_WORD_LENGTH).substr(2);
    const reqExRaw = `${PAY_TAKER_TRANSFORMER_START_WORDS}([0-9a-f]{64})${PAY_TAKER_TRANSFORMER_MIDDLE_WORDS}([0-9a-f]{64})([0-9a-f]{64})(${makerTokenWord}|${takerTokenWord})(?:(${NATIVE_TOKEN_WORD}))?${ZERO_WORD}$`;
    const regEx = new RegExp(reqExRaw, 'i');

    const result = regEx.exec(data);
    if (!result) {
        return data;
    }

    const firstWordsLength = 2;
    const middleWordsLength = 3;
    const [, , , , token] = result;
    const addressesWords = [
        token,
        token === makerTokenWord ? takerTokenWord : makerTokenWord,
        NATIVE_TOKEN_WORD,
    ];

    const totalDataSizeWord = utils.hexZeroPad(`0x${((firstWordsLength + middleWordsLength + addressesWords.length) * ONE_WORD_LENGTH).toString(16)}`, ONE_WORD_LENGTH).substr(2);
    const middleDataSizeWord = utils.hexZeroPad(`0x${((middleWordsLength + addressesWords.length) * ONE_WORD_LENGTH).toString(16)}`, ONE_WORD_LENGTH).substr(2);
    const tokensLengthWord = utils.hexZeroPad(`0x${addressesWords.length.toString(16)}`, ONE_WORD_LENGTH).substr(2);

    const replaceValue = `${PAY_TAKER_TRANSFORMER_START_WORDS}${totalDataSizeWord}${PAY_TAKER_TRANSFORMER_MIDDLE_WORDS}${middleDataSizeWord}${tokensLengthWord}${addressesWords.join('')}${ZERO_WORD}`;
    regEx.lastIndex = 0;

    return data.replace(regEx, replaceValue);
}

export function convertSourceBreakdownToArray(sourceBreakdown: SwapQuoteOrdersBreakdown): GetSwapQuoteResponseLiquiditySource[] {
    const defaultSourceBreakdown: SwapQuoteOrdersBreakdown = Object.assign(
      {},
      // TODO Jacob SELL is a superset of BUY, but may not always be
      ...Object.values(SELL_SOURCE_FILTER_BY_CHAIN_ID[CHAIN_ID].sources).map((s) => ({ [s as any]: ZERO })),
    );

    return Object.entries({ ...defaultSourceBreakdown, ...sourceBreakdown }).reduce<
      GetSwapQuoteResponseLiquiditySource[]
      >((acc, [source, breakdown]) => {
        let obj;
        if (source === ERC20BridgeSource.MultiHop && !BigNumber.isBigNumber(breakdown)) {
            obj = {
                ...breakdown!,
                name: ERC20BridgeSource.MultiHop,
                proportion: new BigNumber(breakdown!.proportion.toPrecision(PERCENTAGE_SIG_DIGITS)),
            };
        } else {
            obj = {
                name: source === ERC20BridgeSource.Native ? '0x' : source,
                proportion: new BigNumber((breakdown as BigNumber).toPrecision(PERCENTAGE_SIG_DIGITS)),
            };
        }
        return [...acc, obj];
    }, []);
}

export function getAffiliateFeeAmounts(quote: SwapQuote, fee: AffiliateFee): AffiliateFeeAmounts {
    if (fee.feeType === AffiliateFeeType.None || fee.recipient === NULL_ADDRESS || fee.recipient === '') {
        return {
            sellTokenFeeAmount: ZERO,
            buyTokenFeeAmount: ZERO,
            gasCost: ZERO,
        };
    }

    const minBuyAmount = quote.worstCaseQuoteInfo.makerAmount;
    const buyTokenFeeAmount = minBuyAmount
      .times(fee.buyTokenPercentageFee)
      .dividedBy(fee.buyTokenPercentageFee + 1)
      .integerValue(BigNumber.ROUND_DOWN);
    return {
        sellTokenFeeAmount: ZERO,
        buyTokenFeeAmount,
        gasCost:
          fee.feeType === AffiliateFeeType.PercentageFee
            ? AFFILIATE_FEE_TRANSFORMER_GAS
            : POSITIVE_SLIPPAGE_FEE_TRANSFORMER_GAS,
    };
}
