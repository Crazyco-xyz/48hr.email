/**
 * Mock Inbox Lock for UX Debug Mode
 * Provides dummy inbox locking without database
 */

const debug = require('debug')('48hr-email:mock-inbox-lock')

class MockInboxLock {
    constructor(mockUserRepository) {
        this.mockUserRepository = mockUserRepository
        this.locks = new Map()

        // Initialize locks from repository
        this._initializeLocks()

        debug(`Mock locked inboxes: ${Array.from(mockUserRepository.lockedInboxes).join(', ')}`)
    }

    _initializeLocks() {
        // Add the mock locked inboxes from the repository
        for (const address of this.mockUserRepository.lockedInboxes) {
            this.locks.set(address.toLowerCase(), {
                userId: 1,
                address: address.toLowerCase(),
                lockedAt: Date.now(),
                lastAccess: Date.now()
            })
        }
    }

    // Reset to initial state (called when repository resets)
    reset() {
        this.locks.clear()
        this._initializeLocks()
        debug('Mock inbox locks reset to initial state')
    }

    isLocked(address) {
        return this.locks.has(address.toLowerCase())
    }

    hasAccess(userId, address) {
        const lock = this.locks.get(address.toLowerCase())
        if (!lock) return true // Not locked
        return lock.userId === userId
    }

    isLockedByUser(address, userId) {
        const lock = this.locks.get(address.toLowerCase())
        if (!lock) return false
        return lock.userId === userId
    }

    lock(userId, address) {
        const normalizedAddress = address.toLowerCase()
        if (this.locks.has(normalizedAddress)) {
            throw new Error('Inbox is already locked')
        }

        this.locks.set(normalizedAddress, {
            userId,
            address: normalizedAddress,
            lockedAt: Date.now(),
            lastAccess: Date.now()
        })

        this.mockUserRepository.lockedInboxes.add(address)
        debug(`Locked inbox: ${normalizedAddress}`)
        return true
    }

    release(userId, address) {
        const normalizedAddress = address.toLowerCase()
        const lock = this.locks.get(normalizedAddress)

        if (!lock) {
            throw new Error('Inbox is not locked')
        }

        if (lock.userId !== userId) {
            throw new Error('You do not own this lock')
        }

        this.locks.delete(normalizedAddress)
        this.mockUserRepository.lockedInboxes.delete(address)
        debug(`Released lock on ${normalizedAddress}`)
        return true
    }

    updateAccess(userId, address) {
        const lock = this.locks.get(address.toLowerCase())
        if (lock && lock.userId === userId) {
            lock.lastAccess = Date.now()
        }
    }

    getUserLockedInboxes(userId) {
        const userLocks = []
        for (const [address, lock] of this.locks.entries()) {
            if (lock.userId === userId) {
                userLocks.push({
                    address: address,
                    locked_at: lock.lockedAt,
                    last_access: lock.lastAccess
                })
            }
        }
        return userLocks
    }

    getInactive(hours) {
        // Mock - return empty array
        return []
    }

    getUserLockCount(userId) {
        let count = 0
        for (const lock of this.locks.values()) {
            if (lock.userId === userId) count++
        }
        return count
    }
}

module.exports = MockInboxLock
