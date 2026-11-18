// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Arc testnet USDC vault with onchain spending limits for the Thesis-to-Payoff
/// agent (DESIGN.md Section 7). The agent can release funds itself up to the per-tx/daily/
/// strategy caps and the reserve floor; anything over those limits needs the owner's
/// approval via requestRelease -> approveRequest -> executeApproved.
contract ThesisTreasuryVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OWNER_ROLE = keccak256("OWNER_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");

    struct Request {
        string strategyId;
        address destination;
        uint256 amount6;
        uint256 expiresAt;
        bool ownerApproved;
        bool executed;
        bool canceled;
    }

    IERC20 public immutable usdc;

    uint256 public perTxCap6;
    uint256 public dailyCap6;
    uint256 public reserveFloor6;

    uint256 public dailySpent6;
    uint256 public currentDay;

    mapping(address => bool) public allowlist;
    mapping(bytes32 => uint256) public strategyCap6;
    mapping(bytes32 => uint256) public strategySpent6;

    mapping(bytes32 => Request) public requests;
    uint256 public nonce;

    event StrategyCapSet(bytes32 indexed strategyKey, string strategyId, uint256 cap6);
    event DestinationSet(address indexed destination, bool allowed);
    event LimitsSet(uint256 perTxCap6, uint256 dailyCap6, uint256 reserveFloor6);
    event ReleaseRequested(
        bytes32 indexed requestId, string strategyId, address indexed destination, uint256 amount6, uint256 expiresAt
    );
    event ReleaseApproved(bytes32 indexed requestId);
    event Released(bytes32 indexed requestId, string strategyId, address indexed destination, uint256 amount6);
    event RequestCanceled(bytes32 indexed requestId);
    event AgentRevoked(address indexed agent);

    error DestinationNotAllowed(address destination);
    error ExceedsPerTxCap(uint256 amount6, uint256 perTxCap6);
    error ExceedsDailyCap(uint256 amount6, uint256 dailySpent6, uint256 dailyCap6);
    error ExceedsStrategyCap(bytes32 strategyKey, uint256 amount6, uint256 strategySpent6, uint256 strategyCap6);
    error BelowReserveFloor(uint256 balanceAfter6, uint256 reserveFloor6);
    error ZeroAmount();
    error InvalidExpiry();
    error RequestNotFound(bytes32 requestId);
    error RequestAlreadyFinalized(bytes32 requestId);
    error RequestAlreadyExecuted(bytes32 requestId);
    error RequestNotApproved(bytes32 requestId);
    error RequestExpired(bytes32 requestId);
    error NotOwnerOrAgent();
    error NotGuardianOrOwner();

    constructor(
        IERC20 usdc_,
        address owner_,
        address agent_,
        address guardian_,
        uint256 perTxCap6_,
        uint256 dailyCap6_,
        uint256 reserveFloor6_
    ) {
        usdc = usdc_;

        _grantRole(DEFAULT_ADMIN_ROLE, owner_);
        _grantRole(OWNER_ROLE, owner_);
        _grantRole(AGENT_ROLE, agent_);
        _grantRole(GUARDIAN_ROLE, guardian_);
        _setRoleAdmin(AGENT_ROLE, OWNER_ROLE);
        _setRoleAdmin(GUARDIAN_ROLE, OWNER_ROLE);

        perTxCap6 = perTxCap6_;
        dailyCap6 = dailyCap6_;
        reserveFloor6 = reserveFloor6_;
        currentDay = block.timestamp / 1 days;

        emit LimitsSet(perTxCap6_, dailyCap6_, reserveFloor6_);
    }

    /// @notice Agent-initiated release, enforced entirely by onchain caps. No owner step.
    function releaseWithinLimits(string calldata strategyId, address destination, uint256 amount6)
        external
        onlyRole(AGENT_ROLE)
        whenNotPaused
        nonReentrant
    {
        _rolloverDailyIfNeeded();
        if (!allowlist[destination]) revert DestinationNotAllowed(destination);
        if (amount6 > perTxCap6) revert ExceedsPerTxCap(amount6, perTxCap6);
        if (dailySpent6 + amount6 > dailyCap6) revert ExceedsDailyCap(amount6, dailySpent6, dailyCap6);

        bytes32 strategyKey = keccak256(bytes(strategyId));
        uint256 spent = strategySpent6[strategyKey];
        uint256 cap = strategyCap6[strategyKey];
        if (spent + amount6 > cap) revert ExceedsStrategyCap(strategyKey, amount6, spent, cap);

        uint256 balance = usdc.balanceOf(address(this));
        if (balance < amount6 || balance - amount6 < reserveFloor6) {
            revert BelowReserveFloor(balance >= amount6 ? balance - amount6 : 0, reserveFloor6);
        }

        dailySpent6 += amount6;
        strategySpent6[strategyKey] = spent + amount6;

        usdc.safeTransfer(destination, amount6);
        emit Released(bytes32(0), strategyId, destination, amount6);
    }

    /// @notice Agent opens a time-boxed request for an amount that would exceed the agent's
    /// own limits. The owner must approve it before executeApproved can run.
    function requestRelease(string calldata strategyId, address destination, uint256 amount6, uint256 expiresAt)
        external
        onlyRole(AGENT_ROLE)
        returns (bytes32 requestId)
    {
        if (amount6 == 0) revert ZeroAmount();
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        if (!allowlist[destination]) revert DestinationNotAllowed(destination);

        requestId = keccak256(abi.encode(block.chainid, address(this), nonce, strategyId, destination, amount6));
        nonce++;

        requests[requestId] = Request({
            strategyId: strategyId,
            destination: destination,
            amount6: amount6,
            expiresAt: expiresAt,
            ownerApproved: false,
            executed: false,
            canceled: false
        });

        emit ReleaseRequested(requestId, strategyId, destination, amount6, expiresAt);
    }

    function approveRequest(bytes32 requestId) external onlyRole(OWNER_ROLE) {
        Request storage r = _requireRequest(requestId);
        if (r.canceled || r.executed) revert RequestAlreadyFinalized(requestId);
        if (block.timestamp >= r.expiresAt) revert RequestExpired(requestId);

        r.ownerApproved = true;
        emit ReleaseApproved(requestId);
    }

    /// @notice Executes an owner-approved request. Bypasses the per-tx and daily cap (the
    /// owner's approval is the control for over-limit amounts) but still checks pause,
    /// allowlist, the strategy cap and the reserve floor.
    function executeApproved(bytes32 requestId) external onlyRole(AGENT_ROLE) whenNotPaused nonReentrant {
        Request storage r = _requireRequest(requestId);
        if (r.executed) revert RequestAlreadyExecuted(requestId);
        if (r.canceled) revert RequestAlreadyFinalized(requestId);
        if (!r.ownerApproved) revert RequestNotApproved(requestId);
        if (block.timestamp >= r.expiresAt) revert RequestExpired(requestId);
        if (!allowlist[r.destination]) revert DestinationNotAllowed(r.destination);

        bytes32 strategyKey = keccak256(bytes(r.strategyId));
        uint256 spent = strategySpent6[strategyKey];
        uint256 cap = strategyCap6[strategyKey];
        if (spent + r.amount6 > cap) revert ExceedsStrategyCap(strategyKey, r.amount6, spent, cap);

        uint256 balance = usdc.balanceOf(address(this));
        if (balance < r.amount6 || balance - r.amount6 < reserveFloor6) {
            revert BelowReserveFloor(balance >= r.amount6 ? balance - r.amount6 : 0, reserveFloor6);
        }

        // Mark executed before transferring.
        r.executed = true;
        strategySpent6[strategyKey] = spent + r.amount6;

        usdc.safeTransfer(r.destination, r.amount6);
        emit Released(requestId, r.strategyId, r.destination, r.amount6);
    }

    function cancelRequest(bytes32 requestId) external {
        if (!hasRole(OWNER_ROLE, msg.sender) && !hasRole(AGENT_ROLE, msg.sender)) revert NotOwnerOrAgent();
        Request storage r = _requireRequest(requestId);
        if (r.executed) revert RequestAlreadyExecuted(requestId);
        if (r.canceled) revert RequestAlreadyFinalized(requestId);

        r.canceled = true;
        emit RequestCanceled(requestId);
    }

    function setLimits(uint256 newPerTxCap6, uint256 newDailyCap6, uint256 newReserveFloor6)
        external
        onlyRole(OWNER_ROLE)
    {
        perTxCap6 = newPerTxCap6;
        dailyCap6 = newDailyCap6;
        reserveFloor6 = newReserveFloor6;
        emit LimitsSet(newPerTxCap6, newDailyCap6, newReserveFloor6);
    }

    function setDestination(address destination, bool allowed) external onlyRole(OWNER_ROLE) {
        allowlist[destination] = allowed;
        emit DestinationSet(destination, allowed);
    }

    function setStrategyCap(string calldata strategyId, uint256 cap6) external onlyRole(OWNER_ROLE) {
        bytes32 strategyKey = keccak256(bytes(strategyId));
        strategyCap6[strategyKey] = cap6;
        emit StrategyCapSet(strategyKey, strategyId, cap6);
    }

    /// @notice Guardian or owner can pause. Only the owner can unpause.
    function pause() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(OWNER_ROLE, msg.sender)) revert NotGuardianOrOwner();
        _pause();
    }

    function unpause() external onlyRole(OWNER_ROLE) {
        _unpause();
    }

    function revokeAgent(address agent) external onlyRole(OWNER_ROLE) {
        _revokeRole(AGENT_ROLE, agent);
        emit AgentRevoked(agent);
    }

    function _requireRequest(bytes32 requestId) internal view returns (Request storage r) {
        r = requests[requestId];
        if (r.expiresAt == 0) revert RequestNotFound(requestId);
    }

    function _rolloverDailyIfNeeded() internal {
        uint256 today = block.timestamp / 1 days;
        if (today != currentDay) {
            currentDay = today;
            dailySpent6 = 0;
        }
    }
}
