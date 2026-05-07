import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';

import fs from 'fs';
import path from 'path';

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath    = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath     = path.join(process.cwd(), 'data', 'test_v22_log.txt');

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
    log(`[БРАУЗЕР] Запуск...`);
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
        await mailPage.goto('https://www.1secmail.cc/en/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(5000); 
        await mailPage.waitForFunction(() => {
            const el = document.querySelector('#mainEmail');
            return el && el.value && el.value.includes('@');
        }, { timeout: 15000 });
        const email = await mailPage.$eval('#mainEmail', el => el.value);
        if (email) { log(`Получен email: ${email}`); return email; }
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
        } catch (e) { }
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
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]')).find(b => /продолжить|далее|next/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    // ПОЧТА СУЩЕСТВУЕТ (Safe handler)
    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"], a')).find(b => /почта существует|да, все верно|yes|continue/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    const requiresCode = await tPage.evaluate(() => document.body.innerText.includes('код') || !!document.querySelector('input[autocomplete="one-time-code"]'));
    if (requiresCode) {
        const code = await getVisualCode(mailPage);
        if (code) {
            await tPage.bringToFront();
            const inputs = await tPage.$$('input:not([type="hidden"])');
            let entered = 0;
            for (const inp of inputs) {
                if (entered >= 6) break;
                await inp.focus(); await inp.type(code[entered], { delay: 100 }); entered++;
            }
            await sleep(1000);
            await tPage.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, .button')).find(b => /продолжить|next|continue|далее/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(7000);
        }
    }

    try {
        await tPage.waitForSelector('input[type="password"]', { timeout: 15000 });
        const passes = await tPage.$$('input[type="password"]');
        for (const p of passes) await p.type(password, { delay: 50 });
        
        await tPage.evaluate(() => {
            const cb = document.querySelector('input[type="checkbox"], .checkbox, [class*="check"]');
            if (cb) cb.click();
            const label = Array.from(document.querySelectorAll('label, span')).find(el => el.innerText?.match(/подтверждаю|согласен|agree/i));
            if (label) label.click();
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]')).find(b => /регистр|войти|создать|next|continue|продолжить|далее/i.test(b.innerText || b.value || ''));
            if (btn) btn.click();
        });
        
        log('Ожидаем переход...');
        await sleep(12000);
        
        if (tPage.url().includes('/signup/')) {
            log('⚠️ Похоже, кнопка не нажалась. Пробуем клик по координатам...');
            await tPage.mouse.click(400, 720); 
            await sleep(10000);
        }
        
    } catch(e) {
        log(`❌ ОШИБКА РЕГИСТРАЦИИ: ${e.message}`);
        return false;
    }
    return true;
}

async function ensureSaved(page) {
    for (let i = 0; i < 5; i++) {
        const ok = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, .is-primary')).find(b => /сохранить|готово|save|done/i.test(b.innerText || ''));
            if (btn) { btn.click(); return true; }
            return false;
        });
        await sleep(3000);
        const modalVisible = await page.evaluate(() => !!document.querySelector('.modal-card, .modal.is-active'));
        if (!modalVisible) return true;
    }
}

