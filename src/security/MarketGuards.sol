// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

library MarketGuards {
    uint256 public constant MIN_PARTICIPANTS = 3;
    uint256 public constant MIN_MARKET_DURATION = 1 hours;
    uint256 public constant MAX_SINGLE_REWARD_PCT = 50;

    function validateTally(uint256 createdAt, uint256 participantCount) internal view {
        require(participantCount >= MIN_PARTICIPANTS, "Insufficient participants");
        require(block.timestamp - createdAt >= MIN_MARKET_DURATION, "Market too young");
    }

    function calculateCappedReward(uint256 totalPool, uint256 requested) internal pure returns (uint256) {
        uint256 maxReward = (totalPool * MAX_SINGLE_REWARD_PCT) / 100;
        return requested > maxReward ? maxReward : requested;
    }
}
