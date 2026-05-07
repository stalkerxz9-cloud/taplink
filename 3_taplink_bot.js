import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';

import fs from 'fs';
import path from 'path';

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath    = path.join(process.cwd(), 'data', 'showrooms_data.json');
const configPath  = path.join(process.cwd(), 'config.json');
const proxiesPath = path.join(process.cwd(), 'proxies.txt');
const errorsDir   = path.join(process.cwd(), 'data', 'errors');
const logPath     = path.join(process.cwd(), 'data', 'bot_log.txt');

if (!fs.existsSync(errorsDir)) fs.mkdirSync(errorsDir, { recursive: true });

// Плагины
puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

// ─── Утилиты ──────────────────────────────────────────────────────────────────
function logToFile(msg) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const line = `[${time}] ${msg}\n`;
    fs.appendFileSync(logPath, line, 'utf-8');
    process.stdout.write(line); // Пишем в stdout вместо console.log (без буферизации)
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// Глобальный перехват ошибок — НЕ дадим процессу упасть
process.on('uncaughtException', (err) => {
    logToFile(`[UNCAUGHT] ${err.message}`);
});
process.on('unhandledRejection', (reason) => {
    logToFile(`[UNHANDLED] ${reason}`);
});

// ─── Прокси ───────────────────────────────────────────────────────────────────
let proxiesList = [];

function loadProxies() {
    if (fs.existsSync(proxiesPath)) {
        proxiesList = fs.readFileSync(proxiesPath, 'utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 5 && !l.startsWith('//'));
        logToFile(`Загружено ${proxiesList.length} прокси.`);
    }
}

function getRandomProxy() {
    if (proxiesList.length === 0) return null;
    const rnd = proxiesList[Math.floor(Math.random() * proxiesList.length)];
    const pts = rnd.split(':');
    if (pts.length === 4) return { ip: pts[0], port: pts[1], user: pts[2], pass: pts[3] };
    if (pts.length === 2) return { ip: pts[0], port: pts[1] };
    return null;
}

// ─── Почта (1secmail.cc) ──────────────────────────────────────────────────────
async function getVisualEmail(mailPage) {
    logToFile('--- ПОЛУЧЕНИЕ ПОЧТЫ ---');
    try {
        const url = await mailPage.url();
        if (!url.includes('1secmail.cc')) {
            await mailPage.goto('https://www.1secmail.cc/en/', { waitUntil: 'networkidle2', timeout: 60000 });
        } else {
            const oldEmail = await mailPage.$eval('#mainEmail', el => el.value).catch(() => '');
            await mailPage.click('#delete').catch(() => {});
            await sleep(2500);
            for (let i = 0; i < 10; i++) {
                const cur = await mailPage.$eval('#mainEmail', el => el.value).catch(() => '');
                if (cur && cur !== oldEmail && !cur.includes('...')) break;
                await sleep(1000);
            }
        }
        await mailPage.waitForSelector('#mainEmail', { timeout: 30000 });
        
        // Ждем пока 1secmail сгенерирует почту (уйдет "Loading.." и появится "@")
        await mailPage.waitForFunction(() => {
            const el = document.querySelector('#mainEmail');
            return el && el.value && el.value.includes('@') && !el.value.includes('Loading');
        }, { timeout: 20000 });

        const email = await mailPage.$eval('#mainEmail', el => el.value);
        logToFile(`Получен email: ${email}`);
        return email;
    } catch (e) {
        logToFile(`[ПОЧТА ОШИБКА] ${e.message}`);
        return null;
    }
}

async function getVisualCode(mailPage) {
    logToFile('Ожидаем письмо с кодом...');
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

            if (code) {
                logToFile(`Код найден: ${code}`);
                return code;
            }
        } catch (e) {
            logToFile(`[КОД ОШИБКА] ${e.message}`);
        }
        logToFile(`Попытка ${i + 1}/20...`);
    }
    logToFile('Код не получен.');
    return null;
}

