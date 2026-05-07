import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

async function run() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--window-size=1280,900', '--no-proxy-server']
    });

    try {
        const page = await browser.newPage();
        await page.goto('https://taplink.ru/profile/auth/login/', { waitUntil: 'networkidle2' });
        
        console.log("Current URL after logic:", page.url());
        const html = await page.content();
        console.log("Text snapshot:");
        console.log(html.substring(0, 500));

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}
run();
