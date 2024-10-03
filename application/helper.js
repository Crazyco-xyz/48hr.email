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
     * Convert time to highest possible unit (minutes, hours, days) where `time > 2` and `Number.isSafeInteger(time)` (whole number)
     * @param {Number} time
     * @param {String} unit
     * @returns {String}
     */
    convertUp(time, unit) {
        let convertedTime = time;
        let convertedUnit = unit;

        if (convertedUnit === 'minutes') {
            if (convertedTime > 120 && Number.isSafeInteger(convertedTime / 60)) {
                convertedTime = convertedTime / 60;
                convertedUnit = 'hours';
            }
        }

        if (convertedUnit === 'hours') {
            if (convertedTime > 48 && Number.isSafeInteger(convertedTime / 24)) {
                convertedTime = convertedTime / 24;
                convertedUnit = 'days';
            }
        }
        return `${convertedTime} ${convertedUnit}`;
    }
}

module.exports = Helper
