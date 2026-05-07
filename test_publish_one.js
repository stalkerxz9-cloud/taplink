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
        await page.setViewport({ width: 1280, height: 900 });

        console.log('Заходим на страницу логина...');
        await page.goto('https://taplink.ru/login/', { waitUntil: 'domcontentloaded' });
        
        await page.waitForSelector('input[name="email"]', {visible: true, timeout: 60000});
        await page.type('input[name="email"]', 'hjx17@mailnesia.site', { delay: 50 });
        await page.type('input[name="password"]', 'SecureShowroom#2024', { delay: 50 });
        await page.keyboard.press('Enter');
        console.log('Авторизуемся...');
        
        await new Promise(r => setTimeout(r, 6000));
        
        const screenshotPath = path.join(__dirname, 'data', 'test_auth.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('Скриншот сделан: data/test_auth.png');

        const btnText = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a'));
            const publishBtn = btns.find(b => b.innerText.includes('Опубликовать') || b.innerText.includes('Publish'));
            return publishBtn ? publishBtn.innerText : 'Кнопка публикации не найдена';
        });

        console.log('Статус кнопки:', btnText);

    } catch (e) {
        console.error('Ошибка:', e);
    } finally {
        await browser.close();
    }
}

run();
