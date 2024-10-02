const config = require('./config')
const moment = require('moment')

class Helper {

    /**
     * Normalize our config into a proper timestamp, so we know what emails to purge
     * @returns {Date}
     */
    purgeTimeStamp() {
        return moment()
        .subtract(config.email.purgeTime.time, config.email.purgeTime.unit)
        .toDate()
    }

    /**
     * Check if time difference between now and purgeTimeStamp is more than one day 
     * @param {Date} now
     * @param {Date} past
     * @returns {Boolean}
     */
    moreThanOneDay(now, past) {
        const DAY_IN_MS = 24 * 60 * 60 * 1000;
        if((now - past) / DAY_IN_MS >= 1){
            return  true
        } else {
            return false
        }
    }

    /**
     * Convert time to highest possible unit where i > 2
     * @returns {Date}
     */
    convertUp(time, unit) {
        // TODO: Implement
        return time +` ${unit}`
    }
};

module.exports = Helper
