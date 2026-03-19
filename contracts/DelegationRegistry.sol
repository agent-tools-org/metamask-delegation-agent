// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title DelegationRegistry
 * @notice On-chain registry for agent delegations with spending limits and expiry.
 */
contract DelegationRegistry {
    struct Delegation {
        address delegator;
        address delegate;
        uint256 spendingLimit;
        uint256 validUntil;
        bool active;
        uint256 createdAt;
    }

    Delegation[] private _delegations;

    event DelegationCreated(
        address indexed delegator,
        address indexed delegate,
        uint256 spendingLimit,
        uint256 validUntil
    );

    event DelegationRevoked(
        address indexed delegator,
        address indexed delegate
    );

    /**
     * @notice Create a new delegation granting `delegate` a scoped permission.
     * @param delegate   The address receiving delegated authority.
     * @param spendingLimit Maximum wei the delegate may spend.
     * @param validUntil  Unix timestamp after which the delegation expires.
     */
    function createDelegation(
        address delegate,
        uint256 spendingLimit,
        uint256 validUntil
    ) external {
        _delegations.push(
            Delegation({
                delegator: msg.sender,
                delegate: delegate,
                spendingLimit: spendingLimit,
                validUntil: validUntil,
                active: true,
                createdAt: block.timestamp
            })
        );

        emit DelegationCreated(msg.sender, delegate, spendingLimit, validUntil);
    }

    /**
     * @notice Revoke an existing delegation. Only the original delegator may call.
     * @param delegationId Index of the delegation to revoke.
     */
    function revokeDelegation(uint256 delegationId) external {
        require(delegationId < _delegations.length, "Invalid delegation id");
        Delegation storage d = _delegations[delegationId];
        require(d.delegator == msg.sender, "Only delegator can revoke");
        require(d.active, "Already revoked");

        d.active = false;

        emit DelegationRevoked(d.delegator, d.delegate);
    }

    /**
     * @notice Return the full Delegation struct for a given id.
     */
    function getDelegation(uint256 id) external view returns (Delegation memory) {
        require(id < _delegations.length, "Invalid delegation id");
        return _delegations[id];
    }

    /**
     * @notice Return the total number of delegations ever created.
     */
    function getDelegationCount() external view returns (uint256) {
        return _delegations.length;
    }

    /**
     * @notice Check whether a delegation is currently active (not revoked and not expired).
     */
    function isActive(uint256 id) external view returns (bool) {
        require(id < _delegations.length, "Invalid delegation id");
        Delegation storage d = _delegations[id];
        return d.active && block.timestamp <= d.validUntil;
    }
}
