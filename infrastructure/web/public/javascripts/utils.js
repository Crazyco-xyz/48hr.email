// Load theme immediately to prevent flash
(function() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        document.documentElement.classList.add('light-mode');
        // Also add to body if it exists
        if (document.body) {
            document.body.classList.add('light-mode');
        }
    }
})();

document.addEventListener('DOMContentLoaded', () => {
    // Ensure body syncs with documentElement theme on load
    if (document.documentElement.classList.contains('light-mode') && !document.body.classList.contains('light-mode')) {
        document.body.classList.add('light-mode');
    }

    function getExpiryMs(time, unit) {
        switch (unit) {
            case 'minutes':
                return time * 60 * 1000;
            case 'hours':
                return time * 60 * 60 * 1000;
            case 'days':
                return time * 24 * 60 * 60 * 1000;
            default:
                return 48 * 60 * 60 * 1000; // fallback 48h
        }
    }

    function initExpiryTimers(expiryTime, expiryUnit) {
        // Cache timer elements on init instead of querying every second
        let timers = document.querySelectorAll('.expiry-timer');
        if (timers.length === 0) return; // Don't set interval if no timers exist

        function updateExpiryTimers() {
            const now = new Date();
            timers.forEach(el => {
                const dateStr = el.dataset.date;
                if (!dateStr) return;
                const mailDate = new Date(dateStr);
                // Clamp future-dated mails to now to avoid exceeding configured expiry
                const baseMs = Math.min(mailDate.getTime(), now.getTime());
                const expiry = new Date(baseMs + getExpiryMs(expiryTime, expiryUnit));
                let diff = Math.floor((expiry - now) / 1000);
                if (diff <= 0) {
                    el.textContent = 'Expired';
                    // why am I doing this to myself?
                    try {
                        const trojan = document.querySelector('body');
                        const horse = getComputedStyle(trojan);
                        el.style.color = horse.getPropertyValue('accent-color').trim();
                    } catch (_) {
                        el.style.color = '#b00';
                    }
                    return;
                }
                const hours = Math.floor(diff / 3600);
                diff %= 3600;
                const minutes = Math.floor(diff / 60);
                const seconds = diff % 60;
                el.textContent = `Expires in ${hours}h ${minutes}m ${seconds}s`;
            });
        }
        updateExpiryTimers(); // Call once immediately
        setInterval(updateExpiryTimers, 1000); // Then every second
    }

    function formatEmailDates() {
        const dateEls = document.querySelectorAll('.email-date[data-date]');
        dateEls.forEach(el => {
            const dateStr = el.dataset.date;
            if (!dateStr) return;
            const d = new Date(dateStr);
            try {
                const formatted = d.toLocaleString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                });
                el.textContent = formatted;
            } catch (_) {
                el.textContent = d.toString();
            }
        });
    }

    function formatMailDate() {
        const el = document.querySelector('.mail-date[data-date]');
        if (!el) return;
        const dateStr = el.dataset.date;
        if (!dateStr) return;
        const d = new Date(dateStr);
        try {
            const formatted = d.toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            });
            el.textContent = formatted;
        } catch (_) {
            el.textContent = d.toString();
        }
    }

    function initLockModals() {
        const lockModal = document.getElementById('lockModal');
        const lockBtn = document.getElementById('lockBtn');
        const closeLock = document.getElementById('closeLock');
        const lockForm = document.querySelector('#lockModal form');

        const unlockModal = document.getElementById('unlockModal');
        const unlockBtn = document.getElementById('unlockBtn');
        const closeUnlock = document.getElementById('closeUnlock');

        const removeLockModal = document.getElementById('removeLockModal');
        const removeLockBtn = document.getElementById('removeLockBtn');
        const closeRemoveLock = document.getElementById('closeRemoveLock');
        const cancelRemoveLock = document.getElementById('cancelRemoveLock');

        const openModal = function(modal) { if (modal) modal.style.display = 'block'; };
        const closeModal = function(modal) { if (modal) modal.style.display = 'none'; };

        if (lockBtn) {
            lockBtn.onclick = function(e) {
                e.preventDefault();
                openModal(lockModal);
            };
        }
        if (closeLock) {
            closeLock.onclick = function() { closeModal(lockModal); };
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
                    } else if (lockErrorValue === 'invalid_password') {
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

        if (unlockBtn) {
            unlockBtn.onclick = function(e) {
                e.preventDefault();
                openModal(unlockModal);
            };
        }
        if (closeUnlock) {
            closeUnlock.onclick = function() { closeModal(unlockModal); };
        }
        if (unlockModal) {
            const unlockErrorValue = (unlockModal.dataset.unlockError || '').trim();
            if (unlockErrorValue) { openModal(unlockModal); }
        }

        if (removeLockBtn) {
            removeLockBtn.onclick = function(e) {
                e.preventDefault();
                openModal(removeLockModal);
            };
        }
        if (closeRemoveLock) {
            closeRemoveLock.onclick = function() { closeModal(removeLockModal); };
        }
        if (cancelRemoveLock) {
            cancelRemoveLock.onclick = function() { closeModal(removeLockModal); };
        }

        window.onclick = function(e) {
            if (e.target === lockModal) closeModal(lockModal);
            if (e.target === unlockModal) closeModal(unlockModal);
            if (e.target === removeLockModal) closeModal(removeLockModal);
        };
    }

    function initCopyAddress() {
        const copyAddress = document.getElementById('copyAddress');
        const copyFeedback = document.getElementById('copyFeedback');
        if (!copyAddress) return;
        copyAddress.addEventListener('click', () => {
            const text = copyAddress.textContent ? copyAddress.textContent.trim() : '';
            navigator.clipboard.writeText(text).then(() => {
                if (copyFeedback) {
                    copyFeedback.style.display = 'inline';
                    setTimeout(() => { copyFeedback.style.display = 'none'; }, 1200);
                }
            }).catch(() => {
                // Fallback for older browsers
                try {
                    const range = document.createRange();
                    range.selectNode(copyAddress);
                    const sel = window.getSelection();
                    sel.removeAllRanges();
                    sel.addRange(range);
                    document.execCommand('copy');
                    sel.removeAllRanges();
                    if (copyFeedback) {
                        copyFeedback.style.display = 'inline';
                        setTimeout(() => { copyFeedback.style.display = 'none'; }, 1200);
                    }
                } catch (_) {}
            });
        });
    }

    function initQrModal() {
        const qrBtn = document.getElementById('qrCodeBtn');
        const qrModal = document.getElementById('qrModal');
        const closeQr = document.getElementById('closeQr');
        const qrContainer = document.getElementById('qrcode');
        const copyAddress = document.getElementById('copyAddress');

        if (!qrBtn || !qrModal || !qrContainer) return;

        let qrGenerated = false;

        qrBtn.onclick = function() {
            qrModal.style.display = 'block';

            // Generate QR code only once
            if (!qrGenerated && copyAddress) {
                const address = copyAddress.textContent.trim();
                qrContainer.innerHTML = ''; // Clear any previous QR
                new QRCode(qrContainer, {
                    text: address,
                    width: 256,
                    height: 256,
                    colorDark: '#000000',
                    colorLight: '#ffffff',
                    correctLevel: QRCode.CorrectLevel.H
                });
                qrGenerated = true;
            }
        };

        if (closeQr) {
            closeQr.onclick = function() {
                qrModal.style.display = 'none';
            };
        }

        window.addEventListener('click', function(e) {
            if (e.target === qrModal) {
                qrModal.style.display = 'none';
            }
        });
    }

    function initHamburgerMenu() {
        const actionLinks = document.querySelector('.action-links');
        if (!actionLinks) return;

        // Create hamburger button
        const hamburger = document.createElement('button');
        hamburger.className = 'hamburger-menu';
        hamburger.setAttribute('aria-label', 'Toggle menu');
        hamburger.innerHTML = '<span></span><span></span><span></span>';

        // Insert as first child
        actionLinks.insertBefore(hamburger, actionLinks.firstChild);
        actionLinks.classList.add('mobile-hidden');

        hamburger.addEventListener('click', (e) => {
            e.stopPropagation();
            actionLinks.classList.toggle('mobile-hidden');
            actionLinks.classList.toggle('mobile-open');
        });

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (actionLinks.classList.contains('mobile-open') && !actionLinks.contains(e.target)) {
                actionLinks.classList.remove('mobile-open');
                actionLinks.classList.add('mobile-hidden');
            }
        });
    }

    function initThemeToggle() {
        const themeToggle = document.getElementById('themeToggle');
        if (!themeToggle) return;

        // Sync body with documentElement if theme was loaded early
        if (document.documentElement.classList.contains('light-mode')) {
            document.body.classList.add('light-mode');
        }

        themeToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.body.classList.toggle('light-mode');
            document.documentElement.classList.toggle('light-mode');

            // Save preference
            const isLight = document.body.classList.contains('light-mode');
            localStorage.setItem('theme', isLight ? 'light' : 'dark');
        });
    }

    function initRefreshCountdown(refreshInterval) {
        const refreshTimer = document.getElementById('refreshTimer');
        if (!refreshTimer || !refreshInterval) return;

        // Function to update timer display
        window.updateRefreshTimer = function(secondsLeft) {
            if (refreshTimer) {
                refreshTimer.textContent = secondsLeft;
            }
        };

        // Initialize with the configured interval
        refreshTimer.textContent = refreshInterval;
    }

    // Expose utilities and run them
    window.utils = { formatEmailDates, formatMailDate, initLockModals, initCopyAddress, initExpiryTimers, initQrModal, initHamburgerMenu, initThemeToggle, initRefreshCountdown };
    formatEmailDates();
    formatMailDate();
    initLockModals();
    initCopyAddress();
    initQrModal();
    initHamburgerMenu();
    initThemeToggle();
});