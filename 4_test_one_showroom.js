import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';

import fs from 'fs';
import path from 'path';

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath    = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath     = path.join(process.cwd(), 'data', 'bot_test_log.txt');

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

function log(msg) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logPath, line + '\n', 'utf-8');
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Браузер ──────────────────────────────────────────────────────────────────
async function launchNewBrowser() {
    const args = [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--window-size=1280,800', '--disable-extensions'
    ];

    log(`[БРАУЗЕР] Запуск в видимом режиме...`);
    const browser = await puppeteer.launch({
        headless: false, // ВИДИМЫЙ РЕЖИМ
        args,
        defaultViewport: { width: 1280, height: 800 }, 
        protocolTimeout: 120000,
    });

    const mPage = await browser.newPage();
    return { browser, mPage };
}

// ─── Почта (1secmail.cc) ──────────────────────────────────────────────────────
async function getVisualEmail(mailPage) {
    log('--- ПОЛУЧЕНИЕ ПОЧТЫ ---');
    try {
        await mailPage.goto('https://www.1secmail.cc/en/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(2000);
        // Ждем, пока почта реально прогрузится (появится @ и пропадет Loading)
        await mailPage.waitForFunction(() => {
            const el = document.querySelector('#mainEmail');
            return el && el.value && el.value.includes('@') && !el.value.includes('Loading');
        }, { timeout: 30000 });

        const email = await mailPage.$eval('#mainEmail', el => el.value);
        log(`Получен email: ${email}`);
        return email;
    } catch (e) {
        log(`[ПОЧТА ОШИБКА] ${e.message}`);
        return null;
    }
}

async function getVisualCode(mailPage) {
    log('Ожидаем письмо с кодом...');
    for (let i = 0; i < 20; i++) {
        try {
            await mailPage.bringToFront();
            await mailPage.click('#refresh').catch(() => {});
            await sleep(4000);

            const code = await mailPage.evaluate(() => {
                const subjects = Array.from(document.querySelectorAll('.mailbox-item .link-primary'));
                for (const sub of subjects) {
                    const match = (sub.innerText || '').match(/\b(\d{6})\b/);
                    if (match) return match[1];
                }
                return null;
            });
            if (code) { log(`Код найден: ${code}`); return code; }
        } catch (e) { log(`[КОД ОШИБКА] ${e.message}`); }
        await sleep(2000);
    }
    return null;
}

// ─── Регистрация Taplink ───────────────────────────────────────────────────────
async function registerTaplink(tPage, mailPage, email, password) {
    log(`Регистрация аккаунта: ${email}`);
    await tPage.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    await tPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await tPage.type('input[type="email"]', email, { delay: 50 });

    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /продолжить|далее|создать/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    const requiresCode = await tPage.evaluate(() => {
        return document.body.innerText.includes('код') || !!document.querySelector('input[autocomplete="one-time-code"]');
    });

    if (requiresCode) {
        const code = await getVisualCode(mailPage);
        if (code) {
            await tPage.bringToFront();
            const inputs = await tPage.$$('input:not([type="hidden"])');
            let entered = 0;
            for (const inp of inputs) {
                const visible = await inp.evaluate(el => el.offsetWidth > 0);
                if (!visible || entered >= 6) continue;
                await inp.focus();
                await inp.type(code[entered], { delay: 100 });
                entered++;
            }
        }
    }

    await sleep(6000);
    log('Устанавливаем пароль...');
    try {
        await tPage.waitForSelector('input[type="password"]', { timeout: 15000 });
        const passes = await tPage.$$('input[type="password"]');
        for (const p of passes) await p.type(password, { delay: 50 });

        await tPage.evaluate(() => {
            const cb = document.querySelector('input[type="checkbox"]');
            if (cb) cb.click();
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .find(b => /регистр|далее|войти|продолжить/i.test(b.innerText || b.value || ''));
            if (btn) btn.click();
        });
        await sleep(8000);
    } catch(e) {}
    
    return true;
}

async function ensureSaved(page) {
    log('   Попытка сохранения...');
    for (let i = 0; i < 4; i++) {
        const closed = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('.modal-card-foot .is-primary, button, .button.is-primary'));
            const btn = btns.find(b => b.innerText?.includes('Сохранить') || b.innerText?.includes('Готово'));
            if (btn) { btn.click(); return false; }
            return true;
        });
        await sleep(3000);
        const modalVisible = await page.evaluate(() => {
            const modal = document.querySelector('.modal-card, .modal.is-active');
            return modal && modal.offsetHeight > 0;
        });
        if (!modalVisible) return true;
    }
    await page.keyboard.press('Escape'); await sleep(1000);
}

// ─── ГЛАВНЫЙ ЦИКЛ ТЕСТА ────────────────────────────────────────────────────────
async function run() {
    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const sr = showrooms[0]; // ЛИМИТ: ОДИН ШОУРУМ
    
    log(`🏎️ ТЕСТОВЫЙ ЗАПУСК: ${sr.name}`);
    const { browser, mPage } = await launchNewBrowser();
    const tPage = await browser.newPage();
    
    const PASS = 'SecureShowroom#2024';
    const email = await getVisualEmail(mPage);
    await registerTaplink(tPage, mPage, email, PASS);

    log('Запуск дизайна (ENGLISH MODE)...');
    
    // Выбор шаблона
    await sleep(5000);
    if ((await tPage.url()).includes('/templates/')) {
        await tPage.mouse.click(372, 238); await sleep(3000); 
        await tPage.mouse.click(460, 549); await sleep(5000); 
        await tPage.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, div, span')).find(el => el.innerText?.trim() === 'Да');
            if (btn) btn.click();
        });
        await sleep(8000);
    }

    // 1. АВАТАР
    const logoRelPath = sr.logo_local || `data/${sr.safe_name}/logo.jpg`;
    const logoFullPath = path.resolve(process.cwd(), logoRelPath);
    if (fs.existsSync(logoFullPath)) {
        log('Загрузка Аватара...');
        await (await tPage.waitForSelector('button.is-new-block')).click(); await sleep(2500);
        await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Аватар'))?.click());
        await sleep(4000);
        const fileInp = await tPage.$('input[type="file"]');
        if (fileInp) await fileInp.uploadFile(logoFullPath);
        await sleep(6000);
        await ensureSaved(tPage);
    }

    // 2. BIO (ENGLISH)
    log('Добавление BIO...');
    await tPage.click('button.is-new-block'); await sleep(3000);
    await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Текст'))?.click());
    await sleep(4000);
    
    // Используем сгенерированное Bio или шаблон
    const testBio = sr.bio || `${sr.name} is a premier automotive dealer in Dubai, offering premium vehicles and expert service.`;
    await tPage.keyboard.type(testBio, { delay: 1 });
    await sleep(2000);
    await ensureSaved(tPage);

    // 3. WHATSAPP
    if (sr.whatsapp) {
        log('Добавление WhatsApp...');
        await tPage.click('button.is-new-block'); await sleep(2000);
        await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Мессенджеры'))?.click());
        await sleep(3000);
        await tPage.evaluate(() => Array.from(document.querySelectorAll('.modal-card-body .item')).find(el => el.innerText?.includes('WhatsApp'))?.click());
        await sleep(2000);
        const winp = await tPage.$('.modal-card-body input');
        if (winp) await winp.type(sr.whatsapp);
        await ensureSaved(tPage);
    }

    log('✅ ТЕСТ ЗАВЕРШЕН. Оставляю браузер открытым для осмотра.');
}

run();
