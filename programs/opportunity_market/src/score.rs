use crate::error::ErrorCode;
use anchor_lang::prelude::*;

// Fixed-point scale factor to avoid decimal division
pub const PRECISION: u64 = 10_000;

pub fn calculate_user_score_components(
    option_created: u64,
    reveal_start: u64,
    user_staked_at: u64,
    user_stake_end: u64,
    stake_amount: u64,
    earliness_cutoff_seconds: u64,
    earliness_multiplier: u16,
) -> Result<(u64, u64, u64)> {
    let earliness_cutoff = earliness_cutoff_seconds.max(1);
    let earliness_multiplier = earliness_multiplier as u64;

    let total_stake_period = reveal_start
        .checked_sub(option_created)
        .ok_or(ErrorCode::Overflow)?;

    // saturating_sub: a stake placed before the option existed gets peak earliness boost
    let stake_since_creation = user_staked_at
        .saturating_sub(option_created)
        .max(1);

    let actual_stake_duration = user_stake_end
        .checked_sub(user_staked_at)
        .ok_or(ErrorCode::Overflow)?;

    // Linear decay from earliness_multiplier at t=0 down to PRECISION at t>=earliness_cutoff.
    let boost_range = earliness_multiplier
        .checked_sub(PRECISION)
        .ok_or(ErrorCode::Overflow)?;

    let earliness_factor = earliness_multiplier
        .checked_sub(
            stake_since_creation
                .min(earliness_cutoff)
                .checked_mul(boost_range)
                .ok_or(ErrorCode::Overflow)?
                / earliness_cutoff,
        )
        .ok_or(ErrorCode::Overflow)?;

    // No `.max(1)` here: an early unstake should be allowed to score 0 on the
    // time component, otherwise the reward formula always pays a sliver to
    // someone who never actually committed capital.
    let stake_time_percentage = (actual_stake_duration as u128)
        .checked_mul(100)
        .ok_or(ErrorCode::Overflow)?
        .checked_div((total_stake_period.max(1)) as u128)
        .ok_or(ErrorCode::Overflow)? as u64;

    Ok((stake_amount, stake_time_percentage, earliness_factor))
}

