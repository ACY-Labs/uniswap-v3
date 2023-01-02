// import { log } from '@graphprotocol/graph-ts'
import {
  _HelperStore,
  _LiquidityPoolAmount,
  Token,
  LiquidityPool,
  Pool,
  Bundle,
  NewSwap,
  NewToken
} from "../../../generated/schema";
import { BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import {
  getLiquidityPool,
  getLiquidityPoolAmounts,
  getOrCreateToken,
  getOrCreateTokenWhitelist,
} from "../getters";
import {
  BIGDECIMAL_ZERO,
  BIGDECIMAL_ONE,
  BIGINT_ZERO,
  BIGDECIMAL_TWO,
  INT_ONE,
  INT_ZERO,
  Q192,
  PRECISION,
  BIGDECIMAL_TEN_THOUSAND,
} from "../constants";
import {
  exponentToBigDecimalNew,
  exponentToBigInt,
  safeDiv,
} from "../utils/utils";
import { NetworkConfigs } from "../../../configurations/configure";
import { ZERO_BD, ONE_BD, ZERO_BI } from "../utils/constants";

const WETH_ADDRESS = '0x7ceb23fd6bc0add59e62ac25578270cff1b9f619'
const USDC_WETH_03_POOL = '0x0e44ceb592acfc5d3f09d996302eb4c499ff8c10'
let STABLE_COINS: string[] = ['0x2791bca1f2de4661ed88a30c99a7a9449aa84174']
let MINIMUM_ETH_LOCKED = BigDecimal.fromString('5')

export let WHITELIST_TOKENS: string[] = [
  WETH_ADDRESS, // WETH
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270', // WMATIC
  '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', // USDC
  '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063' // DAI
]

export function getEthPriceInUSD(): BigDecimal {
  let usdcPool = Pool.load(USDC_WETH_03_POOL)
  if (usdcPool !== null) {
    return usdcPool.token0Price
  } else {
    return ZERO_BD
    // return BigDecimal.fromString("1617.51")
  }
}

export function findEthPerToken(token: NewToken): BigDecimal {
  if (token.id == WETH_ADDRESS) {
    return ONE_BD
  }
  let whiteList = token.whitelistPools
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestLiquidityETH = ZERO_BD
  let priceSoFar = ZERO_BD
  let bundle = Bundle.load('1')!

  // hardcoded fix for incorrect rates
  // if whitelist includes token - get the safe price
  if (STABLE_COINS.includes(token.id)) {
    priceSoFar = safeDiv(ONE_BD, bundle.ethPriceUSD)
  } else {
    for (let i = 0; i < whiteList.length; ++i) {
      let poolAddress = whiteList[i]
      let pool = Pool.load(poolAddress)!

      if (pool.liquidity.gt(ZERO_BI)) {
        if (pool.token0 == token.id) {
          // whitelist token is token1
          let token1 = NewToken.load(pool.token1)!
          // get the derived ETH in pool
          let ethLocked = pool.totalValueLockedToken1.times(token1.derivedETH)
          if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
            largestLiquidityETH = ethLocked
            // token1 per our token * Eth per token1
            priceSoFar = pool.token1Price.times(token1.derivedETH as BigDecimal)
          }
        }
        if (pool.token1 == token.id) {
          let token0 = NewToken.load(pool.token0)!
          // get the derived ETH in pool
          let ethLocked = pool.totalValueLockedToken0.times(token0.derivedETH)
          if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(MINIMUM_ETH_LOCKED)) {
            largestLiquidityETH = ethLocked
            // token0 per our token * ETH per token0
            priceSoFar = pool.token0Price.times(token0.derivedETH as BigDecimal)
          }
        }
      }
    }
  }
  return priceSoFar // nothing was found return 0
}

export function getTrackedAmountUSD(
  tokenAmount0: BigDecimal,
  token0: NewToken,
  tokenAmount1: BigDecimal,
  token1: NewToken
): BigDecimal {
  let bundle = Bundle.load('1')!
  let price0USD = token0.derivedETH.times(bundle.ethPriceUSD)
  let price1USD = token1.derivedETH.times(bundle.ethPriceUSD)

  // both are whitelist tokens, return sum of both amounts
  if (WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).plus(tokenAmount1.times(price1USD))
  }

  // take double value of the whitelisted token amount
  if (WHITELIST_TOKENS.includes(token0.id) && !WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount0.times(price0USD).times(BigDecimal.fromString('2'))
  }

  // take double value of the whitelisted token amount
  if (!WHITELIST_TOKENS.includes(token0.id) && WHITELIST_TOKENS.includes(token1.id)) {
    return tokenAmount1.times(price1USD).times(BigDecimal.fromString('2'))
  }

  // neither token is on white list, tracked amount is 0
  return ZERO_BD
}

// Divide numbers too large for floating point or BigDecimal

