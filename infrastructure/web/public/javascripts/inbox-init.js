document.addEventListener('DOMContentLoaded', () => {
    const script = document.querySelector('script[data-address]');
    const address = script ? script.dataset.address : '';
    // Get expiry config from data attributes
    const expiryTime = script && script.dataset.expiryTime ? Number(script.dataset.expiryTime) : 48;
    const expiryUnit = script && script.dataset.expiryUnit ? script.dataset.expiryUnit : 'hours';
    if (address) {
        enableNewMessageNotifications(address, true);
    }

    // Copy address on click
    const copyAddress = document.getElementById('copyAddress');
    const copyFeedback = document.getElementById('copyFeedback');
    if (copyAddress) {
        copyAddress.addEventListener('click', () => {
            navigator.clipboard.writeText(copyAddress.textContent.trim()).then(() => {
                if (copyFeedback) {
                    copyFeedback.style.display = 'inline';
                    setTimeout(() => { copyFeedback.style.display = 'none'; }, 1200);
                }
            });
        });
    }

    // Expiry timer for each email
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

    function updateExpiryTimers() {
        const timers = document.querySelectorAll('.expiry-timer');
        timers.forEach(el => {
            const dateStr = el.dataset.date;
            if (!dateStr) return;
            const mailDate = new Date(dateStr);
            // Use config-driven expiry
            const expiry = new Date(mailDate.getTime() + getExpiryMs(expiryTime, expiryUnit));
            const now = new Date();
            let diff = Math.floor((expiry - now) / 1000);
            if (diff <= 0) {
                el.textContent = 'Expired';
                el.style.color = '#b00';
                return;
            }
            const hours = Math.floor(diff / 3600);
            diff %= 3600;
            const minutes = Math.floor(diff / 60);
            const seconds = diff % 60;
            el.textContent = `Expires in ${hours}h ${minutes}m ${seconds}s`;
        });
    }
    setInterval(updateExpiryTimers, 1000);
    updateExpiryTimers();
});