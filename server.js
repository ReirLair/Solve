const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;

function matchesConditions(url) {
    const lcUrl = url.toLowerCase();
    return (
        (lcUrl.includes('vault') && lcUrl.includes('.mp4')) ||
        (lcUrl.includes('cdn') && lcUrl.includes('.mp4')) ||
        (lcUrl.includes('eu') && lcUrl.includes('.mp4')) ||
        (lcUrl.includes('kwik') && lcUrl.includes('.mp4')) ||
        (lcUrl.includes('cdn') && lcUrl.includes('expires')) ||
        lcUrl.includes('vault-11')
    );
}

app.get('/scrape', async (req, res) => {
    const paheUrl = req.query.q;

    if (!paheUrl || !paheUrl.startsWith('https://pahe.win')) {
        return res.status(400).json({ error: 'Missing or invalid query parameter ?q=' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto(paheUrl, { waitUntil: 'networkidle2' });

        await page.waitForFunction(() => {
            const link = document.querySelector('a.redirect');
            return link && link.href.includes('kwik.si');
        }, { timeout: 10000 });

        const finalRedirectUrl = await page.$eval('a.redirect', el => el.href);

        const context = await browser.createIncognitoBrowserContext();
        const kwikPage = await context.newPage();

        await kwikPage.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
        );
        await kwikPage.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

        const matchedLinks = new Set();

        kwikPage.on('request', request => {
            const url = request.url();
            if (matchesConditions(url)) {
                matchedLinks.add(url);
            }
        });

        await kwikPage.goto(finalRedirectUrl, { waitUntil: 'networkidle2' });

        try {
            await kwikPage.waitForSelector('button.button.is-uppercase.is-fullwidth[type="submit"]', { timeout: 10000 });
            await kwikPage.click('button.button.is-uppercase.is-fullwidth[type="submit"]');
        } catch (err) {
            console.log('Download button not clickable:', err.message);
        }

        await kwikPage.waitForTimeout(10000);

        const extractedLinks = await kwikPage.evaluate(() => {
            const anchors = [...document.querySelectorAll('a')].map(a => a.href);
            const iframes = [...document.querySelectorAll('iframe')].map(f => f.src);
            return anchors.concat(iframes);
        });

        extractedLinks.forEach(link => {
            if (matchesConditions(link)) {
                matchedLinks.add(link);
            }
        });

        res.json({
            source: finalRedirectUrl,
            matches: [...matchedLinks]
        });

    } catch (err) {
        console.error('Error during scraping:', err);
        res.status(500).json({ error: 'Scraping failed.', details: err.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});