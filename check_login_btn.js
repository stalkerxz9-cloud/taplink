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
        await page.goto('https://taplink.ru/', { waitUntil: 'domcontentloaded' });
        
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a, button')).find(b => b.innerText.includes('Вход') || b.innerText.includes('Log in'));
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 6000));
        
        console.log("URL after clicking login:", page.url());
        const html = await page.content();
        console.log("Has email input?", html.toLowerCase().includes('type="email"'));
        
    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}
run();
