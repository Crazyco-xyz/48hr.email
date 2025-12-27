document.addEventListener('DOMContentLoaded', () => {
    const script = document.querySelector('script[data-address]');
    const address = script ? script.dataset.address : '';
    if (address) {
        enableNewMessageNotifications(address, true);
    }
});