async function run() {
    let showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const readline = (await import('readline')).createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => {
        readline.question('\n⚠️ СБРОСИТЬ ПРОГРЕСС? (y/N): ', ans => r(ans.toLowerCase()));
    });
    if (answer === 'y' || answer === 'д') {
        showrooms.forEach(s => { s.taplink_created = false; s.taplink_published = false; s.taplink_url = ''; });
        fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
    }
    for (let i = 0; i < 2; i++) {
        const sr = showrooms[i];
        log(`\n[${i+1}/2] >>> ${sr.name}`);
        const { browser, mPage } = await launchNewBrowser();
        const tPage = await browser.newPage();
        try {
            const email = await getVisualEmail(mPage);
            if (!email) { await browser.close(); continue; }
            const success = await registerTaplink(tPage, mPage, email, 'SecureShowroom#2024');
            if (!success) { await browser.close(); continue; }
            await sleep(5000);

            // ШАБЛОН (Original 10.04 Coordinates)
            if ((await tPage.url()).includes('/templates/')) {
                log('Выбор шаблона (10.04 method)...');
                await tPage.mouse.click(372, 238); await sleep(3000); 
                await tPage.mouse.click(460, 549); await sleep(5000); 
                await tPage.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button, div, span')).find(el => el.innerText?.trim() === 'Да' || el.innerText?.trim() === 'Yes');
                    if (btn) btn.click();
                });
                await sleep(10000);
            }

            // ШАГ 1: АВАТАР (10.04)
            const logoPath = sr.logo_local || `data/${sr.safe_name}/logo.jpg`;
            if (fs.existsSync(logoPath)) {
                log('Загрузка Логотипа...');
                await tPage.waitForSelector('button.is-new-block', { timeout: 20000 });
                await tPage.click('button.is-new-block'); await sleep(2500);
                await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Аватар') || el.innerText?.includes('Avatar'))?.click());
                await sleep(4000);
                const fileInp = await tPage.$('input[type="file"]');
                if (fileInp) await fileInp.uploadFile(path.resolve(logoPath));
                await sleep(7000); await ensureSaved(tPage);
            }

            // ШАГ 2: БАННЕР (10.04)
            if (sr.images_local && sr.images_local.length > 0) {
                const bannerPath = path.resolve(process.cwd(), sr.images_local[0]);
                if (fs.existsSync(bannerPath)) {
                    log('Загрузка Баннера...');
                    await tPage.click('button.is-new-block'); await sleep(2500);
                    await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Баннер') || el.innerText?.includes('Banner'))?.click());
                    await sleep(4000);
                    // Закрываем PRO если вылез
                    const isPro = await tPage.evaluate(() => document.body.innerText.includes('PRO') || !!document.querySelector('.is-pro-label'));
                    if (isPro) {
                        log('⚠️ Баннер заблокирован PRO. Пробуем "Image" (Картинка)...');
                        await tPage.keyboard.press('Escape'); await sleep(2000);
                        await tPage.click('button.is-new-block'); await sleep(2500);
                        await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Картинка') || el.innerText?.includes('Image'))?.click());
                        await sleep(4000);
                    }
                    const bInp = await tPage.$('input[type="file"]');
                    if (bInp) await bInp.uploadFile(bannerPath);
                    await sleep(8000); await ensureSaved(tPage);
                }
            }

            // ШАГ 3: ПОДЗАГОЛОВОК + БИО
            log('Добавление Подзаголовка и Bio...');
            await tPage.click('button.is-new-block'); await sleep(2500);
            await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Текст') || el.innerText?.includes('Text'))?.click());
            await sleep(4000);
            // Подзаголовок (Жирным)
            await tPage.keyboard.type('Official Showroom Information\n\n', { delay: 1 });
            await tPage.keyboard.type(sr.bio, { delay: 1 });
            await sleep(2000); await ensureSaved(tPage);

            // ШАГ 4: ПОДЗАГОЛОВОК ДЛЯ ССЫЛОК
            log('Добавление Заголовка для ссылок...');
            await tPage.click('button.is-new-block'); await sleep(2500);
            await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Текст') || el.innerText?.includes('Text'))?.click());
            await sleep(4000);
            await tPage.keyboard.type('Catalog & Inventory', { delay: 1 });
            await ensureSaved(tPage);

            // ШАГ 5: ВСЕ ССЫЛКИ
            const linksToAdd = [
                { t: 'Showroom Official Catalog', link: sr.profile_url },
                { t: 'Current Stock - Cars for Sale', link: sr.cars_url }
            ];
            for (const item of linksToAdd) {
                if (!item.link) continue;
                log(`Добавление ссылки: ${item.t}...`);
                await tPage.click('button.is-new-block'); await sleep(2500);
                await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Ссылка') || el.innerText?.includes('Link'))?.click());
                await sleep(4000);
                const inps = await tPage.$$('.modal-card-body input');
                if (inps.length >= 3) {
                    await inps[0].type(item.t);
                    await inps[2].type(item.link);
                }
                await ensureSaved(tPage);
            }

            sr.taplink_published = true; fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
            log('✅ УСПЕХ: Профиль с подзаголовками готов.');
        } catch (e) { log(`❌ ОШИБКА: ${e.message}`); }
        finally { await browser.close(); await sleep(2000); }
    }
    readline.close();
}
run();