// ─── Регистрация ──────────────────────────────────────────────────────────────
async function registerTaplink(tPage, mailPage, email, password) {
    logToFile(`Регистрация: ${email}`);
    await tPage.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    await tPage.waitForSelector('input:not([type="hidden"])', { timeout: 30000 });
    await tPage.type('input[type="email"]', email, { delay: 50 });

    // Кнопка "Продолжить"
    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /продолжить|далее|создать/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    // Подтверждение почты
    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"], a'))
            .find(b => /почта существует|да, все верно|продолжить/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    // Код из письма (если запрошен)
    const requiresCode = await tPage.evaluate(() => {
        return document.body.innerText.includes('проверочный код')
            || document.body.innerText.includes('код из письма')
            || !!document.querySelector('input[autocomplete="one-time-code"]');
    });

    if (requiresCode) {
        logToFile('Требуется код подтверждения...');
        const code = await getVisualCode(mailPage);
        if (!code) throw new Error('Код не получен');

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
        if (entered === 0) {
            const inp = await tPage.$('input');
            if (inp) await inp.type(code);
        }

        await tPage.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .find(b => /продолжить|далее/i.test(b.innerText || b.value || ''));
            if (btn) btn.click();
        });
        await sleep(6000);
    }

    // Пароль
    logToFile('Устанавливаем пароль...');
    await tPage.waitForSelector('input[type="password"]', { timeout: 15000 });
    const passes = await tPage.$$('input[type="password"]');
    for (const p of passes) await p.type(password, { delay: 50 });

    await tPage.evaluate(() => {
        const cb = document.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) {
            cb.click();
            if (!cb.checked) (cb.closest('label') || cb.parentElement)?.click();
        }
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /регистр|далее|войти|продолжить/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });

    logToFile('Регистрация отправлена, ожидаем дашборд...');
    await sleep(8000);
    return true;
}

