const EventEmitter = require('events')
const debug = require('debug')('48hr-email:notification')
require('events').defaultMaxListeners = 50;

/**
 * Receives sign-ins from users and notifies them when new mails are available.
 */
class ClientNotification extends EventEmitter {
    constructor() {
        super();
        this.pendingNotifications = new Map(); // address -> count
    }

    use(io) {
        io.on('connection', socket => {
            debug(`[SOCKET] New connection: id=${socket.id}`);
            socket.on('sign in', address => {
                debug(`[SOCKET] sign in received for address: ${address}, socket id: ${socket.id}`);
                this._signIn(socket, address.toLowerCase())
            });
            socket.on('disconnect', reason => {
                debug(`[SOCKET] Disconnected: id=${socket.id}, reason=${reason}`);
            });
        })
    }

    _signIn(socket, address) {
        debug(`socketio signed in: ${address}`)

        const newMailListener = () => {
            debug(`${address} has new messages, sending notification`)
            socket.emit('new emails')
            debug(`socket.emit('new emails') sent to ${address}`)
        }

        this.on(address, newMailListener)

        // Deliver any pending notifications
        const pending = this.pendingNotifications.get(address) || 0;
        if (pending > 0) {
            debug(`Delivering ${pending} pending notifications to ${address}`);
            for (let i = 0; i < pending; i++) {
                socket.emit('new emails');
            }
            this.pendingNotifications.delete(address);
        }

        socket.on('disconnect', reason => {
            debug(`client disconnect: ${address} (${reason})`)
            this.removeListener(address, newMailListener)
        })
    }

    emit(address) {
        address = address.toLowerCase();
        const hadListeners = super.emit(address);
        if (!hadListeners) {
            // Queue notification for later delivery
            const prev = this.pendingNotifications.get(address) || 0;
            this.pendingNotifications.set(address, prev + 1);
            debug(`No listeners for ${address}, queued notification (${prev + 1} pending)`);
        }
        return hadListeners;
    }
}

module.exports = ClientNotification