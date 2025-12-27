document.addEventListener('DOMContentLoaded', () => {
    const script = document.querySelector('script[data-address]');
    const address = script ? script.dataset.address : '';
    // Get expiry config from data attributes
    const expiryTime = script && script.dataset.expiryTime ? Number(script.dataset.expiryTime) : 48;
    const expiryUnit = script && script.dataset.expiryUnit ? script.dataset.expiryUnit : 'hours';
    if (address) {
        enableNewMessageNotifications(address, true);
    }

    // Initialize expiry timers via utils
    if (window.utils && typeof window.utils.initExpiryTimers === 'function') {
        window.utils.initExpiryTimers(expiryTime, expiryUnit);
    }
    if (window.utils && typeof window.utils.formatEmailDates === 'function') {
        window.utils.formatEmailDates();
    }
});