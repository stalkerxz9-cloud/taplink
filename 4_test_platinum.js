import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';

import fs from 'fs';
import path from 'path';

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath    = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath     = path.join(process.cwd(), 'data', 'platinum_test_log.txt');

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

function log(msg) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logPath, line + '\n', 'utf-8');
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function launchNewBrowser() {
    const args = [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--window-size=1280,800', '--disable-extensions'
    ];
    log(`[БРАУЗЕР] Запуск в ВИДИМОМ РЕЖИМЕ...`);
    const browser = await puppeteer.launch({
        headless: false,
        args,
        defaultViewport: { width: 1280, height: 800 }, 
        protocolTimeout: 120000,
    });
    const mPage = await browser.newPage();
    return { browser, mPage };
}

async function getVisualEmail(mailPage) {
    log('--- ПОЛУЧЕНИЕ ПОЧТЫ ---');
    try {
        for (let i = 0; i < 3; i++) {
            await mailPage.goto('https://www.1secmail.cc/en/', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await sleep(5000); 
            try {
                await mailPage.waitForFunction(() => {
                    const el = document.querySelector('#mainEmail');
                    return el && el.value && el.value.includes('@') && !el.value.includes('Loading');
                }, { timeout: 15000 });
                const email = await mailPage.$eval('#mainEmail', el => el.value);
                if (email && email.includes('@')) { log(`Получен email: ${email}`); return email; }
            } catch (e) {
                log(`Попытка ${i+1} не удалась, обновляю...`);
                await mailPage.click('#delete').catch(() => {}); await sleep(3000);
            }
        }
        return null;
    } catch (e) { return null; }
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

async function registerTaplink(tPage, mailPage, email, password) {
    log(`Регистрация: ${email}`);
    await tPage.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await tPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await tPage.type('input[type="email"]', email, { delay: 50 });
    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /register|регистр|войти|далее|next|continue|продолжить/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(4000);
    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"], a'))
            .find(b => /почта существует|да, все верно|продолжить|yes/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(4000);
    const requiresCode = await tPage.evaluate(() => document.body.innerText.includes('код') || !!document.querySelector('input[autocomplete="one-time-code"]'));
    if (requiresCode) {
        log('Ожидаем код...');
        const code = await getVisualCode(mailPage);
        if (code && typeof code === 'string' && code.length === 6) {
            await tPage.bringToFront();
            const inputs = await tPage.$$('input:not([type="hidden"])');
            let entered = 0;
            for (const inp of inputs) {
                const visible = await inp.evaluate(el => el.offsetWidth > 0);
                if (!visible || entered >= 6) continue;
                await inp.type(code[entered], { delay: 200 }); entered++;
            }
            log('Нажимаем продолжить после ввода кода...');
            await tPage.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, .button')).find(b => /продолжить|next|continue|далее/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(5000);
        }
    }
    await sleep(6000);
    log('Установка пароля...');
    try {
        await tPage.waitForSelector('input[type="password"]', { timeout: 15000 });
        const passes = await tPage.$$('input[type="password"]');
        for (const p of passes) await p.type(password, { delay: 50 });
        await tPage.evaluate(() => {
            const cb = document.querySelector('input[type="checkbox"]'); if (cb) cb.click();
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]')).find(b => /register|регистр|войти|продолжить/i.test(b.innerText || b.value || ''));
            if (btn) btn.click();
        });
        await sleep(8000);
    } catch(e) {}
    return true;
}

async function ensureSaved(page) {
    log('   Попытка сохранения...');
    for (let i = 0; i < 4; i++) {
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('.modal-card-foot .is-primary, button, .button.is-primary'));
            const btn = btns.find(b => /сохранить|готово|save|done|ready/i.test(b.innerText || ''));
            if (btn) btn.click();
        });
        await sleep(3000);
        const modalVisible = await page.evaluate(() => !!document.querySelector('.modal-card, .modal.is-active'));
        if (!modalVisible) return true;
    }
    await page.keyboard.press('Escape'); await sleep(1000);
}

