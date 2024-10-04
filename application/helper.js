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
     * Convert time to highest possible unit (minutes, hours, days) where `time > 1` and `Number.isSafeInteger(time)` (whole number)
     * @param {Number} time
     * @param {String} unit
     * @returns {String}
     */
    convertAndRound(time, unit) {
        let convertedTime = time;
        let convertedUnit = unit;
        let rounded = false;

        if (convertedUnit === 'minutes') {
            if (convertedTime > 60) {
                convertedTime = convertedTime / 60
                convertedUnit = 'hours';
        }}

        if (convertedUnit === 'hours') {
            if (convertedTime > 24) {
                convertedTime = convertedTime / 24;
                convertedUnit = 'days';
            }
        }

        if (!convertedTime == Number.isSafeInteger(convertedTime)) {
            convertedTime = Math.round(convertedTime);
            rounded = true;
        }

        if (rounded) {
            convertedTime = `~${convertedTime}`;
        }

        return `${convertedTime} ${convertedUnit}`;
    }

    /**
     * Build a purgeTime html element for the page to keep the clutter outside of the twig template
     * @returns {String}
     */
    purgeTimeElemetBuilder() {
        let time = `${config.email.purgeTime.time} ${config.email.purgeTime.unit}`
        let Tooltip = ''
        if (config.email.purgeTime.convert) {
            time = this.convertAndRound(config.email.purgeTime.time, config.email.purgeTime.unit)
            if (time !== `${config.email.purgeTime.time} ${config.email.purgeTime.unit}`) {
                Tooltip = `Config: ${config.email.purgeTime.time} ${config.email.purgeTime.unit}`
            }
        }

        const footer = `<label title="${Tooltip}">
        <h4 style="display: inline;"><u><i>${time}</i></u></h4>
        </Label>`

        return footer
    }
}

module.exports = Helper
