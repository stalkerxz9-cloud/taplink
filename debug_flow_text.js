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
        await page.goto('https://taplink.ru/profile/auth/login/', { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('input[type="email"]', {visible: true, timeout: 30000});
        await page.type('input[type="email"]', 'hjx17@mailnesia.site', { delay: 50 });
        
        const text1 = await page.evaluate(() => document.body.innerText);
        console.log("=== STEP 1 (Before click) ===");
        console.log(text1);

        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .find(b => /продолжить|далее|next|войти/i.test(b.innerText || b.value || ''));
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 5000));
        
        const text2 = await page.evaluate(() => document.body.innerText);
        console.log("=== STEP 2 (After First Click) ===");
        console.log(text2);

        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, div[role="button"], a'))
                .find(b => /почта существует|да, все верно|yes|continue|войти|log in/i.test(b.innerText || ''));
            if (btn) btn.click();
        });
        await new Promise(r => setTimeout(r, 5000));

        const text3 = await page.evaluate(() => document.body.innerText);
        console.log("=== STEP 3 (After Second Click) ===");
        console.log(text3);

    } catch (e) {
        console.error(e);
    } finally {
        await browser.close();
    }
}
run();
