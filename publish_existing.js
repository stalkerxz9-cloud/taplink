import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, 'data', 'showrooms_data.json');
const PASS = 'SecureShowroom#2024';

function log(msg) {
    const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    console.log(`[${time}] ${msg}`);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function loginAndPublish(browser, sr) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    try {
        log(`\n▶ [${sr.name}] Вход через ${sr.taplink_email}...`);

        // Очищаем куки
        const client = await page.target().createCDPSession();
        await client.send('Network.clearBrowserCookies');

        // Переходим на страницу входа
        await page.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(3000);

        // Переключаемся на вкладку "Авторизация"
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('a, button, span, .tabs li'))
                .filter(el => /авторизация|вход|login|sign in/i.test(el.innerText || ''));
            if (tabs.length > 0) tabs[0].click();
        });
        await sleep(2000);

        // Вводим email
        await page.waitForSelector('input[type="email"], input[name="email"]', { visible: true, timeout: 15000 });
        await page.type('input[type="email"], input[name="email"]', sr.taplink_email, { delay: 50 });

        // Проверяем — есть ли поле пароля сразу
        const pwdImmediate = await page.$('input[type="password"], input[name="password"]');
        if (pwdImmediate) {
            await pwdImmediate.type(PASS, { delay: 50 });
            await page.keyboard.press('Enter');
        } else {
            // Двухшаговый логин — жмём "Продолжить"
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                    .find(b => /продолжить|далее|next|войти/i.test(b.innerText || b.value || ''));
                if (btn) btn.click();
            });
            await sleep(3000);
            await page.keyboard.press('Enter');
            await sleep(4000);

            // Проверяем — не удалён ли аккаунт
            const deleted = await page.evaluate(() =>
                document.body.innerText.toLowerCase().includes('почтовый ящик не существует') ||
                document.body.innerText.toLowerCase().includes('не найден')
            );
            if (deleted) {
                log(`   ❌ Аккаунт удалён: ${sr.taplink_email}`);
                await page.close();
                return false;
            }

            // Вводим пароль
            await page.waitForSelector('input[type="password"], input[name="password"]', { visible: true, timeout: 15000 });
            await page.type('input[type="password"], input[name="password"]', PASS, { delay: 50 });
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => /войти|продолжить|далее|login/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(2000);
            await page.keyboard.press('Enter');
        }

        await sleep(6000);

        // Проверяем — залогинились ли
        const loggedIn = await page.evaluate(() =>
            !!document.querySelector('.profile-menu, a[href*="logout"], .is-new-block')
            || !window.location.href.includes('auth')
        );

        if (!loggedIn) {
            log(`   ❌ Не удалось войти для ${sr.name}`);
            await page.close();
            return false;
        }

        log(`   ✅ Вошли в аккаунт!`);

        // Переходим в профиль
        await page.goto('https://taplink.ru/profile/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(4000);

        // Ищем текущую ссылку профиля
        const currentUrl = await page.evaluate(() => {
            const aTags = Array.from(document.querySelectorAll('a'))
                .filter(a => a.href && a.href.includes('taplink.cc/'));
            if (aTags.length > 0) return aTags[0].href.trim();
            const matches = document.body.innerText.match(/https?:\/\/taplink\.cc\/[A-Za-z0-9_.-]+/i);
            return matches ? matches[0] : null;
        });

        if (currentUrl) {
            log(`   📎 Текущая ссылка профиля: ${currentUrl}`);
        }

        // Ищем и жмём кнопку "Опубликовать"
        const published = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, .button, a'));
            const pubBtn = btns.find(b => {
                const t = (b.innerText || '').trim().toLowerCase();
                return t === 'опубликовать' || t === 'publish';
            });
            if (pubBtn && pubBtn.offsetWidth > 0) {
                pubBtn.click();
                return true;
            }
            return false;
        });

        if (published) {
            log(`   📢 Нажата кнопка "Опубликовать"`);
            await sleep(5000);
            // Закрываем QR-popup если появился
            await page.keyboard.press('Escape').catch(() => {});
            await sleep(1000);
        } else {
            log(`   ℹ️ Кнопка "Опубликовать" не найдена — профиль уже опубликован или нет кнопки`);
        }

        // Получаем финальную ссылку ещё раз
        const finalUrl = await page.evaluate(() => {
            const aTags = Array.from(document.querySelectorAll('a'))
                .filter(a => a.href && a.href.includes('taplink.cc/'));
            if (aTags.length > 0) return aTags[0].href.trim();
            const matches = document.body.innerText.match(/https?:\/\/taplink\.cc\/[A-Za-z0-9_.-]+/i);
            return matches ? matches[0] : null;
        });

        await page.close();
        return finalUrl || currentUrl || sr.taplink_url;

    } catch (e) {
        log(`   ❌ Ошибка: ${e.message}`);
        await page.close().catch(() => {});
        return false;
    }
}

async function run() {
    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    // Берём только НЕ опубликованных, у которых ЕСТЬ email
    const targets = showrooms.filter(s => !s.taplink_published && s.taplink_email);
    log(`🚀 Найдено ${targets.length} профилей с email для публикации:`);
    targets.forEach((s, i) => log(`   ${i+1}. ${s.name} | ${s.taplink_email} | ${s.taplink_url || '—'}`));

    if (targets.length === 0) {
        log('✅ Нечего делать!');
        return;
    }

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--window-size=1280,900']
    });

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
        const sr = targets[i];
        log(`\n[${i+1}/${targets.length}] Обрабатываем: ${sr.name}`);

        const result = await loginAndPublish(browser, sr);

        if (result) {
            // Обновляем в JSON
            const idx = showrooms.findIndex(s => s.name === sr.name);
            if (idx !== -1) {
                showrooms[idx].taplink_published = true;
                if (typeof result === 'string') {
                    showrooms[idx].taplink_url = result;
                }
                fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
            }
            log(`   ✅ ГОТОВО: ${sr.name} → ${result}`);
            fixed++;
        } else {
            log(`   ❌ ПРОПУЩЕН: ${sr.name}`);
            failed++;
        }

        await sleep(3000);
    }

    await browser.close();

    log(`\n═══════════════════════════════════`);
    log(`✅ Опубликовано: ${fixed}`);
    log(`❌ Не удалось:  ${failed}`);
    log(`═══════════════════════════════════`);
}

run();
