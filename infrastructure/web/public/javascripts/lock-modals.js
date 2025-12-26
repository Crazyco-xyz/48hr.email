document.addEventListener('DOMContentLoaded', function() {
    // Lock modal elements
    const lockModal = document.getElementById('lockModal');
    const lockBtn = document.getElementById('lockBtn');
    const closeLock = document.getElementById('closeLock');
    const lockForm = document.querySelector('#lockModal form');

    // Unlock modal elements
    const unlockModal = document.getElementById('unlockModal');
    const unlockBtn = document.getElementById('unlockBtn');
    const closeUnlock = document.getElementById('closeUnlock');

    // Remove lock modal elements
    const removeLockModal = document.getElementById('removeLockModal');
    const removeLockBtn = document.getElementById('removeLockBtn');
    const closeRemoveLock = document.getElementById('closeRemoveLock');
    const cancelRemoveLock = document.getElementById('cancelRemoveLock');

    // Open/close helpers
    const openModal = function(modal) { if (modal) modal.style.display = 'block'; };
    const closeModal = function(modal) { if (modal) modal.style.display = 'none'; };

    // Protect / Lock modal logic
    if (lockBtn) {
        lockBtn.onclick = function(e) {
            e.preventDefault();
            openModal(lockModal);
        };
    }
    if (closeLock) {
        closeLock.onclick = function() {
            closeModal(lockModal);
        };
    }

    if (lockForm) {
        lockForm.addEventListener('submit', function(e) {
            const pwElement = document.getElementById('lockPassword');
            const cfElement = document.getElementById('lockConfirm');
            const pw = pwElement ? pwElement.value : '';
            const cf = cfElement ? cfElement.value : '';
            const err = document.getElementById('lockErrorInline');
            const serverErr = document.getElementById('lockServerError');
            if (serverErr) serverErr.style.display = 'none';

            if (pw !== cf) {
                e.preventDefault();
                if (err) {
                    err.textContent = 'Passwords do not match.';
                    err.style.display = 'block';
                }
                return;
            }
            if (pw.length < 8) {
                e.preventDefault();
                if (err) {
                    err.textContent = 'Password must be at least 8 characters.';
                    err.style.display = 'block';
                }
                return;
            }
            if (err) err.style.display = 'none';
        });
    }

    // Auto-open lock modal if server provided an error (via data attribute)
    if (lockModal) {
        const lockErrorValue = (lockModal.dataset.lockError || '').trim();
        if (lockErrorValue) {
            openModal(lockModal);
            const err = document.getElementById('lockErrorInline');
            const serverErr = document.getElementById('lockServerError');
            if (serverErr) serverErr.style.display = 'none';

            if (err) {
                if (lockErrorValue === 'locking_disabled_for_example') {
                    err.textContent = 'Locking is disabled for the example inbox.';
                } else if (lockErrorValue === 'invalid') {
                    err.textContent = 'Please provide a valid password.';
                } else if (lockErrorValue === 'server_error') {
                    err.textContent = 'A server error occurred. Please try again.';
                } else if (lockErrorValue === 'remove_failed') {
                    err.textContent = 'Failed to remove lock. Please try again.';
                } else {
                    err.textContent = 'An error occurred. Please try again.';
                }
                err.style.display = 'block';
            }
        }
    }

    // Unlock modal logic
    if (unlockBtn) {
        unlockBtn.onclick = function(e) {
            e.preventDefault();
            openModal(unlockModal);
        };
    }
    if (closeUnlock) {
        closeUnlock.onclick = function() {
            closeModal(unlockModal);
        };
    }

    if (unlockModal) {
        const unlockErrorValue = (unlockModal.dataset.unlockError || '').trim();
        if (unlockErrorValue) {
            openModal(unlockModal);
        }
    }

    // Remove lock modal logic
    if (removeLockBtn) {
        removeLockBtn.onclick = function(e) {
            e.preventDefault();
            openModal(removeLockModal);
        };
    }
    if (closeRemoveLock) {
        closeRemoveLock.onclick = function() {
            closeModal(removeLockModal);
        };
    }
    if (cancelRemoveLock) {
        cancelRemoveLock.onclick = function() {
            closeModal(removeLockModal);
        };
    }

    // Close modals when clicking outside
    window.onclick = function(e) {
        if (e.target === lockModal) closeModal(lockModal);
        if (e.target === unlockModal) closeModal(unlockModal);
        if (e.target === removeLockModal) closeModal(removeLockModal);
    };
});