// ─── ГЛАВНЫЙ ЦИКЛ PLATINUM ТЕСТА ──────────────────────────────────────────────
async function run() {
    let showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const readline = (await import('readline')).createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => {
        readline.question('\n⚠️ СБРОСИТЬ ВЕСЬ ПРОГРЕСС И ПРИМЕНИТЬ ПЛАТИНОВЫЙ КОНТЕНТ? (y/N): ', ans => r(ans.toLowerCase()));
    });
    if (answer === 'y' || answer === 'д') {
        log('🔄 Сброс базы для платинового теста...');
        showrooms.forEach(s => { s.taplink_created = false; s.taplink_published = false; s.taplink_url = ''; });
        fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
    }

    log('🚀 СТАРТ PLATINUM ТЕСТА (2 ОБЪЕКТА)...');
    for (let i = 0; i < 2; i++) {
        const sr = showrooms[i];
        log(`\n[${i+1}/2] >>> 🏎️ ЦЕЛЬ: ${sr.name}`);
        const { browser, mPage } = await launchNewBrowser();
        const tPage = await browser.newPage();
        const PASS = 'SecureShowroom#2024';
        try {
            const email = await getVisualEmail(mPage);
            if (!email) { await browser.close(); continue; }
            await registerTaplink(tPage, mPage, email, PASS);

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

            // АВАТАР
            const logoPath = sr.logo_local || `data/${sr.safe_name}/logo.jpg`;
            const fullLogoPath = path.resolve(process.cwd(), logoPath);
            if (fs.existsSync(fullLogoPath)) {
                log('Загрузка Логотипа...');
                await (await tPage.waitForSelector('button.is-new-block')).click(); await sleep(2500);
                await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.trim().match(/Аватар|Avatar/i))?.click());
                await sleep(4000);
                const fileInp = await tPage.$('input[type="file"]');
                if (fileInp) await fileInp.uploadFile(fullLogoPath);
                await sleep(7000); await ensureSaved(tPage);
            }

            // БАННЕР (Первое фото из галереи)
            if (sr.images_local && sr.images_local.length > 0) {
                const bannerPath = path.resolve(process.cwd(), sr.images_local[0]);
                if (fs.existsSync(bannerPath)) {
                    log('Загрузка Баннера (Фото авто)...');
                    await (await tPage.waitForSelector('button.is-new-block')).click(); await sleep(2500);
                    await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.trim().match(/Баннер|Banner/i))?.click());
                    await sleep(4000);
                    const bInp = await tPage.$('input[type="file"]');
                    if (bInp) await bInp.uploadFile(bannerPath);
                    await sleep(8000); await ensureSaved(tPage);
                }
            }

            // BIO (BASIC - ALWAYS FREE)
            log('Добавление Bio (English Only)...');
            await (await tPage.waitForSelector('button.is-new-block')).click(); await sleep(2500);
            await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.match(/Текст|Text/i))?.click());
            await sleep(4000);
            await tPage.keyboard.type(sr.bio, { delay: 1 });
            await sleep(2500);
            await ensureSaved(tPage);

            // LINKS (BASIC)
            const templates = [
                { k: 'profile_url', t: 'Official Showroom Profile' },
                { k: 'cars_url', t: 'Luxury Inventory for Sale' }
            ];
            for (const item of templates) {
                if (!sr[item.k]) continue;
                log(`Добавление ссылки: ${item.t}...`);
                await tPage.click('button.is-new-block'); await sleep(2500);
                await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.match(/Ссылка|Link/i))?.click());
                await sleep(4020);
                const inps = await tPage.$$('.modal-card-body input');
                if (inps.length >= 3) { await inps[0].type(item.t); await inps[2].type(sr[item.k]); }
                await ensureSaved(tPage);
            }

            // WHATSAPP
            if (sr.whatsapp) {
                log('Добавление WhatsApp...');
                await tPage.click('button.is-new-block'); await sleep(2000);
                await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.match(/Мессенджеры|Messengers/i))?.click());
                await sleep(3500);
                await tPage.evaluate(() => Array.from(document.querySelectorAll('.modal-card-body .item, span')).find(el => el.innerText?.match(/WhatsApp/i))?.click());
                await sleep(2500);
                const winp = await tPage.$('.modal-card-body input'); if (winp) await winp.type(sr.whatsapp);
                await ensureSaved(tPage);
            }

            log(`✅ [УСПЕХ] ${sr.name} Platinum готов.`);
            sr.taplink_published = true; fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
        } catch (e) { log(`❌ ОШИБКА: ${e.message}`); }
        finally { await browser.close(); await sleep(2000); }
    }
    log('\n🏁 PLATINUM ТЕСТ ЗАВЕРШЕН. Жду вашего решения по основному марафону!');
    readline.close();
}

run();
