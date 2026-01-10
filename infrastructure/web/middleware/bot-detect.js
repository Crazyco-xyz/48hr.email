// Exhaustive bot detection middleware for Express
// Flags likely bots and sets res.locals.suspectedBot
// Uses multiple signals: User-Agent, Accept, Referer, Accept-Language, cookies, IP, and request rate

const knownBotUserAgents = [
    /HeadlessChrome/i,
    /PhantomJS/i,
    /Puppeteer/i,
    /node\.js/i,
    /curl/i,
    /wget/i,
    /python/i,
    /Go-http-client/i,
    /Java\//i,
    /libwww-perl/i,
    /scrapy/i,
    /httpclient/i,
    /http_request2/i,
    /lwp::simple/i,
    /okhttp/i,
    /mechanize/i,
    /axios/i,
    /rest-client/i,
    /httpie/i,
    /powershell/i,
    /http.rb/i,
    /fetch/i,
    /httpclient/i,
    /spider/i,
    /bot/i,
    /spider/i,
    /crawler/i,
    /slurp/i,
    /bingbot/i,
    /yandex/i,
    /duckduckgo/i,
    /baiduspider/i,
    /sogou/i,
    /exabot/i,
    /facebot/i,
    /ia_archiver/i,
    /Google-Read-Aloud/i, // Google Read Aloud
    /Google-Structured-Data-Testing-Tool/i,
    /Google-PageRenderer/i,
    /Google Favicon/i,
    /Googlebot/i,
    /AdsBot-Google/i,
    /Feedfetcher-Google/i,
    /APIs-Google/i,
    /bingpreview/i,
    /facebookexternalhit/i,
    /WhatsApp/i,
    /TelegramBot/i,
    /Slackbot/i,
    /Discordbot/i,
    /Applebot/i,
    /DuckDuckBot/i,
    /embedly/i,
    /LinkedInBot/i,
    /outbrain/i,
    /pinterest/i,
    /quora link preview/i,
    /rogerbot/i,
    /showyoubot/i,
    /SkypeUriPreview/i,
    /Slack-ImgProxy/i,
    /Twitterbot/i,
    /vkShare/i,
    /W3C_Validator/i,
    /redditbot/i,
    /FlipboardProxy/i,
    /Qwantify/i,
    /SEMrushBot/i,
    /AhrefsBot/i,
    /MJ12bot/i,
    /DotBot/i,
    /BLEXBot/i,
    /YandexBot/i,
    /Screaming Frog/i,
    /SiteAuditBot/i,
    /UptimeRobot/i,
    /Pingdom/i,
    /StatusCake/i,
    /ZoominfoBot/i,
    /Google-Safety/i,
    /Lighthouse/i,
    /Accessibility/i,
    /NVDA/i,
    /JAWS/i,
    /VoiceOver/i,
    /ScreenReader/i,
    /axe-core/i,
    /pa11y/i,
    /waveapi/i,
    /tenon/i,
    /Siteimprove/i,
    /SiteAnalyzer/i,
    /Sitebulb/i,
    /SEO PowerSuite/i,
    /SEOsitecheckup/i,
    /SEO Crawler/i,
    /SEO-Checker/i,
    /SEO-Tool/i,
    /SEO-Analyzer/i,
    /SEO-Tester/i,
    /SEO-SpyGlass/i,
    /SEO-Toolkit/i,
    /SEO-Tools/i,
    /SEO-Profiler/i,
    /SEO-Checker/i,
    /SEO-Tool/i,
    /SEO-Analyzer/i,
    /SEO-Tester/i,
    /SEO-SpyGlass/i,
    /SEO-Toolkit/i,
    /SEO-Tools/i,
    /SEO-Profiler/i
];

const knownHeadlessIndicators = [
    'Headless',
    'PhantomJS',
    'Puppeteer',
    'Selenium',
    'Nightmare',
    'SlimerJS',
    'Zombie',
    'CasperJS',
    'TrifleJS',
    'HtmlUnit',
    'Splash',
    'Playwright'
];

