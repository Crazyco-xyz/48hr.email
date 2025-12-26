const config = require('./config')
const moment = require('moment')
const debug = require('debug')('48hr-email:helper')

class Helper {

    /**
     * Normalize our config into a proper timestamp, so we know what emails to purge
     * @returns {Date}
     */
    purgeTimeStamp() {
        const cutoff = moment()
            .subtract(config.email.purgeTime.time, config.email.purgeTime.unit)
            .toDate()
        debug(`Purge cutoff calculated: ${cutoff} (${config.email.purgeTime.time} ${config.email.purgeTime.unit} ago)`)
        return cutoff
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

        const diffMs = nowMs - pastMs;
        const result = diffMs >= DAY_IN_MS;
        debug(`Time difference check: ${diffMs}ms >= ${DAY_IN_MS}ms = ${result}`)
        return result;
    }

    /**
     * Convert time to highest possible unit (minutes → hours → days),
     * rounding if necessary and prefixing "~" when rounded.
     *
     * @param {number} time
     * @param {string} unit  "minutes" | "hours" | "days"
     * @returns {string}
     */
    convertAndRound(time, unit) {
        let value = time;
        let u = unit;

        // upgrade units
        const units = [
            ["minutes", 60, "hours"],
            ["hours", 24, "days"]
        ];

        for (const [from, factor, to] of units) {
            if (u === from && value > factor) {
                value = value / factor;
                u = to;
            }
        }

        // determine if rounding is needed
        const rounded = !Number.isSafeInteger(value);
        if (rounded) value = Math.round(value);

        return `${rounded ? "~" : ""}${value} ${u}`;
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
        debug(`Getting domains with displaySort: ${config.http.displaySort}`)
        let result;
        switch (config.http.displaySort) {
            case 0:
                result = this.hideOther(config.email.domains) // No modification
                debug(`Domain sort 0: no modification, ${result.length} domains`)
                return result
            case 1:
                result = this.hideOther(config.email.domains.sort()) // Sort alphabetically
                debug(`Domain sort 1: alphabetical sort, ${result.length} domains`)
                return result
            case 2:
                result = this.hideOther(this.shuffleFirstItem(config.email.domains.sort())) // Sort alphabetically and shuffle first item
                debug(`Domain sort 2: alphabetical + shuffle first, ${result.length} domains`)
                return result
            case 3:
                result = this.hideOther(this.shuffleArray(config.email.domains)) // Shuffle all
                debug(`Domain sort 3: shuffle all, ${result.length} domains`)
                return result
        }
    }

    async getLargestUid(imapService) {
        return await imapService.getLargestUid();
    }

    countElementBuilder(count = 0, largestUid = 0) {
        const handling = `<label title="Historically managed ${largestUid} email${largestUid === 1 ? '' : 's'}">
        <h4 style="display: inline;"><u><i>${count}</i></u> mail${count === 1 ? '' : 's'}</h4>
        </label>`
        return handling
    }
}

module.exports = Helper