// ─── Оформление профиля ───────────────────────────────────────────────────────
async function setupShowroom(page, sr) {
    const log = (m) => logToFile(`[${sr.name}] ${m}`);
    log('Начинаем оформление...');

    try {
        // 1. Username
        const currentUrl = await page.url();
        if (currentUrl.includes('profile/setup/')) {
            log('Установка username...');
            await page.waitForSelector('input[name="username"]', { timeout: 15000 }).catch(() => {});
            await page.type('input[name="username"]', sr.safe_name, { delay: 50 });
            await page.keyboard.press('Enter');
            await sleep(4000);
        }

        await page.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2', timeout: 60000 });

        // 2. Логотип — через input[type=file] напрямую
        log('Загрузка логотипа...');
        // Используем logo_local (скачанный логотип шоурума), либо первое фото как fallback
        const logoFile = sr.logo_local
                      || (sr.images_local && sr.images_local.length > 0 ? sr.images_local[0] : null);

        if (logoFile) {
            const fullLogoPath = path.resolve(process.cwd(), logoFile);
            if (fs.existsSync(fullLogoPath)) {
                const fileInput = await page.$('input[type="file"]');
                if (fileInput) {
                    await fileInput.uploadFile(fullLogoPath);
                    log('Логотип загружен.');
                    await sleep(3000);
                } else {
                    log('input[type=file] для логотипа не найден.');
                }
            } else {
                log(`Файл логотипа не найден: ${fullLogoPath}`);
            }
        }

        // 3. BIO
        log('Добавление BIO...');
        await page.evaluate(() => {
            const btn = document.querySelector('.btn-add-block, [data-testid="add-block"]');
            if (btn) btn.click();
        });
        await sleep(1500);
        await page.click('.block-type-text').catch(() => {});
        await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 10000 }).catch(() => {});
        const ta = await page.$('textarea');
        if (ta && sr.bio) await ta.type(sr.bio, { delay: 10 });
        await page.click('.btn-save, [data-testid="save-block"]').catch(() => {});
        await sleep(2000);

        // 4. Галерея — через uploadFile (избегаем waitForFileChooser)
        log('Добавление галереи...');
        const galleryImages = (sr.images_local || []).filter(img => !img.includes('logo')).slice(0, 10);
        if (galleryImages.length > 0) {
            await page.click('.btn-add-block').catch(() => {});
            await sleep(1000);
            const galleryBtn = await page.$('.block-type-gallery');
            if (galleryBtn) {
                await galleryBtn.click();
                await sleep(1000);
                for (const img of galleryImages) {
                    const fullPath = path.resolve(process.cwd(), img);
                    if (!fs.existsSync(fullPath)) continue;
                    const galleryInput = await page.$('input[type="file"]');
                    if (galleryInput) {
                        await galleryInput.uploadFile(fullPath);
                        await sleep(2000);
                    }
                }
                await page.click('.btn-save').catch(() => {});
            } else {
                log('Блок галереи недоступен (платный тариф?).');
            }
        }

        // 5. Кнопки-ссылки
        const links = [
            { title: 'Посмотреть на Auto.ae', url: sr.profile_url },
            { title: 'Каталог автомобилей',   url: sr.cars_url },
            { title: 'Аренда авто',            url: sr.rent_url },
            { title: 'Автомобильные номера',   url: sr.numbers_url },
            { title: 'Проданные авто',         url: sr.sold_url }
        ].filter(l => l.url);

        log(`Добавление ${links.length} кнопок-ссылок...`);
        for (const link of links) {
            await page.click('.btn-add-block').catch(() => {});
            await sleep(800);
            await page.waitForSelector('.block-type-link', { timeout: 5000 }).catch(() => {});
            await page.click('.block-type-link').catch(() => {});
            await page.waitForSelector('input[name="title"]', { timeout: 5000 }).catch(() => {});
            await page.type('input[name="title"]', link.title, { delay: 20 });
            await page.type('input[name="url"]',   link.url,   { delay: 20 });
            await page.click('.btn-save').catch(() => {});
            await sleep(1500);
        }

        // 6. WhatsApp
        if (sr.whatsapp && sr.whatsapp.length > 5) {
            log('Добавление WhatsApp...');
            await page.click('.btn-add-block').catch(() => {});
            await sleep(800);
            await page.click('.block-type-link').catch(() => {});
            await page.waitForSelector('input[name="title"]', { timeout: 5000 }).catch(() => {});
            await page.type('input[name="title"]', 'Связаться в WhatsApp', { delay: 20 });
            await page.type('input[name="url"]', sr.whatsapp, { delay: 20 });
            await page.click('.btn-save').catch(() => {});
            await sleep(1500);
        }

        // 7. ФОНОВОЕ ИЗОБРАЖЕНИЕ — загружаем в раздел дизайна
        const bgFile = sr.background_local
                    || (sr.images_local && sr.images_local.length > 0 ? sr.images_local[0] : null);

        if (bgFile) {
            const fullBgPath = path.resolve(process.cwd(), bgFile);
            if (fs.existsSync(fullBgPath)) {
                log('Установка фона (раздел дизайна)...');
                try {
                    await page.goto('https://taplink.ru/profile/settings/design/', {
                        waitUntil: 'networkidle2', timeout: 30000
                    });
                    await sleep(2000);

                    // Кликаем на "Своё изображение" / "Загрузить фон"
                    const bgBtn = await page.evaluate(() => {
                        const btns = Array.from(document.querySelectorAll('button, label, div[role="button"]'));
                        const found = btns.find(b =>
                            /своё|свой|фон|загруз|background|upload|image/i.test(b.innerText || b.getAttribute('aria-label') || '')
                        );
                        if (found) { found.click(); return true; }
                        return false;
                    });

                    await sleep(1000);

                    // Загружаем файл через input[type=file]
                    const bgInput = await page.$('input[type="file"]');
                    if (bgInput) {
                        await bgInput.uploadFile(fullBgPath);
                        await sleep(3000);

                        // Нажимаем "Сохранить"
                        await page.evaluate(() => {
                            const btn = Array.from(document.querySelectorAll('button'))
                                .find(b => /сохран|save|применить/i.test(b.innerText || ''));
                            if (btn) btn.click();
                        });
                        await sleep(2000);
                        log('Фон установлен.');
                    } else {
                        log('input[type=file] для фона не найден — пропускаем.');
                    }
                } catch (e) {
                    log(`[ФОН] Ошибка: ${e.message}`);
                }
            }
        }

        log('Оформление завершено.');
        return true;
    } catch (e) {
        log(`[ОШИБКА ОФОРМЛЕНИЯ] ${e.message}`);
        return false;
    }
}

// ─── Браузер ──────────────────────────────────────────────────────────────────
async function launchNewBrowser() {
    const proxy = getRandomProxy();
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1280,800',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
    ];
    if (proxy) args.push(`--proxy-server=${proxy.ip}:${proxy.port}`);

    logToFile(`[БРАУЗЕР] Запуск... ${proxy ? `Proxy: ${proxy.ip}` : 'без прокси'}`);
    const browser = await puppeteer.launch({
        headless: false,
        args,
        defaultViewport: null,
        protocolTimeout: 120000, // 2 мин таймаут протокола вместо дефолтных 30 сек
    });

    const mPage = await browser.newPage();
    if (proxy?.user) {
        await mPage.authenticate({ username: proxy.user, password: proxy.pass });
    }
    return { browser, proxy, mPage };
}