// Additional bypass and automation checks
function hasSuspiciousHeaders(req) {
    // Some automation tools set these headers
    if (req.get('X-Requested-With') && req.get('X-Requested-With').toLowerCase() !== 'xmlhttprequest') return true;
    if (req.get('X-Purpose')) return true;
    if (req.get('X-Moz')) return true;
    if (req.get('X-ATT-DeviceId')) return true;
    if (req.get('X-Wap-Profile')) return true;
    if (req.get('X-OperaMini-Phone-UA')) return true;
    if (req.get('X-OperaMini-Features')) return true;
    if (req.get('X-Device-User-Agent')) return true;
    if (req.get('X-Original-User-Agent')) return true;
    if (req.get('X-Device-Id')) return true;
    if (req.get('X-Forwarded-For') && req.get('X-Forwarded-For').split(',').length > 3) return true;
    return false;
}

// In-memory request rate tracking (per IP)
const requestLog = {};
const RATE_WINDOW_MS = 10 * 1000; // 10 seconds
const MAX_REQUESTS_PER_WINDOW = 30;

function isRapidRequester(ip) {
    const now = Date.now();
    if (!requestLog[ip]) requestLog[ip] = [];
    // Remove old entries
    requestLog[ip] = requestLog[ip].filter(ts => now - ts < RATE_WINDOW_MS);
    requestLog[ip].push(now);
    return requestLog[ip].length > MAX_REQUESTS_PER_WINDOW;
}

module.exports = function botDetect(req, res, next) {
    // If suppression cookie is set, skip detection
    if (req.cookies && req.cookies.bot_check_passed) {
        res.locals.suspectedBot = false;
        return next();
    }

    let score = 0;
    const reasons = [];

    // Header and request info (declare all before use)
    const ua = req.get('User-Agent') || '';
    const accept = req.get('Accept') || '';
    const referer = req.get('Referer') || '';
    const acceptLang = req.get('Accept-Language') || '';
    const hasCookies = !!req.headers.cookie;
    const ip = req.ip || req.connection.remoteAddress;
    const path = req.path || '';

    // Check for suspicious/bypass headers
    if (hasSuspiciousHeaders(req)) {
        score += 2;
        reasons.push('Suspicious/bypass headers');
    }

    // Google Read Aloud and similar tools: look for Accept header with 'application/ssml+xml' or 'text/speech'
    if (accept.includes('ssml+xml') || accept.includes('text/speech')) {
        score += 2;
        reasons.push('Speech synthesis Accept header');
    }

    // Accessibility Accept headers (screen readers, etc)
    if (accept.includes('application/x-nvda') || accept.includes('application/x-jaws')) {
        score += 1;
        reasons.push('Accessibility Accept header');
    }

    // Check for automation framework cookies (common for Selenium, Puppeteer, etc)
    if (req.headers.cookie && (req.headers.cookie.includes('puppeteer') || req.headers.cookie.includes('selenium'))) {
        score += 2;
        reasons.push('Automation framework cookie');
    }

    // User-Agent checks
    if (!ua) {
        score += 2;
        reasons.push('Missing User-Agent');
    } else {
        if (knownBotUserAgents.some(pat => pat.test(ua))) {
            score += 3;
            reasons.push('Known bot User-Agent');
        }
        if (knownHeadlessIndicators.some(ind => ua.includes(ind))) {
            score += 2;
            reasons.push('Headless browser indicator');
        }
        if (ua.length < 10) {
            score += 1;
            reasons.push('Suspiciously short User-Agent');
        }
    }

    // Accept header
    if (!accept || accept === '*/*') {
        score += 1;
        reasons.push('Suspicious Accept header');
    }

    // Referer
    if (!referer && req.method === 'POST') {
        score += 1;
        reasons.push('Missing Referer on POST');
    }

    // Accept-Language
    if (!acceptLang) {
        score += 1;
        reasons.push('Missing Accept-Language');
    }

    // Cookies
    if (!hasCookies) {
        score += 1;
        reasons.push('No cookies sent');
    }

    // IP checks (basic, not using blocklists)
    if (isRapidRequester(ip)) {
        score += 2;
        reasons.push('Rapid request rate');
    }

    // HTTP method
    if (req.method && !['GET', 'POST', 'HEAD'].includes(req.method)) {
        score += 1;
        reasons.push('Unusual HTTP method');
    }

    // Path checks (bots often hit /robots.txt, /admin, etc)
    if (['/robots.txt', '/admin', '/wp-login.php', '/xmlrpc.php'].includes(path)) {
        score += 2;
        reasons.push('Bot-targeted path');
    }

    // If score is high, flag as bot
    const threshold = 3;
    if (score >= threshold) {
        res.locals.suspectedBot = true;
        res.locals.botDetectionReasons = reasons;
    } else {
        res.locals.suspectedBot = false;
    }
    next();
}