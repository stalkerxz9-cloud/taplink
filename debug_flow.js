import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import path from 'path';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--window-size=1280,900', '--no-proxy-server']
    });

    try {
        const page = await browser.newPage();
        await page.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('input[type="email"]', {visible: true, timeout: 30000});
        await page.screenshot({ path: path.join(__dirname, 'data', 'step1_email_input.png') });

        await page.type('input[type="email"]', 'hjx17@mailnesia.site', { delay: 50 });
        
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .find(b => /продолжить|далее|next|войти/i.test(b.innerText || b.value || ''));
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 5000));
        await page.screenshot({ path: path.join(__dirname, 'data', 'step2_after_next.png') });

        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, div[role="button"], a'))
                .find(b => /почта существует|да, все верно|yes|continue|войти|log in/i.test(b.innerText || ''));
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 4000));
        await page.screenshot({ path: path.join(__dirname, 'data', 'step3_after_exists.png') });

    } catch (e) {
        console.error(e);
        await browser.pages().then(async pages => {
            if(pages[1]) await pages[1].screenshot({ path: path.join(__dirname, 'data', 'step_error.png') });
        });
    } finally {
        await browser.close();
    }
}

run();