export function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: BigInt,
  token0: Token,
  token1: Token
): BigDecimal[] {
  let num = sqrtPriceX96.times(sqrtPriceX96);
  let denom = Q192;
  let price1 = num
    .times(PRECISION)
    .div(denom)
    .times(exponentToBigInt(token0.decimals))
    .div(exponentToBigInt(token1.decimals))
    .toBigDecimal()
    .div(PRECISION.toBigDecimal());

  let price0 = safeDiv(BIGDECIMAL_ONE, price1);

  return [price0, price1];
}

export function sqrtPriceX96ToTokenPricesNew(sqrtPriceX96: BigInt, token0: NewToken, token1: NewToken): BigDecimal[] {
  let Q192 = "6277101735386680763835789423207666416102355444464034512896"
  let num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal()
  let denom = BigDecimal.fromString(Q192)
  let price1 = num
    .div(denom)
    .times(exponentToBigDecimalNew(token0.decimals))
    .div(exponentToBigDecimalNew(token1.decimals))
  let price0 = safeDiv(BigDecimal.fromString('1'), price1)
  return [price0, price1]
}

// Derived the price of the native token (Ethereum) using pools where it is paired with a stable coin.
export function updateNativeTokenPriceInUSD(): Token {
  let nativeToken = getOrCreateToken(NetworkConfigs.getReferenceToken());

  let stableAmount = BIGDECIMAL_ZERO;
  let tokenIndicator: i32;
  let largestPool = _LiquidityPoolAmount.load(
    NetworkConfigs.getStableOraclePools()[0]
  );

  if (largestPool == null) {
    log.warning("No STABLE_ORACLE_POOLS given", []);
    return nativeToken;
  }

  if (largestPool.inputTokens[INT_ZERO] == NetworkConfigs.getReferenceToken()) {
    tokenIndicator = INT_ONE;
  } else {
    tokenIndicator = INT_ZERO;
  }

  // fetch average price of NATIVE_TOKEN_ADDRESS from STABLE_ORACLES
  for (
    let i = INT_ZERO;
    i < NetworkConfigs.getStableOraclePools().length;
    i++
  ) {
    let pool = _LiquidityPoolAmount.load(
      NetworkConfigs.getStableOraclePools()[i]
    );
    if (!pool) continue;
    if (pool.inputTokens[INT_ZERO] == NetworkConfigs.getReferenceToken()) {
      if (pool.inputTokenBalances[INT_ONE] > stableAmount) {
        stableAmount = pool.inputTokenBalances[INT_ONE];
        largestPool = pool;
        tokenIndicator = INT_ONE;
      }
    } else {
      if (pool.inputTokenBalances[INT_ZERO] > stableAmount) {
        stableAmount = pool.inputTokenBalances[INT_ZERO];
        largestPool = pool;
        tokenIndicator = INT_ZERO;
      }
    }
  }

  if (
    stableAmount.gt(BIGDECIMAL_TEN_THOUSAND) &&
    largestPool.tokenPrices[tokenIndicator]
  ) {
    nativeToken.lastPriceUSD = largestPool.tokenPrices[tokenIndicator];
  }

  log.warning("NATIVE PRICE: " + nativeToken.lastPriceUSD!.toString(), []);
  return nativeToken;
}

/**
 * This derives the price of a token in USD using pools where it is paired with a whitelisted token.
 * You can find the possible whitelisted tokens used for comparision in the network configuration typescript file.
 **/
export function findUSDPricePerToken(
  token: Token,
  nativeToken: Token
): BigDecimal {
  if (token.id == NetworkConfigs.getReferenceToken()) {
    return nativeToken.lastPriceUSD!;
  }

  let tokenWhitelist = getOrCreateTokenWhitelist(token.id);
  let whiteList = tokenWhitelist.whitelistPools;
  // for now just take USD from pool with greatest TVL
  // need to update this to actually detect best rate based on liquidity distribution
  let largestNativeTokenValue = BIGDECIMAL_ZERO;
  let priceSoFar = BIGDECIMAL_ZERO;

  // hardcoded fix for incorrect rates
  // if whitelist includes token - get the safe price
  if (NetworkConfigs.getStableCoins().includes(token.id)) {
    priceSoFar = BIGDECIMAL_ONE;
  } else if (NetworkConfigs.getUntrackedTokens().includes(token.id)) {
    priceSoFar = BIGDECIMAL_ZERO;
  } else {
    for (let i = 0; i < whiteList.length; ++i) {
      let poolAddress = whiteList[i];
      let poolAmounts = getLiquidityPoolAmounts(poolAddress);
      let pool = getLiquidityPool(poolAddress);

      if (pool.outputTokenSupply!.gt(BIGINT_ZERO)) {
        if (pool.inputTokens[0] == token.id) {
          // whitelist token is token1
          let token1 = getOrCreateToken(pool.inputTokens[1]);
          // get the derived NativeToken in pool
          let nativeTokenValueLocked = poolAmounts.inputTokenBalances[1].times(
            token1.lastPriceUSD!
          );
          if (
            nativeTokenValueLocked.gt(largestNativeTokenValue) &&
            nativeTokenValueLocked.gt(
              NetworkConfigs.getMinimumLiquidityThreshold()
            )
          ) {
            largestNativeTokenValue = nativeTokenValueLocked;
            // token1 per our token * NativeToken per token1
            priceSoFar = poolAmounts.tokenPrices[1].times(
              token1.lastPriceUSD as BigDecimal
            );
          }
        }
        if (pool.inputTokens[1] == token.id) {
          let token0 = getOrCreateToken(pool.inputTokens[0]);
          // get the derived NativeToken in pool
          let nativeTokenValueLocked = poolAmounts.inputTokenBalances[0].times(
            token0.lastPriceUSD!
          );
          if (
            nativeTokenValueLocked.gt(largestNativeTokenValue) &&
            nativeTokenValueLocked.gt(
              NetworkConfigs.getMinimumLiquidityThreshold()
            )
          ) {
            largestNativeTokenValue = nativeTokenValueLocked;
            // token0 per our token * NativeToken per token0
            priceSoFar = poolAmounts.tokenPrices[0].times(
              token0.lastPriceUSD as BigDecimal
            );
          }
        }
      }
    }
  }
  return priceSoFar; // nothing was found return 0
}

