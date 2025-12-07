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
     * @param {number|Date} now
     * @param {Date} past
     * @returns {Boolean}
     */
    moreThanOneDay(now, past) {
        const DAY_IN_MS = 24 * 60 * 60 * 1000;

        const nowMs = now instanceof Date ? now.getTime() : now;
        const pastMs = past instanceof Date ? past.getTime() : new Date(past).getTime();

        return (nowMs - pastMs) >= DAY_IN_MS;
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
            }
        }

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

    /**
     * Shuffle an array using the Durstenfeld shuffle algorithm
     * @param {Array} array
     * @returns {Array}
     */

    shuffleArray(array) {
        for (let i = array.length - 1; i >= 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array
    }

    /**
     * Shuffle first item of array, keeping original order afterwards
     * @param {Array} array
     * @returns {Array}
     */

    shuffleFirstItem(array) {
        let first = array[Math.floor(Math.random() * array.length)]
        array = array.filter((value) => value != first);
        array = [first].concat(array)
        return array
    }

    /**
     * Hide other emails in the list and only show first (true) or show all (false)
     * @param {Array} array
     * @returns {Array}
     */
    hideOther(array) {
        if (config.http.hideOther) {
            return array[0]
        } else {
            return array
        }
    }

    /**
     * Get a domain list from config for use
     * @returns {Array}
     */

    getDomains() {
        switch (config.http.displaySort) {
            case 0:
                return this.hideOther(config.email.domains) // No modification
            case 1:
                return this.hideOther(config.email.domains.sort()) // Sort alphabetically
            case 2:
                return this.hideOther(this.shuffleFirstItem(config.email.domains.sort())) // Sort alphabetically and shuffle first item
            case 3:
                return this.hideOther(this.shuffleArray(config.email.domains)) // Shuffle all
        }
    }
}

module.exports = Helper