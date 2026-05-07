import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';

import fs from 'fs';
import path from 'path';

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath    = path.join(process.cwd(), 'data', 'showrooms_data.json');
const proxiesPath = path.join(process.cwd(), 'proxies.txt');
const logPath     = path.join(process.cwd(), 'data', 'bot_log.txt');

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

function log(msg) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logPath, line + '\n', 'utf-8');
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

process.on('uncaughtException', (err) => log(`[UNCAUGHT] ${err.message}`));
process.on('unhandledRejection', (reason) => log(`[UNHANDLED] ${reason}`));

// ─── Прокси ───────────────────────────────────────────────────────────────────
let proxiesList = [];
function loadProxies() {
    if (fs.existsSync(proxiesPath)) {
        proxiesList = fs.readFileSync(proxiesPath, 'utf-8')
            .split('\n').map(l => l.trim()).filter(l => l.length > 5 && !l.startsWith('//'));
        log(`Загружено ${proxiesList.length} прокси.`);
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

// ─── Браузер ──────────────────────────────────────────────────────────────────
async function launchNewBrowser() {
    const proxy = getRandomProxy();
    const args = [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--window-size=1280,800', '--disable-extensions'
    ];
    if (proxy) args.push(`--proxy-server=${proxy.ip}:${proxy.port}`);

    log(`[БРАУЗЕР] Запуск... ${proxy ? `Proxy: ${proxy.ip}` : 'без прокси'}`);
    const browser = await puppeteer.launch({
        headless: false,
        args,
        // ОЧЕНЬ ВАЖНО: Фиксируем viewport на 1280х800, чтобы координаты "Золотой версии" идеально падали
        defaultViewport: { width: 1280, height: 800 }, 
        protocolTimeout: 120000,
    });

    const mPage = await browser.newPage();
    if (proxy?.user) {
        await mPage.authenticate({ username: proxy.user, password: proxy.pass });
    }
    return { browser, proxy, mPage };
}

// ─── Почта (1secmail.cc) ──────────────────────────────────────────────────────
async function getVisualEmail(mailPage) {
    log('--- ПОЛУЧЕНИЕ ПОЧТЫ ---');
    try {
        const url = await mailPage.url();
        if (!url.includes('1secmail.cc')) {
            await mailPage.goto('https://www.1secmail.cc/en/', { waitUntil: 'domcontentloaded', timeout: 60000 });
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
        await mailPage.waitForFunction(() => {
            const el = document.querySelector('#mainEmail');
            return el && el.value && el.value.includes('@') && !el.value.includes('Loading');
        }, { timeout: 20000 });

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
        log(`Попытка получения кода ${i + 1}/20...`);
    }
    log('Код не получен.');
    return null;
}

// ─── Регистрация Taplink ───────────────────────────────────────────────────────
async function registerTaplink(tPage, mailPage, email, password) {
    log(`Регистрация аккаунта: ${email}`);
    await tPage.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });

    await tPage.waitForSelector('input:not([type="hidden"])', { timeout: 30000 });
    await tPage.type('input[type="email"]', email, { delay: 50 });

    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /продолжить|далее|создать/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"], a'))
            .find(b => /почта существует|да, все верно|продолжить/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    const requiresCode = await tPage.evaluate(() => {
        return document.body.innerText.includes('проверочный код')
            || document.body.innerText.includes('код из письма')
            || !!document.querySelector('input[autocomplete="one-time-code"]');
    });

    if (requiresCode) {
        log('Требуется код подтверждения...');
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

    log('Устанавливаем пароль...');
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

    log('Регистрация отправлена, ожидаем дашборд...');
    await sleep(8000);
    return true;
}

// ─── Вспомогательные функции Золотой Версии ──────────────────────────────────
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

async function addSeparator(page) {
    await page.click('button.is-new-block'); await sleep(1500);
    await page.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Разделитель'))?.click());
    await sleep(2000); await ensureSaved(page); 
}

// ─── ГЛАВНЫЙ ЦИКЛ БОТА ────────────────────────────────────────────────────────
async function run() {
    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const total = showrooms.length;
    
    log(`🏁 СТАРТ ГЛОБАЛЬНОГО МАРАФОНА (С РЕГИСТРАЦИЕЙ): ${total} шоурумов.`);
    loadProxies();

    const PASS = 'SecureShowroom#2024';
    const BATCH_SIZE = 1; // Ставим 1, чтобы каждый аккаунт шел в СОВЕРШЕННО чистом браузере

    let browserCtx = null;
    let procCount = 0;
    let successTotal = 0; 

    for (let index = 0; index < total; index++) {
        const sr = showrooms[index];
        
        // Мануальный пропуск по просьбе пользователя
        const sn = (sr.safe_name || '').toLowerCase();
        const nm = (sr.name || '').toLowerCase();
        if (sn.includes('4matic') || nm.includes('4matic') || sn.includes('piple') || nm.includes('piple')) {
            log(`[SKIP] Пропускаем ${sr.name || sr.safe_name} (запрещенный список).`);
            continue;
        }

        // Для теста связки: ВКЛЮЧАЕМ пропуск уже готовых, чтобы найти две НОВЫЕ цели
        if (sr.taplink_published) continue; 

        log(`\n[${index + 1}/${total}] >>> 🏎️ ЦЕЛЬ: ${sr.name || sr.safe_name || 'БЕЗ ИМЕНИ'}`);
        log(`   Директория данных: data/${sr.safe_name || 'Unknown'}`);
        
        if (!browserCtx || procCount >= BATCH_SIZE) {
            if (browserCtx) {
                await browserCtx.browser.close().catch(() => {});
                await sleep(3000);
            }
            browserCtx = await launchNewBrowser();
            procCount = 0;
        }

        let success = false;
        let attempts = 0;

        while (!success && attempts < 3) {
            attempts++;
            procCount++;
            let tPage = null;

            try {
                // Если браузер упал
                await browserCtx.browser.version().catch(async () => {
                    log('Браузер упал. Перезапуск...');
                    browserCtx = await launchNewBrowser();
                    procCount = 0;
                });

                const mailPage = browserCtx.mPage;
                let registered = sr.taplink_created;
                let email = sr.taplink_email;

                // ── РЕГИСТРАЦИЯ (ИЛИ ЛОГИН) ──
                if (!registered) {
                    await mailPage.bringToFront();
                    email = await getVisualEmail(mailPage);
                    if (!email) throw new Error('Не удалось получить email');
                }

                tPage = await browserCtx.browser.newPage();
                if (browserCtx.proxy?.user) {
                    await tPage.authenticate({ username: browserCtx.proxy.user, password: browserCtx.proxy.pass });
                }
                await tPage.bringToFront();

                if (!registered) {
                    
                    registered = await registerTaplink(tPage, mailPage, email, PASS);
                    if (registered) {
                        sr.taplink_created = true;
                        sr.taplink_url     = `https://taplink.cc/${sr.safe_name}`;
                        sr.taplink_email   = email;
                        sr.taplink_pass    = PASS;
                        fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
                    }
                } else {
                    log(`Вход в профиль: ${sr.taplink_email}`);
                    await tPage.goto('https://taplink.ru/profile/auth/signin/', { waitUntil: 'domcontentloaded' });
                    await sleep(3000);
                    if ((await tPage.url()).includes('/auth/signin')) {
                        await (await tPage.waitForSelector('input[type="email"]')).type(sr.taplink_email);
                        await tPage.keyboard.press('Enter'); await sleep(2500);
                        await (await tPage.waitForSelector('input[type="password"]')).type(sr.taplink_pass);
                        await tPage.keyboard.press('Enter'); await sleep(8000);
                    } else {
                        log(`Уже авторизованы, пропускаем ввод пароля...`);
                    }
                }

                // ── ЗОЛОТАЯ ВЕРСИЯ ОФОРМЛЕНИЯ ОДНОГО ПРОФИЛЯ ──
                if (registered) {
                    log('Запуск "Золотой версии" дизайна (от 8 апреля)...');
                    
                    // =========================================================================
                    // ПРОБИВАЕМ ИИ-ШАБЛОН
                    // =========================================================================
                    const afterUrl = await tPage.url();
                    if (afterUrl.includes('/templates/')) {
                        log('Обнаружен экран выбора шаблона. Пробиваем "Пустой шаблон"...');
                        async function hardwareClick(text) {
                            await tPage.evaluate((txt) => {
                                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                                let n;
                                while (n = walker.nextNode()) {
                                    if (n.nodeValue.trim().toLowerCase() === txt.toLowerCase()) {
                                        const rect = n.parentElement.getBoundingClientRect();
                                        window.scrollTo(0, rect.top + window.scrollY - window.innerHeight / 2);
                                        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                                    }
                                }
                                return null;
                            }, text).then(async (pos) => {
                                if (pos) { await tPage.mouse.click(pos.x, pos.y); }
                            });
                        }
                        
                        await sleep(3000); 
                        await hardwareClick('Мобильные сайты'); await sleep(3000);
                        await hardwareClick('Пустой шаблон'); await sleep(3000);
                        await hardwareClick('Да'); await sleep(6000);

                        await tPage.mouse.click(10, 10); await sleep(1000);
                        
                        // Не пытаемся удалить дефолтный аватар через DOM (React вернет его), просто будем его редактировать!
                        await sleep(1000);
                    }
                    // =========================================================================

                    const srDir = path.resolve(process.cwd(), 'data', sr.safe_name);

                    // 1. АВАТАР И ОБЛОЖКА (Редактируем существующий блок)
                    const logo = path.join(srDir, 'logo.jpg');
                    if (fs.existsSync(logo)) {
                        log('Загрузка Аватара (через редактирование существующего блока)...');
                        const avatarBtn = await tPage.$('.btn-link-block, .block-elem');
                        if (avatarBtn) { 
                            await avatarBtn.click(); 
                        } else {
                            await (await tPage.waitForSelector('button.is-new-block')).click(); await sleep(2500);
                            await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Аватар'))?.click());
                        }

                        await sleep(4000);
                        
                        log('   Устанавливаем квадратный дизайн (JS Injection)...');
                        await tPage.evaluate(() => {
                            const simClick = (el) => {
                                el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, cancelable: true}));
                                el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, cancelable: true}));
                                el.click();
                            };
                            
                            // Проверяем, что модалка вообще открылась (ищем заголовок)
                            const header = Array.from(document.querySelectorAll('h1, h2, .modal-card-title, .title')).find(el => el.innerText?.includes('Аватар'));
                            if (!header) console.log('WARN: Заголовок "Аватар" не найден, возможно модалка не открылась');

                            const options = document.querySelectorAll('.avatar-type-toggle .blue-toggle');
                            if (options.length >= 2) {
                                simClick(options[1]); 
                            } else {
                                const labels = Array.from(document.querySelectorAll('label')).filter(l => l.querySelector('svg, img'));
                                if (labels.length >= 2) simClick(labels[1]);
                            }
                        });
                        await sleep(2500);

                        log('   Загрузка ЛОГО (тихая загрузка файла, БЕЗ окон!)...');
                        const fullLogoPath = path.resolve(process.cwd(), logo);
                        const fileInputs = await tPage.$$('input[type="file"]');
                        if (fileInputs.length > 0) {
                            await fileInputs[0].uploadFile(fullLogoPath);
                            await sleep(4000);
                            await tPage.evaluate(() => {
                                const btns = Array.from(document.querySelectorAll('button')).filter(el => (el.innerText || '').toLowerCase().includes('загрузить'));
                                if (btns.length > 0) btns[btns.length - 1].click();
                            });
                        }
                        await sleep(6500);

                        log('   Кликаем иконку "Галерея" рядом с "Обложка" (Proximity Search)...');
                        const hit = await tPage.evaluate(() => {
                            const simClick = (el) => {
                                el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                                el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                                el.click();
                            };

                            // Находим текст "Обложка" (игнорируя лишние пробелы)
                            const labels = Array.from(document.querySelectorAll('div, span, label, p')).filter(el => {
                                const t = (el.innerText || '').trim().toLowerCase();
                                return t === 'обложка' || t === 'обложка:';
                            });
                            const targetLabel = labels[0];

                            if (targetLabel) {
                                const rect = targetLabel.getBoundingClientRect();
                                const btns = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(b => {
                                    const bRect = b.getBoundingClientRect();
                                    const sameHeight = Math.abs(bRect.top - rect.top) < 60; // чуть больше допуск
                                    const toTheRight = bRect.left > rect.left;
                                    return sameHeight && toTheRight;
                                });
                                
                                // Ищем кнопку по тултипу или иконке fa-images (как на скриншоте)
                                const galleryBtn = btns.find(b => {
                                    const tooltip = (b.getAttribute('data-tooltip') || b.title || '').toLowerCase();
                                    const hasIcon = b.querySelector('.fa-images, .icon-image-gallery, [class*="gallery"], [class*="images"]');
                                    return tooltip.includes('галере') || hasIcon;
                                });

                                if (galleryBtn) {
                                    simClick(galleryBtn);
                                    return 'SUCCESS_BY_PROXIMITY (fa-images)';
                                }
                            }
                            
                            const icons = document.querySelectorAll('.fa-images, .icon-image-gallery, [class*="icon-gallery"]');
                            if (icons.length >= 2) {
                                simClick(icons[1].closest('button, div[role="button"]') || icons[1]);
                                return 'SUCCESS_BY_ICON_INDEX (target 2nd)';
                            }
                            return 'FAILED: Not found';
                        });
                        log(`      Результат: ${hit}`);
                        await sleep(6500); 

                        log('   Выбираем ночной город (Visual Grid Sorting - index 7)...');
                        const picResult = await tPage.evaluate(() => {
                            const simClick = (el) => {
                                el.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
                                el.dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
                                el.click();
                            };

                            // Собираем все картинки
                            let pics = Array.from(document.querySelectorAll('.pictures-library .lazy, .pictures-library img, .gallery-item'))
                                .filter(el => {
                                    const r = el.getBoundingClientRect();
                                    return r.width > 30 && r.height > 30; // Только реальные картинки
                                });
                            
                            // Сортируем визуально: Сначала Строки (Y), потом Колонки (X)
                            pics.sort((a, b) => {
                                const ra = a.getBoundingClientRect();
                                const rb = b.getBoundingClientRect();
                                if (Math.abs(ra.top - rb.top) > 30) return ra.top - rb.top;
                                return ra.left - rb.left;
                            });

                            // Ночной город (Бурдж Халифа) — это 8-я картинка (индекс 7)
                            if (pics.length >= 8) {
                                simClick(pics[7]); 
                                const r = pics[7].getBoundingClientRect();
                                return `SUCCESS: Clicked visual #8 (Night City) at [${Math.round(r.left)}, ${Math.round(r.top)}]`;
                            } else if (pics.length > 0) {
                                // Фолбэк на 5-ю (индекс 4), если вдруг список короче
                                const idx = Math.min(pics.length - 1, 4);
                                simClick(pics[idx]);
                                return `WARNING: Only ${pics.length} pics found, clicked index ${idx}`;
                            }
                            return 'FAILED: No pics found';
                        });
                        log(`      ${picResult}`);
                        await sleep(4000);
                        
                        await ensureSaved(tPage); 
                    }

                    await addSeparator(tPage);

                    // 2. BIO (Dynamic & Unique)
                    await tPage.click('button.is-new-block'); await sleep(3000);
                    await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Текст'))?.click());
                    await sleep(5000);
                    const editor = await tPage.waitForSelector('textarea, [contenteditable="true"]');
                    await editor.click(); 
                    
                    const bioTemplates = [
                        `Добро пожаловать в ${sr.name}! Мы предлагаем лучший выбор премиальных автомобилей напрямую из ОАЭ. Гарантия качества и полная поддержка при экспорте.`,
                        `Шоурум ${sr.name} в Дубае — ваш надежный партнер в мире роскошных авто. Только проверенные модели, эксклюзивные комплектации и быстрая доставка.`,
                        `Ищете идеальный автомобиль? В ${sr.name} мы поможем подобрать машину вашей мечты. Прямые поставки из Эмиратов, выгодные цены и профессиональный сервис.`,
                        `${sr.name}: эксперты по экспорту элитных авто из ОАЭ. Огромный каталог в наличии, прозрачные условия сделки и доставка в любую точку мира.`,
                        `Эксклюзивный доступ к лучшим автомобилям Дубая через ${sr.name}. Мы знаем всё об авторынке ОАЭ и предлагаем только лучшее для наших клиентов.`,
                        `Ваш персональный гид по авторынку Эмиратов — ${sr.name}. Продажа, тюнинг и подбор люксовых автомобилей с мировым именем.`
                    ];
                    const selectedBio = bioTemplates[index % bioTemplates.length];
                    
                    await tPage.keyboard.type(selectedBio, { delay: 1 });
                    await sleep(1500);
                    await tPage.mouse.click(670, 298); await sleep(2500); // Центр
                    await tPage.evaluate(() => {
                        const c = Array.from(document.querySelectorAll('.dropdown-item, .item, span, a')).find(el => el.innerText?.includes('По центру') || el.innerText?.includes('Center'));
                        if (c) c.click();
                    });
                    await sleep(1500);
                    await tPage.mouse.click(413, 451); await sleep(2000); // Размер
                    await tPage.evaluate(() => {
                        const t = Array.from(document.querySelectorAll('.dropdown-item, .item, span, a')).find(el => el.innerText?.includes('Большой текст'));
                        if (t) t.click();
                    });
                    await sleep(1500);
                    await tPage.evaluate(() => {
                        const d = document.querySelectorAll('.button-dropdown.is-toolbar-control');
                        if (d[1]) d[1].click();
                    });
                    await sleep(2000);
                    await tPage.evaluate(() => {
                        const fonts = Array.from(document.querySelectorAll('.dropdown-item, .item, span'));
                        const serious = fonts.find(el => el.innerText?.includes('Serif') || el.innerText?.includes('Georgia'));
                        if (serious) serious.click();
                    });

                    await sleep(1000); await ensureSaved(tPage); 

                    // 3. LINKS
                    const links = [
                        { t: 'Сам шоурум', s: 'Более 500 предложений', u: sr.profile_url },
                        { t: 'Авто шоурума', s: 'Каталог автомобилей', u: sr.cars_url },
                        { t: 'Аренда авто', s: 'Люкс и спорткары ежедневно', u: sr.rent_url },
                        { t: 'Автомобильные номера', s: 'Эксклюзивные госномера', u: sr.numbers_url },
                        { t: 'Проданные авто', s: 'Галерея сделок', u: sr.sold_url }
                    ];

                    for (const l of links) {
                        await tPage.click('button.is-new-block'); await sleep(2500);
                        await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Ссылка'))?.click());
                        await sleep(4000);
                        const inps = await tPage.$$('.modal-card-body input');
                        if (inps.length >= 3) { 
                            await inps[0].type(l.t); 
                            await inps[1].type(l.s); 
                            await inps[2].type(l.u); 
                        }
                        await tPage.evaluate(() => {
                            const modal = document.querySelector('.modal-card, .modal.is-active') || document.body;
                            const dTab = Array.from(modal.querySelectorAll('.nav-tabs a, div, span, button'))
                                .find(el => el.innerText && el.innerText.trim().toUpperCase() === 'ДИЗАЙН');
                            if (dTab) dTab.click();
                        });
                        await sleep(3000);
                        await tPage.evaluate(() => {
                            const tr = Array.from(document.querySelectorAll('label')).find(el => el.innerText?.includes('Анимация'))?.parentElement.querySelector('button, .select');
                            if (tr) tr.click();
                        });
                        await sleep(3000);
                        await tPage.mouse.click(836, 415); await sleep(1500); // Блик
                        await ensureSaved(tPage); 
                    }

                    await addSeparator(tPage);

                    // 4. WhatsApp
                    await tPage.click('button.is-new-block'); await sleep(3000);
                    await tPage.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Мессенджеры'))?.click());
                    await sleep(6000);
                    await tPage.evaluate(() => Array.from(document.querySelectorAll('button, a')).find(el => el.innerText?.includes('Добавить новый пункт'))?.click());
                    await sleep(3500);
                    await tPage.evaluate(() => {
                        const items = Array.from(document.querySelectorAll('.messenger-list-item, div, span, button'));
                        const wa = items.find(el => el.innerText?.trim() === 'WhatsApp' && el.offsetHeight > 0);
                        if (wa) wa.click();
                    });
                    await sleep(7500); 
                    const waInps = await tPage.$$('.modal-card-body input');
                    if (waInps.length >= 2) { 
                        await waInps[0].click({clickCount: 3}); 
                        await tPage.keyboard.type('Связаться в WhatsApp'); 
                    }
                    const flag = await tPage.waitForSelector('.iti__flag-container, .input-phone__country', { visible: true });
                    await flag.click(); await sleep(2000);
                    await tPage.keyboard.type('United Arab Emirates'); await sleep(2500);
                    await tPage.keyboard.press('Enter'); await sleep(2000);
                    const pInp = await tPage.waitForSelector('input[type="tel"]');
                    await pInp.click({clickCount: 3});
                    let cl = (sr.whatsapp || '501234567').replace(/\D/g, '');
                    if (cl.startsWith('971')) cl = cl.substring(3);
                    await tPage.keyboard.type(cl); await sleep(1500);
                    await ensureSaved(tPage);

                    // 5. PUBLISH
                    await sleep(3500);
                    await tPage.evaluate(() => {
                        const btn = Array.from(document.querySelectorAll('a, button, span, div[role="button"]'))
                            .find(el => {
                                const t = (el.innerText || '').toLowerCase();
                                return t.includes('получить ссылку') || t.includes('опубликовать') || (t.includes('ссылку') && el.offsetHeight > 0);
                            });
                        if (btn) btn.click();
                    });
                    await sleep(4500);
                    await tPage.evaluate(() => {
                        const options = document.querySelectorAll('.modal-card-body .radio, .modal-card-body label');
                        if (options[0]) options[0].click();
                    });
                    await sleep(2500);
                    
                    let finalDomain = sr.safe_name;
                    let isReady = false;
                    for (let tryDomain = 0; tryDomain < 10; tryDomain++) {
                        log(`   Попытка занять домен: ${finalDomain}...`);
                        
                        // Прямая JS-инъекция в ЛЮБОЙ текстовый инпут на экране (универсальный поиск)
                        const setRes = await tPage.evaluate((val) => {
                            const inps = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
                            // Ищем тот, который в модалке или имеет характерный плейсхолдер
                            const inp = inps.find(i => {
                                const p = (i.placeholder || '').toLowerCase();
                                return p.includes('имя') || p.includes('name') || p.includes('ваше') || i.closest('.modal-card');
                            }) || inps[0];
                            
                            if (inp) {
                                inp.focus();
                                inp.value = val;
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                                inp.dispatchEvent(new Event('blur', { bubbles: true }));
                                return inp.value === val;
                            }
                            return false;
                        }, finalDomain);
                        
                        log(`      Ввод домена: ${setRes ? 'ОК' : 'ОШИБКА'}`);
                        await sleep(1500);
                        
                        await tPage.evaluate(() => {
                            const btn = Array.from(document.querySelectorAll('button')).find(el => el.innerText?.includes('Подключить') && !el.disabled);
                            if (btn) btn.click();
                        });
                        await sleep(5000);

                        // Проверяем, существует ли все еще модалка с кнопкой "Подключить"
                        const isStillInputting = await tPage.evaluate(() => {
                            const btn = Array.from(document.querySelectorAll('button')).find(el => el.innerText?.includes('Подключить'));
                            return btn && btn.offsetHeight > 0;
                        });
                        
                        if (!isStillInputting) {
                            isReady = true;
                            break;
                        }

                        // Если кнопка все еще есть, значит имя занято!
                        const suffix = ['a', 'auto', 'motors', 'cars', 'dxb', 'dubai', 'ae', 'showroom', 'official'];
                        finalDomain = sr.safe_name + (tryDomain < suffix.length ? '_' + suffix[tryDomain] : '_' + Math.floor(Math.random() * 9999));
                    }
                    
                    if (isReady) {
                        log(`✅ [УСПЕХ] ${finalDomain} Опубликован.`);
                        sr.taplink_url = `https://taplink.cc/${finalDomain}`;
                        sr.taplink_designed = true; 
                        sr.taplink_published = true;
                        success = true;
                    } else {
                        throw new Error('Не удалось подобрать свободное имя домена или ошибка публикации');
                    }
                }
            } catch (e) {
                log(`❌ [ОШИБКА] ${sr.name} (попытка ${attempts}): ${e.message}`);
                log('⏸️ СКРИПТ ПРИОСТАНОВЛЕН ДЛЯ ДИАГНОСТИКИ ОШИБКИ.');
                await new Promise(async (r) => {
                    const readlineModule = await import('readline');
                    const readline = readlineModule.default || readlineModule;
                    const rl = readline.createInterface({input: process.stdin, output: process.stdout});
                    rl.question('📸 Сделайте скриншоты. Нажмите ENTER для продолжения...', () => {
                        rl.close();
                        r();
                    });
                });
            } finally {
                // НЕ ЗАКРЫВАЕМ вкладку для диагностики (как просили вы)
                // if (tPage && !tPage.isClosed()) await tPage.close().catch(() => {});
            }

            if (success) {
                fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
                log(`[OK] ${sr.name} готов.`);
                break; // Выходим после первого успешного
            } else if (attempts < 3) {
                await sleep(5000);
            }
        }

        if (!success) {
            log(`[ПРОПУСК] ${sr.name} — 3 попытки не удались.`);
        } else {
            successTotal++;
            log(`✅ Успешно обработано: ${successTotal}/2`);
        }

        if (successTotal >= 2) {
            log('🎯 ТЕСТ СВЯЗКИ ЗАВЕРШЕН: 2 салона обработаны.');
            break;
        }
    }

    log('=== ГОТОВО ===');
}
run();