/**
 * Accepts tokens and amounts, return tracked amount based on token whitelist
 * If one token on whitelist, return amount in that token converted to USD.
 * If both are, return average of two amounts
 * If neither is, return 0
 * Also, return the value of the valume for each token if it is contained in the whitelist
 */

export function getTrackedVolumeUSD(
  pool: _LiquidityPoolAmount,
  tokenUSD0: BigDecimal,
  token0: Token,
  tokenUSD1: BigDecimal,
  token1: Token
): BigDecimal[] {
  let price0USD = token0.lastPriceUSD!;
  let price1USD = token1.lastPriceUSD!;

  // dont count tracked volume on these pairs - usually rebass tokens
  if (NetworkConfigs.getUntrackedPairs().includes(pool.id)) {
    return [BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO];
  }

  let poolDeposits = _HelperStore.load(pool.id);
  if (poolDeposits == null)
    return [BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO];

  // if less than 5 LPs, require high minimum reserve amount amount or return 0
  // Updated from original subgraph. Number of deposits may not equal number of liquidity providers
  if (poolDeposits.valueInt < 5) {
    let reserve0USD = pool.inputTokenBalances[0].times(price0USD);
    let reserve1USD = pool.inputTokenBalances[1].times(price1USD);
    if (
      NetworkConfigs.getWhitelistTokens().includes(token0.id) &&
      NetworkConfigs.getWhitelistTokens().includes(token1.id)
    ) {
      if (
        reserve0USD
          .plus(reserve1USD)
          .lt(NetworkConfigs.getMinimumLiquidityThreshold())
      ) {
        return [BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO];
      }
    }
    if (
      NetworkConfigs.getWhitelistTokens().includes(token0.id) &&
      !NetworkConfigs.getWhitelistTokens().includes(token1.id)
    ) {
      if (
        reserve0USD
          .times(BIGDECIMAL_TWO)
          .lt(NetworkConfigs.getMinimumLiquidityThreshold())
      ) {
        return [BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO];
      }
    }
    if (
      !NetworkConfigs.getWhitelistTokens().includes(token0.id) &&
      NetworkConfigs.getWhitelistTokens().includes(token1.id)
    ) {
      if (
        reserve1USD
          .times(BIGDECIMAL_TWO)
          .lt(NetworkConfigs.getMinimumLiquidityThreshold())
      ) {
        return [BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO];
      }
    }
  }

  // both are whitelist tokens, return sum of both amounts
  if (
    NetworkConfigs.getWhitelistTokens().includes(token0.id) &&
    NetworkConfigs.getWhitelistTokens().includes(token1.id)
  ) {
    return [
      tokenUSD0,
      tokenUSD1,
      tokenUSD0.plus(tokenUSD1).div(BIGDECIMAL_TWO),
    ];
  }

  // take double value of the whitelisted token amount
  if (
    NetworkConfigs.getWhitelistTokens().includes(token0.id) &&
    !NetworkConfigs.getWhitelistTokens().includes(token1.id)
  ) {
    return [tokenUSD0, BIGDECIMAL_ZERO, tokenUSD0];
  }

  // take double value of the whitelisted token amount
  if (
    !NetworkConfigs.getWhitelistTokens().includes(token0.id) &&
    NetworkConfigs.getWhitelistTokens().includes(token1.id)
  ) {
    return [BIGDECIMAL_ZERO, tokenUSD1, tokenUSD1];
  }

  // neither token is on white list, tracked amount is 0
  return [BIGDECIMAL_ZERO, BIGDECIMAL_ZERO, BIGDECIMAL_ZERO];
}