pub fn calculate_user_score(
    option_created: u64,
    reveal_start: u64,
    user_staked_at: u64,
    user_stake_end: u64,
    stake_amount: u64,
    earliness_cutoff_seconds: u64,
    earliness_multiplier: u16,
) -> Result<u64> {
    let (amount, time_pct, earliness) = calculate_user_score_components(
        option_created,
        reveal_start,
        user_staked_at,
        user_stake_end,
        stake_amount,
        earliness_cutoff_seconds,
        earliness_multiplier,
    )?;

    // score = amount * time_pct * earliness / PRECISION
    // Use u128 intermediate to avoid overflow.
    let weighted = (amount as u128)
        .checked_mul(time_pct as u128)
        .ok_or(ErrorCode::Overflow)?
        .checked_mul(earliness as u128)
        .ok_or(ErrorCode::Overflow)?;

    let user_score = weighted
        .checked_div(PRECISION as u128)
        .ok_or(ErrorCode::Overflow)? as u64;

    Ok(user_score)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Realistic baseline: 1,000,000 tokens with 9 decimals
    const STAKE: u64 = 1_000_000_000_000_000;

    // Realistic Solana clock values (≈ 2024-05-01).
    const MARKET_OPENED: u64 = 1_714_521_600;
    const ONE_WEEK: u64 = 7 * 24 * 60 * 60;

    const MULT_1_5X: u16 = 15_000;
    const MULT_2X: u16 = 20_000;
    const MULT_1X: u16 = 10_000;

    #[test]
    fn peak_boost_when_staking_at_market_open() {
        // Staker enters at t=0, never unstakes early.
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let (amount, time_pct, earliness) = calculate_user_score_components(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED,
            reveal_start,
            STAKE,
            ONE_WEEK,
            MULT_2X,
        )
        .unwrap();

        assert_eq!(amount, STAKE);
        assert_eq!(time_pct, 100);
        // .max(1) on stake_since_creation shaves one tick off the peak.
        assert_eq!(earliness, 2 * PRECISION - (PRECISION / ONE_WEEK));
    }

    #[test]
    fn no_boost_at_cutoff_boundary() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let cutoff = 24 * 60 * 60; // 1 day
        let (_, _, earliness) = calculate_user_score_components(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED + cutoff,
            reveal_start,
            STAKE,
            cutoff,
            MULT_2X,
        )
        .unwrap();

        // 1.0x
        assert_eq!(earliness, PRECISION);
    }

    #[test]
    fn no_boost_after_cutoff() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let cutoff = 24 * 60 * 60;
        let (_, _, earliness) = calculate_user_score_components(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED + 2 * cutoff,
            reveal_start,
            STAKE,
            cutoff,
            MULT_2X,
        )
        .unwrap();

        // 1.0x
        assert_eq!(earliness, PRECISION);
    }

    #[test]
    fn midway_boost_is_linear() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let cutoff = 24 * 60 * 60;
        let (_, _, earliness) = calculate_user_score_components(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED + cutoff / 2,
            reveal_start,
            STAKE,
            cutoff,
            MULT_2X,
        )
        .unwrap();

        // 2.0x at t=0, 1.5x at t=cutoff/2.
        assert_eq!(earliness, PRECISION + PRECISION / 2);
    }

    #[test]
    fn multiplier_equal_to_precision_means_no_boost() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let (_, _, earliness) = calculate_user_score_components(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED + 60,
            reveal_start,
            STAKE,
            ONE_WEEK,
            MULT_1X,
        )
        .unwrap();

        assert_eq!(earliness, PRECISION);
    }

    #[test]
    fn realistic_full_score_with_1_5x_multiplier() {
        // Stake 1M tokens (9 decimals) at t=0 of a 1-week market, never unstake.
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let score = calculate_user_score(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED,
            reveal_start,
            STAKE,
            ONE_WEEK,
            MULT_1_5X,
        )
        .unwrap();

        // amount * time_pct(100) * earliness(~15000) / PRECISION
        //   = 1e15 * 100 * 15000 / 10000 ≈ 1.5e16
        // .max(1) on stake_since_creation shaves off one tick.
        let expected_earliness = 15_000 - (5_000 / ONE_WEEK);
        let expected = (STAKE as u128) * 100 * (expected_earliness as u128) / (PRECISION as u128);
        assert_eq!(score as u128, expected);
    }

    #[test]
    fn max_u64_stake_does_not_overflow() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let result = calculate_user_score(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED,
            reveal_start,
            u64::MAX,
            ONE_WEEK,
            MULT_2X,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn early_unstake_pulls_time_pct_below_full() {
        // User stakes at t=0, unstakes 1 day into a 1-week market.
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let day = 24 * 60 * 60;
        let (_, time_pct, _) = calculate_user_score_components(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED,
            MARKET_OPENED + day,
            STAKE,
            ONE_WEEK,
            MULT_1_5X,
        )
        .unwrap();

        // 1 day out of 7 → 14% (integer truncation).
        assert_eq!(time_pct, 14);
    }

    #[test]
    fn zero_amount_yields_zero_score() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let score = calculate_user_score(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED,
            reveal_start,
            0,
            ONE_WEEK,
            MULT_2X,
        )
        .unwrap();

        assert_eq!(score, 0);
    }

    #[test]
    fn zero_stake_duration_yields_zero_score() {
        // Staker unstakes the same second they stake.
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let t = MARKET_OPENED + 60;
        let score = calculate_user_score(
            MARKET_OPENED,
            reveal_start,
            t,
            t,
            STAKE,
            ONE_WEEK,
            MULT_2X,
        )
        .unwrap();

        assert_eq!(score, 0);
    }

    #[test]
    fn zero_cutoff_does_not_panic_and_gives_no_boost() {
        // Cutoff = 0 is .max(1)'d internally; any stake_since_creation >= 1 hits the
        // clamp, so factor = PRECISION (1.0x) regardless of staking time.
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let (_, _, earliness) = calculate_user_score_components(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED + 60,
            reveal_start,
            STAKE,
            0,
            MULT_2X,
        )
        .unwrap();

        assert_eq!(earliness, PRECISION);
    }

    #[test]
    fn reveal_before_option_creation_errors() {
        let r = calculate_user_score(
            MARKET_OPENED,
            // reveal_start < option_created
            MARKET_OPENED - 1,
            MARKET_OPENED,
            MARKET_OPENED,
            STAKE,
            ONE_WEEK,
            MULT_2X,
        );
        assert!(r.is_err());
    }

    #[test]
    fn stake_end_before_stake_start_errors() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let r = calculate_user_score(
            MARKET_OPENED,
            reveal_start,
            MARKET_OPENED + 100,
            // unstake before stake
            MARKET_OPENED + 50,
            STAKE,
            ONE_WEEK,
            MULT_2X,
        );
        assert!(r.is_err());
    }

    #[test]
    fn stake_before_option_creation_gets_peak_earliness() {
        let reveal_start = MARKET_OPENED + ONE_WEEK;
        let user_staked_at = MARKET_OPENED + 10;
        let option_created = MARKET_OPENED + 60 * 60;

        let (_, _, earliness) = calculate_user_score_components(
            option_created,
            reveal_start,
            user_staked_at,
            reveal_start,
            STAKE,
            ONE_WEEK,
            MULT_2X,
        )
        .unwrap();

        assert_eq!(earliness, 2 * PRECISION - (PRECISION / ONE_WEEK));
    }
}