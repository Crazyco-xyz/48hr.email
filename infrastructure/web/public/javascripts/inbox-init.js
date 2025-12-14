document.addEventListener('DOMContentLoaded', () => {
    const script = document.currentScript;
    const address = script ? script.dataset.address : '';
    if (address) {
        enableNewMessageNotifications(address, true);
    }
});