// ─── ГЛАВНЫЙ ЦИКЛ ─────────────────────────────────────────────────────────────
async function run() {
    logToFile('=== ЗАПУСК БОТА ===');
    if (!fs.existsSync(dataPath)) {
        logToFile('Нет файла данных!');
        return;
    }

    let showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    loadProxies();

    const PASS       = 'SecureShowroom#2024';
    const BATCH_SIZE = 5; // Уменьшили с 10 до 5 для стабильности

    let browserCtx = null;
    let procCount  = 0;

    for (let i = 0; i < showrooms.length; i++) {
        const sr = showrooms[i];
        if (sr.taplink_created && sr.taplink_designed) continue;

        // Ротация браузера каждые BATCH_SIZE шоурумов
        if (!browserCtx || procCount >= BATCH_SIZE) {
            if (browserCtx) {
                await browserCtx.browser.close().catch(() => {});
                await sleep(3000); // Пауза между браузерами
            }
            browserCtx = await launchNewBrowser();
            procCount  = 0;
        }

        logToFile(`\n>>> [${i + 1}/${showrooms.length}] ${sr.name}`);
        let success  = false;
        let attempts = 0;

        while (!success && attempts < 3) {
            attempts++;
            procCount++;

            // Проверка живости браузера
            try {
                await browserCtx.browser.version();
            } catch {
                logToFile('Браузер упал. Перезапуск...');
                browserCtx = await launchNewBrowser();
                procCount  = 0;
            }

            let tPage = null;
            try {
                const mailPage = browserCtx.mPage;
                const email    = await getVisualEmail(mailPage);
                if (!email) throw new Error('Не удалось получить email');

                tPage = await browserCtx.browser.newPage();
                if (browserCtx.proxy?.user) {
                    await tPage.authenticate({
                        username: browserCtx.proxy.user,
                        password: browserCtx.proxy.pass
                    });
                }

                await tPage.bringToFront();

                let registered = sr.taplink_created;

                if (!registered) {
                    registered = await registerTaplink(tPage, mailPage, email, PASS);
                    if (registered) {
                        sr.taplink_created = true;
                        sr.taplink_url     = `https://taplink.cc/${sr.safe_name}`;
                        sr.taplink_email   = email;
                        sr.taplink_pass    = PASS;
                    }
                } else {
                    logToFile(`[SKIP REG] ${sr.name} — уже зарегистрирован.`);
                    await tPage.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2' });

                    const url = await tPage.url();
                    if (url.includes('/auth/login/')) {
                        logToFile(`Логин для ${sr.name}...`);
                        if (sr.taplink_email && sr.taplink_pass) {
                            await tPage.waitForSelector('input[type="email"]', { timeout: 10000 });
                            await tPage.type('input[type="email"]',    sr.taplink_email, { delay: 50 });
                            await tPage.type('input[type="password"]', sr.taplink_pass,  { delay: 50 });
                            await tPage.click('button[type="submit"], .btn-primary').catch(() => {});
                            await sleep(6000);
                        } else {
                            throw new Error('Нет данных для входа');
                        }
                    }
                    registered = true;
                }

                if (registered) {
                    const designed = await setupShowroom(tPage, sr);
                    if (designed) {
                        sr.taplink_designed = true;
                        success = true;
                    }
                }
            } catch (e) {
                logToFile(`[ОШИБКА] "${sr.name}" (попытка ${attempts}): ${e.message}`);
            } finally {
                if (tPage) await tPage.close().catch(() => {});
            }

            if (success) {
                fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
                logToFile(`[OK] ${sr.name} готов.`);
            } else if (attempts < 3) {
                await sleep(5000);
            }
        }

        if (!success) {
            logToFile(`[ПРОПУСК] ${sr.name} — 3 попытки не удались.`);
        }
    }

    if (browserCtx) await browserCtx.browser.close().catch(() => {});
    logToFile('=== ГОТОВО ===');
}

run();
