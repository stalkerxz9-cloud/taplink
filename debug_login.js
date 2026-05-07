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
        await page.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'networkidle2' });
        
        await page.screenshot({ path: 'data/login_debug.png' });
        console.log("Screenshot saved.");

        console.log("Current URL:", page.url());
        const html = await page.content();
        console.log("Has email input?", html.toLowerCase().includes('email'));
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}
run();
