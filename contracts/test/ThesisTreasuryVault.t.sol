// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ThesisTreasuryVault} from "../src/ThesisTreasuryVault.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract ThesisTreasuryVaultTest is Test {
    // Demo defaults, DESIGN.md Section 7.
    uint256 constant PER_TX_CAP = 25_000_000;
    uint256 constant DAILY_CAP = 50_000_000;
    uint256 constant RESERVE_FLOOR = 10_000_000;
    uint256 constant STRATEGY_CAP = 150_000_000;
    uint256 constant STARTING_BALANCE = 150_000_000;

    string constant STRATEGY_ID = "strat-1";

    MockUSDC usdc;
    ThesisTreasuryVault vault;

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address guardian = makeAddr("guardian");
    address settlement = makeAddr("settlement");
    address notAllowlisted = makeAddr("notAllowlisted");
    address stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new MockUSDC();
        vault = new ThesisTreasuryVault(
            IERC20(address(usdc)), owner, agent, guardian, PER_TX_CAP, DAILY_CAP, RESERVE_FLOOR
        );
        usdc.mint(address(vault), STARTING_BALANCE);

        vm.prank(owner);
        vault.setDestination(settlement, true);
        vm.prank(owner);
        vault.setStrategyCap(STRATEGY_ID, STRATEGY_CAP);
    }

    // ---------- wrong caller reverts ----------

    function test_WrongCallerReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, vault.AGENT_ROLE())
        );
        vm.prank(stranger);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, 1_000_000);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, vault.AGENT_ROLE())
        );
        vm.prank(stranger);
        vault.requestRelease(STRATEGY_ID, settlement, 1_000_000, block.timestamp + 120);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, vault.OWNER_ROLE())
        );
        vm.prank(stranger);
        vault.approveRequest(bytes32(0));

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, vault.OWNER_ROLE())
        );
        vm.prank(stranger);
        vault.setLimits(1, 1, 1);

        vm.expectRevert(ThesisTreasuryVault.NotGuardianOrOwner.selector);
        vm.prank(stranger);
        vault.pause();

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, vault.OWNER_ROLE())
        );
        vm.prank(stranger);
        vault.unpause();

        vm.expectRevert(ThesisTreasuryVault.NotOwnerOrAgent.selector);
        vm.prank(stranger);
        vault.cancelRequest(bytes32(0));
    }

    // ---------- allowlist ----------

    function test_NonAllowlistedDestinationReverts() public {
        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.DestinationNotAllowed.selector, notAllowlisted));
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, notAllowlisted, 1_000_000);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.DestinationNotAllowed.selector, notAllowlisted));
        vm.prank(agent);
        vault.requestRelease(STRATEGY_ID, notAllowlisted, 1_000_000, block.timestamp + 120);
    }

    // ---------- per-tx cap ----------

    function test_ExactPerTxCapSucceedsCapPlusOneReverts() public {
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, PER_TX_CAP);
        assertEq(usdc.balanceOf(address(vault)), STARTING_BALANCE - PER_TX_CAP);
        assertEq(vault.dailySpent6(), PER_TX_CAP);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.ExceedsPerTxCap.selector, PER_TX_CAP + 1, PER_TX_CAP));
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, PER_TX_CAP + 1);
    }

    // ---------- daily cap + rollover ----------

    function test_DailyCapAndRollover() public {
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, PER_TX_CAP); // dailySpent = 25
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, PER_TX_CAP); // dailySpent = 50, at cap

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.ExceedsDailyCap.selector, 1_000_000, DAILY_CAP, DAILY_CAP));
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, 1_000_000);

        vm.warp(block.timestamp + 1 days);

        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, PER_TX_CAP); // new day, cap reset
        assertEq(vault.dailySpent6(), PER_TX_CAP);
        assertEq(usdc.balanceOf(address(vault)), STARTING_BALANCE - 3 * PER_TX_CAP);
    }

    // ---------- strategy cap ----------

    function test_StrategyCap() public {
        string memory smallStrategy = "strat-small";
        vm.prank(owner);
        vault.setStrategyCap(smallStrategy, 30_000_000);

        vm.prank(agent);
        vault.releaseWithinLimits(smallStrategy, settlement, PER_TX_CAP); // strategySpent = 25, within 30

        vm.expectRevert(
            abi.encodeWithSelector(
                ThesisTreasuryVault.ExceedsStrategyCap.selector,
                keccak256(bytes(smallStrategy)),
                6_000_000,
                PER_TX_CAP,
                30_000_000
            )
        );
        vm.prank(agent);
        vault.releaseWithinLimits(smallStrategy, settlement, 6_000_000); // 25 + 6 = 31 > 30
    }

    // ---------- reserve floor ----------

    function test_ReserveFloor() public {
        // Fresh vault with generous per-tx/daily caps and a balance tight against the
        // floor, so the reserve floor is the binding check rather than per-tx/daily.
        MockUSDC token = new MockUSDC();
        ThesisTreasuryVault v = new ThesisTreasuryVault(
            IERC20(address(token)), owner, agent, guardian, 1_000_000_000, 1_000_000_000, RESERVE_FLOOR
        );
        token.mint(address(v), 15_000_000);
        vm.prank(owner);
        v.setDestination(settlement, true);
        vm.prank(owner);
        v.setStrategyCap(STRATEGY_ID, 1_000_000_000);

        vm.prank(agent);
        v.releaseWithinLimits(STRATEGY_ID, settlement, 5_000_000); // balance 15 -> 10, exactly at the floor
        assertEq(token.balanceOf(address(v)), RESERVE_FLOOR);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.BelowReserveFloor.selector, RESERVE_FLOOR - 1, RESERVE_FLOOR));
        vm.prank(agent);
        v.releaseWithinLimits(STRATEGY_ID, settlement, 1);
    }

    // ---------- pause ----------

    function test_PauseBlocksAllReleasePaths() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 300);
        vm.prank(owner);
        vault.approveRequest(requestId);

        vm.prank(guardian);
        vault.pause();

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, 1_000_000);

        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(agent);
        vault.executeApproved(requestId);

        // requestRelease and cancelRequest are not fund-moving, and stay available while paused
        // so the owner can still see and clear requests.
        vm.prank(owner);
        vault.cancelRequest(requestId);

        vm.prank(owner);
        vault.unpause();

        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, 1_000_000); // works again post-unpause
    }

    function test_OnlyOwnerCanUnpause() public {
        vm.prank(guardian);
        vault.pause();

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, guardian, vault.OWNER_ROLE())
        );
        vm.prank(guardian);
        vault.unpause();
    }

    // ---------- revoked agent ----------

    function test_RevokedAgentBlocked() public {
        vm.prank(owner);
        vault.revokeAgent(agent);

        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, agent, vault.AGENT_ROLE())
        );
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, 1_000_000);
    }

    // ---------- request lifecycle ----------

    function test_RequestApproveExecuteHappyPath() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 300);

        vm.prank(owner);
        vault.approveRequest(requestId);

        vm.prank(agent);
        vault.executeApproved(requestId);

        assertEq(usdc.balanceOf(settlement), 80_000_000);
        assertEq(usdc.balanceOf(address(vault)), STARTING_BALANCE - 80_000_000);
        // executeApproved bypasses the per-tx/daily cap but still counts against the strategy cap.
        assertEq(vault.strategySpent6(keccak256(bytes(STRATEGY_ID))), 80_000_000);
        assertEq(vault.dailySpent6(), 0);
    }

    function test_DoubleExecuteReverts() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 300);
        vm.prank(owner);
        vault.approveRequest(requestId);
        vm.prank(agent);
        vault.executeApproved(requestId);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.RequestAlreadyExecuted.selector, requestId));
        vm.prank(agent);
        vault.executeApproved(requestId);
    }

    function test_ExpiredRequestCannotBeApproved() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 100);

        vm.warp(block.timestamp + 101);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.RequestExpired.selector, requestId));
        vm.prank(owner);
        vault.approveRequest(requestId);
    }

    function test_ExpiredRequestCannotBeExecutedEvenIfApprovedFirst() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 100);
        vm.prank(owner);
        vault.approveRequest(requestId); // approved before expiry

        vm.warp(block.timestamp + 101);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.RequestExpired.selector, requestId));
        vm.prank(agent);
        vault.executeApproved(requestId);
    }

    function test_UnapprovedRequestCannotExecute() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 300);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.RequestNotApproved.selector, requestId));
        vm.prank(agent);
        vault.executeApproved(requestId);
    }

    function test_CancelRequestByOwnerOrAgent() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 300);

        vm.prank(owner);
        vault.cancelRequest(requestId);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.RequestAlreadyFinalized.selector, requestId));
        vm.prank(owner);
        vault.approveRequest(requestId);
    }

    function test_CanceledRequestCannotBeCanceledAgain() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 300);
        vm.prank(agent);
        vault.cancelRequest(requestId);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.RequestAlreadyFinalized.selector, requestId));
        vm.prank(owner);
        vault.cancelRequest(requestId);
    }

    function test_ExecutedRequestCannotBeCanceled() public {
        vm.prank(agent);
        bytes32 requestId = vault.requestRelease(STRATEGY_ID, settlement, 80_000_000, block.timestamp + 300);
        vm.prank(owner);
        vault.approveRequest(requestId);
        vm.prank(agent);
        vault.executeApproved(requestId);

        vm.expectRevert(abi.encodeWithSelector(ThesisTreasuryVault.RequestAlreadyExecuted.selector, requestId));
        vm.prank(owner);
        vault.cancelRequest(requestId);
    }

    // ---------- events ----------

    function test_ReleaseEmitsReleasedEvent() public {
        vm.expectEmit(true, true, false, true);
        emit ThesisTreasuryVault.Released(bytes32(0), STRATEGY_ID, settlement, 1_000_000);
        vm.prank(agent);
        vault.releaseWithinLimits(STRATEGY_ID, settlement, 1_000_000);
    }

    // ---------- fuzz: daily releases never exceed the daily cap ----------

    function testFuzz_DailyReleasesNeverExceedDailyCap(uint8 numReleases, uint256 seed) public {
        numReleases = uint8(bound(numReleases, 1, 40));

        // Generous balance and strategy cap so the daily cap (and the per-tx cap, which
        // bounds each individual release below it) are the only checks that can bind.
        MockUSDC token = new MockUSDC();
        ThesisTreasuryVault v = new ThesisTreasuryVault(
            IERC20(address(token)), owner, agent, guardian, PER_TX_CAP, DAILY_CAP, 0
        );
        token.mint(address(v), 10_000_000_000);
        vm.prank(owner);
        v.setDestination(settlement, true);
        vm.prank(owner);
        v.setStrategyCap(STRATEGY_ID, 10_000_000_000);

        for (uint256 i = 0; i < numReleases; i++) {
            uint256 amount = (uint256(keccak256(abi.encode(seed, i))) % PER_TX_CAP) + 1;
            vm.prank(agent);
            try v.releaseWithinLimits(STRATEGY_ID, settlement, amount) {
                assertLe(v.dailySpent6(), DAILY_CAP);
            } catch {
                // Expected once the running total would exceed the daily cap.
            }
        }

        assertLe(v.dailySpent6(), DAILY_CAP);
    }
}
