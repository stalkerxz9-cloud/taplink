import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import ExcelJS from 'exceljs';

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

// ─── mail.tm API state ────────────────────────────────────────────────────────
let mailTm = { email: null, token: null, id: null };

async function createMailTmAccount() {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            log(`[mail.tm] Попытка создания аккаунта ${attempt}/3...`);
            // 1. Получаем список доменов
            const domResp = await fetch('https://api.mail.tm/domains?page=1');
            if (!domResp.ok) throw new Error(`Domains API error: ${domResp.status}`);
            const domData = await domResp.json();
            const domain = domData['hydra:member']?.[0]?.domain;
            if (!domain) { log('[mail.tm] Нет доступных доменов'); continue; }

            // 2. Генерируем случайный логин
            const login = 'sr' + Math.random().toString(36).slice(2, 10);
            const email = `${login}@${domain}`;
            const pass  = 'Taplink#' + Math.floor(Math.random() * 90000 + 10000);

            // 3. Регистрируем аккаунт
            const regResp = await fetch('https://api.mail.tm/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: email, password: pass })
            });
            if (!regResp.ok) {
                const errData = await regResp.json().catch(() => ({}));
                log(`[mail.tm] Ошибка регистрации: ${regResp.status} ${JSON.stringify(errData)}`);
                continue;
            }
            const regData = await regResp.json();
            if (!regData.id) { log('[mail.tm] Не удалось получить ID аккаунта'); continue; }

            await sleep(1000);

            // 4. Получаем токен
            const tokResp = await fetch('https://api.mail.tm/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ address: email, password: pass })
            });
            if (!tokResp.ok) {
                log(`[mail.tm] Ошибка токена: ${tokResp.status}`);
                continue;
            }
            const tokData = await tokResp.json();
            if (!tokData.token) { log('[mail.tm] Нет токена в ответе'); continue; }

            mailTm = { email, token: tokData.token, id: regData.id };
            log(`[mail.tm] ✅ Почта готова: ${email}`);
            return email;
        } catch (e) {
            log(`[mail.tm] ❌ Ошибка попытки ${attempt}: ${e.message}`);
            await sleep(2000);
        }
    }
    return null;
}

async function waitMailTmCode() {
    log('[mail.tm] Ожидаем письмо с кодом...');
    for (let i = 0; i < 45; i++) {
        try {
            await new Promise(r => setTimeout(r, 5000));
            const resp = await fetch('https://api.mail.tm/messages?page=1', {
                headers: { 'Authorization': 'Bearer ' + mailTm.token }
            });
            if (!resp.ok) {
                log(`[mail.tm] Ошибка получения сообщений: ${resp.status}`);
                continue;
            }
            const data = await resp.json();
            const msgs = data['hydra:member'] || [];
            if (msgs.length === 0) continue;

            for (const msg of msgs) {
                const msgResp = await fetch(`https://api.mail.tm/messages/${msg.id}`, {
                    headers: { 'Authorization': 'Bearer ' + mailTm.token }
                });
                if (!msgResp.ok) continue;
                const msgData = await msgResp.json();
                const text = (msgData.text || '') + (msgData.html || '');
                const match = text.match(/\b(\d{6})\b/);
                if (match) { log(`[mail.tm] Код найден: ${match[1]}`); return match[1]; }
            }
        } catch (e) { log(`[mail.tm] Ошибка проверки: ${e.message}`); }
    }
    log('[mail.tm] Код не найден за 3+ минуты.');
    return null;
}

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath  = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath   = path.join(process.cwd(), 'data', 'bot_log.txt');
const excelPath = path.join(process.cwd(), 'taplink_report.xlsx');
const PASS      = 'SecureShowroom#2024';
const testLimit = 0; // 0 = обрабатывать КО ВСЕ (без лимита)
const HEADLESS  = true; // Тихий режим (true = браузер скрыт)

function log(msg) {
    const time = new Date().toLocaleTimeString('en-GB'); // Standard time format
    const line = `[${time}] ${msg}`;
    console.log(line);
    try {
        fs.appendFileSync(logPath, line + '\n', 'utf-8');
    } catch (e) {
        // Fallback for some Windows encoding issues
        fs.appendFileSync(logPath, Buffer.from(line + '\n', 'utf-8'));
    }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms * 0.7)); // Глобальное ускорение всех пауз на 30%

// --- Хелперы стабильности ---

async function retry(fn, retries = 3, interval = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === retries - 1) throw e;
            log(`   [!] Ошибка (попытка ${i + 1}/${retries}): ${e.message}. Ждем ${interval}ms...`);
            await new Promise(r => setTimeout(r, interval));
        }
    }
}

async function safeEvaluate(page, fn, ...args) {
    return await retry(async () => {
        if (page.isClosed()) throw new Error('Page is closed');
        return await page.evaluate(fn, ...args);
    }, 3, 1500).catch(e => {
        log(`   [CRITICAL] safeEvaluate failed after retries: ${e.message}`);
        return null;
    });
}

async function saveProgress(showrooms) {
    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
}

async function updateExcelReport(sr) {
    log(`[EXCEL] Обновление отчета для: ${sr.name}`);
    const workbook = new ExcelJS.Workbook();
    let worksheet;

    try {
        if (fs.existsSync(excelPath)) {
            await workbook.xlsx.readFile(excelPath);
            worksheet = workbook.getWorksheet(1);
        } else {
            worksheet = workbook.addWorksheet('Отчет Taplink');
            worksheet.columns = [
                { header: 'Название шоурума', key: 'name', width: 35 },
                { header: 'Ссылка Taplink',   key: 'url',  width: 45 },
                { header: 'Email',            key: 'email',width: 30 },
                { header: 'Пароль',           key: 'pass', width: 25 },
                { header: 'Дата',              key: 'date', width: 20 }
            ];
            worksheet.getRow(1).font = { bold: true };
        }

        worksheet.addRow({
            name: sr.name,
            url: sr.taplink_url || 'N/A',
            email: sr.taplink_email || 'N/A',
            pass: sr.taplink_pass || 'SecureShowroom#2024',
            date: new Date().toLocaleDateString('ru-RU')
        });

        await workbook.xlsx.writeFile(excelPath);
        log(`   [EXCEL] ✅ Данные записаны: ${sr.name}`);
    } catch (e) {
        if (e.code === 'EBUSY') {
            log(`   [EXCEL] ❌ ОШИБКА: Файл закрыт? (Permission denied). Пропускаем запись для ${sr.name}`);
        } else {
            log(`   [EXCEL] ❌ Ошибка записи: ${e.message}`);
        }
    }
}

// ─── Почта (mail.tm API v11) ──────────────────────────────────────────────────
// mPage параметр сохранён для совместимости с registerTaplink, но не используется
async function getVisualEmail(_mailPage) {
    return await createMailTmAccount();
}

async function getVisualCode(_mailPage) {
    return await waitMailTmCode();
}

// ─── Регистрация (стабильная v10.04) ─────────────────────────────────────────
async function registerTaplink(tPage, mailPage, email, password) {
    log(`Регистрация: ${email}`);
    await tPage.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await tPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await tPage.type('input[type="email"]', email, { delay: 50 });

    await safeEvaluate(tPage, () => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /продолжить|далее|next/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(5000);

    await safeEvaluate(tPage, () => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"], a'))
            .find(b => /почта существует|да, все верно|yes|continue|войти|log in/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    // ПРОВЕРКА НА ОШИБКУ: "Почтовый ящик не существует" или др.
    const emailError = await safeEvaluate(tPage, () => {
        const err = document.querySelector('.help.is-danger, .error, .message-body, .invalid-feedback');
        if (err && err.offsetHeight > 0) {
            const txt = err.innerText.toLowerCase();
            if (txt.includes('не существует') || txt.includes('error') || txt.includes('допустили ошибку')) return txt;
        }
        return null;
    });

    if (emailError) {
        log(`   [!] Ошибка почты (reject): ${emailError}`);
        return false;
    }

    // Ожидание появления поля для ввода кода (до 20 сек)
    log('   Ожидание запроса кода...');
    let requiresCode = false;
    for (let i = 0; i < 10; i++) {
        requiresCode = await safeEvaluate(tPage, () =>
            document.body.innerText.toLowerCase().includes('код') || 
            !!document.querySelector('input[autocomplete="one-time-code"]') ||
            !!document.querySelector('.auth-code-input')
        );
        if (requiresCode) break;
        await sleep(2000);
    }

    if (requiresCode) {
        const code = await waitMailTmCode();
        if (code) {
            await tPage.bringToFront();
            const inputs = await tPage.$$('input:not([type="hidden"])');
            // Пробуем ввести посимвольно в инпуты если их много ( Taplink 6-digit style)
            const codeInputs = await tPage.$$('input[autocomplete="one-time-code"], .auth-code-input input');
            if (codeInputs.length >= 6) {
                log('   Ввод кода посимвольно...');
                for (let i = 0; i < 6; i++) {
                    await codeInputs[i].focus();
                    await codeInputs[i].type(code[i], { delay: 150 });
                }
            } else if (inputs.length >= 6) {
               log('   Ввод кода в общие инпуты...');
               let entered = 0;
               for (const inp of inputs) {
                   if (entered >= 6) break;
                   try {
                       await inp.focus();
                       await inp.type(code[entered], { delay: 150 });
                       entered++;
                   } catch (e) { break; }
               }
            } else {
                log('   Ввод кода целиком...');
                await tPage.keyboard.type(code, { delay: 150 });
            }
            await sleep(3000);
            
            // Если кнопка продолжить не нажалась сама
            await safeEvaluate(tPage, () => {
                const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => /продолжить|далее|next|verify|подтвердить/i.test(b.innerText || ''));
                if (btn && btn.offsetHeight > 0) btn.click();
            });
            await sleep(8000);
        } else {
            log('   [!] Код не получен. Регистрация прервана.');
            return false;
        }
    } else {
        log('   [!] Запрос кода не появился (возможно аккаунт уже создан или бан).');
    }


    const passwordSet = await retry(async () => {
        await tPage.waitForSelector('input[type="password"]', { timeout: 10000 });
        const passes = await tPage.$$('input[type="password"]');
        for (const p of passes) {
            await p.click({ clickCount: 3 });
            await p.type(password, { delay: 50 });
        }
        
        await safeEvaluate(tPage, () => {
            const cb = document.querySelector('input[type="checkbox"]');
            if (cb) cb.click();
            const btn = Array.from(document.querySelectorAll('button'))
                .find(b => /регистр|далее|войти|продолжить|login/i.test(b.innerText || ''));
            if (btn) btn.click();
        });
        await sleep(5000);
        
        const url = tPage.url();
        return !url.includes('auth') && !url.includes('signup') && !url.includes('login');
    }, 3, 5000).catch(() => false);

    if (!passwordSet) {
        log('   [!] Не удалось завершить вход/регистрацию (возможно таймаут)');
        const isInside = await safeEvaluate(tPage, () => !!document.querySelector('.profile-menu, .is-new-block, a[href*="logout"]'));
        if (isInside) return true;
        return false;
    }

    await sleep(5000);
    return true;
}

// ─── Вспомогательные функции дизайна ─────────────────────────────────────────

// Сохранить открытый модальный блок
async function ensureSaved(page) {
    log('   Попытка сохранения...');
    for (let i = 0; i < 5; i++) {
        try {
            const result = await safeEvaluate(page, () => {
                const btns = Array.from(document.querySelectorAll(
                    '.modal-card-foot .is-primary, button.is-primary, button'
                ));
                const btn = btns.find(b =>
                    b.innerText?.includes('Сохранить') ||
                    b.innerText?.includes('Save') ||
                    b.innerText?.includes('Готово') ||
                    b.innerText?.includes('Done')
                );
                if (btn) { btn.click(); return 'CLICKED'; }
                
                const modal = document.querySelector('.modal-card, .modal.is-active');
                if (!modal || modal.offsetHeight === 0) return 'CLOSED';
                return 'STILL_OPEN';
            });

            if (result === 'CLOSED') { log('   [OK] Сохранено (окно закрыто).'); return true; }
            await sleep(3000);
            
            // Проверка видимости модалки после клика
            const stillVisible = await safeEvaluate(page, () => {
                const modal = document.querySelector('.modal-card, .modal.is-active');
                return modal && modal.offsetHeight > 0;
            });
            
            if (!stillVisible) { log('   [OK] Сохранено.'); return true; }
        } catch (e) {
            log(`   [!] Ошибка в ensureSaved: ${e.message}`);
            await sleep(2000);
        }
    }
    log('   [!] Не удалось сохранить штатно, жмем Escape...');
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1500);
    return false;
}

// Добавить разделитель
async function addSeparator(page) {
    try {
        if (page.isClosed()) return;
        log('   + Разделитель...');
        // Проверка фрейма
        await safeEvaluate(page, () => document.body.offsetWidth);
        
        await openNewBlockMenu(page);
        await sleep(2500);
        
        await safeEvaluate(page, () => {
            const btns = Array.from(document.querySelectorAll('button.is-block-button, button'));
            const sep = btns.find(el =>
                el.innerText?.includes('Разделитель') || el.innerText?.includes('Divider')
            );
            if (sep) sep.click();
        });
        await sleep(2500);
        await ensureSaved(page);
    } catch (e) {
        log(`   [!] Ошибка в addSeparator: ${e.message}`);
    }
}

// Клик по кнопке "Добавить блок" с запасным вариантом
async function openNewBlockMenu(page) {
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(800);
    const clicked = await safeEvaluate(page, () => {
        const btn = document.querySelector('button.is-new-block');
        if (btn) { btn.click(); return true; }
        const byText = Array.from(document.querySelectorAll('button, span, div'))
            .find(el =>
                el.innerText?.trim().toLowerCase() === 'добавить блок' ||
                el.innerText?.trim().toLowerCase() === 'add block'
            );
        if (byText) { byText.click(); return true; }
        return false;
    });
    if (!clicked) {
        log('   [!] Кнопка "Добавить блок" не найдена, клик по координатам (центр снизу)...');
        await page.mouse.click(640, 800);
    }
    await sleep(3000);
}

// Выбрать блок из меню по имени
async function selectBlock(page, name) {
    try {
        if (page.isClosed()) return;
        log(`   Выбор блока: "${name}"...`);
        // Защита фрейма
        await safeEvaluate(page, () => document.body.offsetWidth);
        await sleep(1500);

        const clicked = await safeEvaluate(page, (targetName) => {
            const items = Array.from(document.querySelectorAll('.is-block-button, [class*="block-item"], button, .item, .app-pages-site-block-menu-item'));
            const target = items.find(el => {
                const t = (el.innerText || '').trim().toLowerCase();
                return t === targetName.toLowerCase() || t.includes(targetName.toLowerCase());
            });
            if (target && target.offsetHeight > 0) {
                target.scrollIntoView();
                target.click();
                return true;
            }
            return false;
        }, name);

        if (clicked) {
            log(`   [OK] Блок "${name}" выбран`);
        } else {
            log(`   [!] Не удалось выбрать блок "${name}" через DOM, пробуем координаты...`);
            if (name.toLowerCase().includes('текст')) await page.mouse.click(236, 200);
            if (name.toLowerCase().includes('ссылка')) await page.mouse.click(400, 200);
            if (name.toLowerCase().includes('аватар')) await page.mouse.click(400, 380);
            if (name.toLowerCase().includes('разделитель')) await page.mouse.click(565, 380);
        }
        await sleep(5000);
    } catch (e) {
        log(`   [!] Ошибка в selectBlock(${name}): ${e.message}`);
    }
}

// Клик по тексту через TreeWalker — золотая техника
async function hardwareClick(page, text) {
    try {
        const pos = await safeEvaluate(page, (txt) => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let n;
            const lowerTxt = txt.toLowerCase().trim();
            while (n = walker.nextNode()) {
                if ((n.nodeValue || '').trim().toLowerCase().includes(lowerTxt)) {
                    const rect = n.parentElement.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        window.scrollTo(0, rect.top + window.scrollY - window.innerHeight / 2);
                        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                    }
                }
            }
            return null;
        }, text);

        if (pos) {
            await page.mouse.click(pos.x, pos.y);
            log(`   [OK] hardwareClick: "${text}"`);
            return true;
        } else {
            log(`   [!] hardwareClick: "${text}" не найден`);
            return false;
        }
    } catch (e) {
        log(`   [!] hardwareClick ERROR: ${e.message}`);
        return false;
    }
}

// Улучшенные хелперы стабильности
async function safeClick(page, selectorOrText, options = {}) {
    const { timeout = 5000, useHardware = false } = options;
    try {
        if (useHardware) return await hardwareClick(page, selectorOrText);

        const clicked = await safeEvaluate(page, (sel) => {
            const el = document.querySelector(sel) || 
                       Array.from(document.querySelectorAll('button, a, span, div'))
                            .find(b => b.innerText?.trim().toLowerCase().includes(sel.toLowerCase()));
            if (el && el.offsetHeight > 0) { el.click(); return true; }
            return false;
        }, selectorOrText);
        
        if (clicked) return true;
        
        // Попытка через Puppeteer click
        const el = await page.waitForSelector(selectorOrText, { visible: true, timeout }).catch(() => null);
        if (el) { await el.click(); return true; }
    } catch (e) {
        log(`   [!] safeClick failure: ${e.message}`);
    }
    return false;
}

async function safeType(page, selector, text) {
    try {
        const el = await page.waitForSelector(selector, { visible: true, timeout: 5000 });
        await el.click({ clickCount: 3 });
        await page.keyboard.press('Backspace');
        await el.type(text, { delay: 10 });
        return true;
    } catch (e) {
        log(`   [!] safeType failure on ${selector}: ${e.message}`);
        return false;
    }
}

// ─── Генератор Bio на английском ─────────────────────────────────────────────
const BIO_TEMPLATES = [
    (name) => `${name} is your premier destination for luxury and performance vehicles in the UAE. We offer an exclusive selection of premium cars for sale and rent, backed by expert advice and exceptional service. Browse our catalog and find your perfect car today.`,
    (name) => `Welcome to ${name} — one of the UAE's most trusted automotive showrooms. Discover a handpicked collection of luxury, sports, and exotic vehicles available for sale and daily rental. Our team is ready to help you at every step.`,
    (name) => `${name} specializes in premium automobiles sourced directly from the UAE market. Whether you're looking to buy, rent, or explore exclusive number plates, we deliver quality and trust you can count on. Contact us via WhatsApp for a personal consultation.`,
    (name) => `At ${name}, we bring you the finest automobiles the UAE has to offer — luxury sedans, SUVs, sports cars, and more. Every vehicle is verified for quality and legal compliance. Start your journey with us today.`,
    (name) => `${name} is a leading showroom for premium cars in the UAE. We offer competitive pricing, a wide selection of makes and models, and a seamless purchase or rental experience. Reach out to our experts and drive your dream car.`,
];

function getEnglishBio(sr) {
    // Если в базе уже есть английское bio — используем его
    if (sr.bio && sr.bio.length > 30 && !/[а-яё]/i.test(sr.bio)) {
        return sr.bio;
    }
    // Иначе — генерируем из шаблона (уникальный для каждого шоурума)
    const idx = Math.abs((sr.safe_name?.charCodeAt(0) || 0) + (sr.safe_name?.charCodeAt(1) || 0)) % BIO_TEMPLATES.length;
    return BIO_TEMPLATES[idx](sr.name);
}

// ─── Дизайн (GOLDEN v9.04 + стабильность v10.04) ─────────────────────────────
async function designShowroom(page, sr) {
    log(`\n[ДИЗАЙН] ${sr.name}`);

    // Ввод имени профиля если попали на setup
    if ((await page.url()).includes('profile/setup/')) {
        await page.waitForSelector('input[name="username"]', { timeout: 15000 }).catch(() => {});
        await page.type('input[name="username"]', sr.safe_name, { delay: 50 });
        await page.keyboard.press('Enter');
        await sleep(6000);
    }

    // Переходим в редактор
    await page.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);

    // ── Выбор шаблона (если вылез экран выбора) ────────────────────────────────
    if ((await page.url()).includes('/templates/')) {
        log('Экран шаблонов. Выбираем "Пустой шаблон" через hardwareClick...');
        await sleep(2000);
        await hardwareClick(page, 'Мобильные сайты');
        await sleep(3000);
        await hardwareClick(page, 'Пустой шаблон');
        await sleep(3000);
        
        // Кликаем "Да" / "Выбрать"
        const confirmed = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, .button, a'));
            const ok = btns.find(b => {
                const t = (b.innerText || '').trim();
                return /^(Да|Yes|Выбрать|Select|Применить|Apply|OK)$/i.test(t);
            });
            if (ok) { ok.click(); return true; }
            return false;
        }).catch(() => false);
        
        if (!confirmed) {
            log('   [!] Кнопка подтверждения не найдена через DOM, пробуем hardwareClick...');
            await hardwareClick(page, 'Да');
            await hardwareClick(page, 'Выбрать');
        }
        await sleep(8000);

        // Закрываем обучающее меню если есть
        await page.mouse.click(10, 10);
        await sleep(2000);

        // НЕ УДАЛЯЕМ дефолтный блок! Используем его.
        
        // Возвращаемся в редактор
        await page.goto('https://taplink.ru/profile/', { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(5000);
    }

    // Закрываем мусорные попапы
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, span, div, a'));
        const close = btns.find(b => /понятно|закрыть|пропустить|skip|close|got it/i.test(b.innerText || ''));
        if (close) close.click();
    });
    await sleep(1500);




    // ШАГ 1: АВАТАР + ОБЛОЖКА (Бурж Халифа)
    // Стратегия: GOLDEN v9.04 — добавляем НОВЫЙ блок через + (гарантированно открывает диалог)
    // Если уже есть авто-блок аватара — удаляем его из DOM, потом добавляем свой
    // ─────────────────────────────────────────────────────────────────────────
    const srDir = path.resolve(process.cwd(), 'data', sr.safe_name);
    const logoPath = path.join(srDir, 'logo.jpg');

    if (fs.existsSync(logoPath)) {
        log('1. Аватар + Обложка (Бурж Халифа)...');

        // ── ШАГ 1: Аватар + Обложка ──────────────────────────────────────────
        log('1. Аватар + Обложка (Бурж Халифа)...');
        
        // ПРОВЕРКА: Ищем блок по любым признакам
        let avatarOpened = await safeEvaluate(page, () => {
            const av = document.querySelector('[data-block-type="avatar"], .is-avatar-block, .tap-avatar, .btn-link-block, .app-pages-site-block');
            if (av) {
                av.scrollIntoView();
                av.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                av.click(); 
                return true;
            }
            const anyBlock = document.querySelector('.taplink-block, .page-block, .app-block-item');
            if (anyBlock) {
                anyBlock.scrollIntoView();
                anyBlock.click();
                return true;
            }
            return false;
        });

        if (avatarOpened) {
            log('   [OK] Блок найден, ждем модалку...');
        } else {
            log('   [!] Страница пуста, создаем новый блок Аватар');
            await openNewBlockMenu(page);
            await selectBlock(page, 'Аватар');
            avatarOpened = true;
        }
        
        await sleep(6000); 

        // Проверяем модалку
        let isModalVisible = await safeEvaluate(page, () => {
            const modal = document.querySelector('.modal.is-active, .modal-card, .modal-content');
            if (!modal) return false;
            return modal.offsetHeight > 100 && Array.from(modal.querySelectorAll('button'))
                .some(b => /сохранить|save|применить|apply/i.test(b.innerText || ''));
        });

        if (!isModalVisible) {
            log('   [!] Модалка не видна — fallback создание');
            await openNewBlockMenu(page);
            await selectBlock(page, 'Аватар');
            await sleep(5000);
        }

        if (avatarOpened) {

            // ── 1.1 Выбираем шаблон 2 (с БАННЕРОМ / Обложкой) ────────────────
            // Диалог показывает 4 шаблона-превью. Нам нужен ВТОРОЙ (с широким фоном).
            // Из скриншота (Window Bounds 17,96; 1280,900):
            //   Шаблон 1: content_x ≈ 278, Шаблон 2: content_x ≈ 356, y ≈ 330
            log('   1.1 Шаблон с баннером...');
            const tplClicked = await page.evaluate(() => {
                // Пробуем найти превью-шаблоны по классам
                const selectors = [
                    '.avatar-template-item', '.template-item', '.layout-item',
                    '[class*="avatar-layout"]', '[class*="template-preview"]',
                    '.is-template', '[class*="layout-preview"]'
                ];
                for (const sel of selectors) {
                    const items = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetWidth > 0);
                    if (items.length >= 2) { items[1].click(); return true; }
                }
                // Ищем контейнер с несколькими превью изображениями (шаблоны = набор img/div)
                const modalBody = document.querySelector('.modal-card-body');
                if (!modalBody) return false;
                const previewGroups = Array.from(modalBody.querySelectorAll('div'))
                    .filter(d => {
                        const children = Array.from(d.children).filter(c => c.offsetWidth > 0);
                        return children.length >= 3; // группа из 3-4 шаблонов
                    });
                if (previewGroups.length > 0) {
                    const group = previewGroups[0];
                    const items = Array.from(group.children).filter(c => c.offsetWidth > 0);
                    if (items.length >= 2) { items[1].click(); return true; }
                }
                return false;
            });

            if (!tplClicked) {
                log('   Координаты: шаблон 2 (356, 330)');
                await page.mouse.click(356, 330);
            }
            await sleep(2500);

            // ── 1.2 Загружаем ЛОГОТИП в поле "Аватар" ─────────────────────────
            log('   1.2 Загружаем логотип...');
            
            // Пытаемся найти input[type="file"] напрямую, чтобы избежать клика и системного окна
            let fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                log('   [OK] Input найден, загружаем файл напрямую...');
                await fileInput.uploadFile(logoPath);
                await sleep(4000);
            } else {
                log('   Input не найден, пробуем нажать "Загрузить"...');
                await page.evaluate(() => {
                    const allLabels = Array.from(document.querySelectorAll('.modal-card-body *'))
                        .filter(el => el.children.length === 0 && (el.innerText?.trim() === 'Аватар' || el.innerText?.trim() === 'Avatar'));
                    for (const lbl of allLabels) {
                        const row = lbl.closest('tr, .field, .label-row, div[class]') || lbl.parentElement?.parentElement;
                        if (row) {
                            const up = row.querySelector('button, a');
                            if (up && /загрузить|upload/i.test(up.innerText || '')) { up.click(); return; }
                        }
                    }
                    const btns = Array.from(document.querySelectorAll('.modal-card-body button, .modal-card-body a'));
                    const uploadBtn = btns.find(b => /загрузить|upload/i.test(b.innerText || ''));
                    if (uploadBtn) uploadBtn.click();
                });
                await sleep(2000);
                
                // Обработка FileChooser если он всё же сработал
                const [fcLogo] = await Promise.all([
                    page.waitForFileChooser({ timeout: 5000 }).catch(() => null),
                    sleep(100)
                ]).catch(() => [null]);
                if (fcLogo) {
                    await fcLogo.accept([logoPath]);
                    log('   [OK] Файл принят через FileChooser');
                    await sleep(4000);
                }
            }

            // ── 1.2.1 Обработка кроппера (модалка "Изображение") ──────────────
            log('   Проверка наличия редактора изображения...');
            const cropperResult = await page.evaluate(() => {
                const modals = Array.from(document.querySelectorAll('.modal.is-active, .modal-card, .modal-content'));
                const cropModal = modals.find(m => m.innerText?.includes('Изображение') || m.innerText?.includes('Image'));
                if (cropModal) {
                    const submitBtn = Array.from(cropModal.querySelectorAll('button.is-primary, button'))
                        .find(b => b.innerText?.includes('Загрузить') || b.innerText?.includes('Upload') || b.innerText?.includes('Save'));
                    if (submitBtn) { submitBtn.click(); return 'clicked'; }
                    return 'found_but_no_btn';
                }
                return 'not_found';
            });
            
            if (cropperResult === 'clicked') {
                log('   [OK] Нажата кнопка подтверждения в редакторе');
                await sleep(6000);
            } else if (cropperResult === 'found_but_no_btn') {
                log('   [!] Редактор найден, но кнопка "Загрузить" не обнаружена');
                await page.keyboard.press('Enter');
                await sleep(6000);
            }

            // ── 1.3 Обложка — Бурж Халифа из галереи ─────────────────────────
            log('   1.3 Обложка — Бурж Халифа...');
            await page.evaluate(() => {
                const modal = document.querySelector('.modal-card-body');
                if (modal) modal.scrollTop = 400; // Прокручиваем к полю "Обложка"
            });
            await sleep(1500);

            // Открываем галерею
            const coverGallOpened = await page.evaluate(() => {
                const allEls = Array.from(document.querySelectorAll('.modal-card-body *'));
                for (const el of allEls) {
                    if (el.children.length === 0 && (el.innerText?.trim() === 'Обложка' || el.innerText?.trim() === 'Cover')) {
                        const row = el.closest('tr, .field, .label-row, div[class]') || el.parentElement?.parentElement;
                        if (!row) continue;
                        const iconBtns = Array.from(row.querySelectorAll('button, a, span'))
                            .filter(b => b.offsetWidth > 0 && b.querySelector('svg, i, img, [class*="icon"]'));
                        if (iconBtns[0]) { iconBtns[0].click(); return true; }
                    }
                }
                return false;
            });

            if (!coverGallOpened) {
                log('   Галерея не открылась через DOM, пробуем координаты (634, 480)');
                await page.mouse.click(634, 480);
            }
            await sleep(5000);

            const isGalleryNowOpen = await page.evaluate(() =>
                document.body.innerText.includes('Галерея') ||
                document.body.innerText.includes('Gallery') ||
                !!document.querySelector('.modal.is-active [class*="gallery"]')
            );

            if (isGalleryNowOpen) {
                log('   Галерея открыта — подгружаем ленивые картинки...');
                await page.evaluate(async () => {
                    const mBody = document.querySelector('.modal.is-active .modal-card-body') || document.querySelector('.modal.is-active');
                    if (mBody) {
                        mBody.scrollTop = 1000;
                        await new Promise(r => setTimeout(r, 600));
                        mBody.scrollTop = 0;
                    }
                });
                await sleep(2000);

                // --- ЯДЕРНЫЙ ПОИСК БУРДЖ ХАЛИФА (getComputedStyle) ---
                const burjCoords = await page.evaluate(() => {
                    // Ищем по всей странице, не только в модалке
                    const allEls = Array.from(document.querySelectorAll('*'));
                    for (const el of allEls) {
                        if (el.offsetWidth < 20) continue;
                        
                        // Проверяем фон через ComputedStyle (самый надежный метод)
                        const style = window.getComputedStyle(el);
                        const bg = style.backgroundImage || '';
                        const src = el.src || '';
                        
                        if (bg.includes('8.webp') || src.includes('8.webp')) {
                            el.scrollIntoView({ block: 'center' });
                            const rect = el.getBoundingClientRect();
                            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                        }
                    }
                    return null;
                });

                if (burjCoords) {
                    log(`   [OK] Бурж Халифа (8.webp) найдена: ${Math.round(burjCoords.x)}, ${Math.round(burjCoords.y)}. Кликаем...`);
                    await page.mouse.click(burjCoords.x, burjCoords.y);
                    await sleep(2000);
                    
                    // Проверка: появилась ли галочка или класс активности?
                    const isSelected = await page.evaluate((coords) => {
                        const el = document.elementFromPoint(coords.x, coords.y);
                        if (!el) return false;
                        const parent = el.closest('[class*="item"], [class*="selected"], [class*="active"]') || el;
                        return parent.className.includes('active') || parent.className.includes('selected') || !!parent.querySelector('[class*="check"], svg');
                    }, burjCoords);
                    
                    if (isSelected) {
                        log('   [OK] Выбор подтвержден визуально');
                    } else {
                        log('   [!] Галочка не видна, нажатие дублем...');
                        await page.mouse.click(burjCoords.x, burjCoords.y);
                        await sleep(1500);
                    }
                } else {
                    log('   [!] Бурж Халифа (8.webp) не найдена даже через ComputedStyle!');
                }

                // Закрываем окно (максимально агрессивно)
                log('   Закрываем галерею...');
                for (let i = 0; i < 5; i++) {
                    const stillOpen = await page.evaluate(() => {
                        const m = document.querySelector('.modal.is-active');
                        return m && (m.innerText.includes('Галерея') || m.innerText.includes('Gallery') || m.querySelector('[class*="picture-gallery"]'));
                    });
                    if (!stillOpen) break;
                    
                    await page.evaluate(() => {
                        const m = document.querySelector('.modal.is-active');
                        if (!m) return;
                        const btns = Array.from(m.querySelectorAll('button, .button, a, span'))
                            .filter(b => b.offsetWidth > 0);
                        const okBtn = btns.find(b => 
                            /выбрать|select|применить|apply|save|сохранить|далее|готово|done/i.test(b.innerText || '')
                        );
                        if (okBtn) okBtn.click();
                        const close = m.querySelector('.delete, .modal-close, [class*="close"]');
                        if (close) close.click();
                    });
                    await page.keyboard.press('Enter');
                    await sleep(2000);
                }
                log('   [OK] Галерея закрыта');
            }
        }
        await ensureSaved(page);
        await sleep(3000); // Даем странице стабилизироваться после сохранения аватара

    } else {
        log(`   [!] Логотип не найден: ${logoPath}`);
    }


    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 2: РАЗДЕЛИТЕЛЬ
    // ─────────────────────────────────────────────────────────────────────────
    await addSeparator(page);

    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 3: BIO (Центр + Serif + Большой текст)
    // ─────────────────────────────────────────────────────────────────────────
    log('3. Bio (текст с центрированием)...');
    const addBtnBio = await page.waitForSelector('button.is-new-block', { timeout: 10000 }).catch(() => null);
    if (addBtnBio) {
        await addBtnBio.click();
        await sleep(3000);
        await selectBlock(page, 'Текст');
        await sleep(4000);

        // Вводим текст
        const editor = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 10000 }).catch(() => null);
        if (editor) {
            await editor.click();
            const bioText = getEnglishBio(sr);
            log(`   Bio: "${bioText.substring(0, 60)}..."`);
            await page.keyboard.type(bioText, { delay: 1 });
            await sleep(1500);
        }

        // Центрирование текста (координата golden: 670, 298)
        await page.mouse.click(670, 298);
        await sleep(2500);
        await page.evaluate(() => {
            const c = Array.from(document.querySelectorAll('.dropdown-item, .item, span, a, button'))
                .find(el =>
                    el.innerText?.includes('По центру') ||
                    el.innerText?.includes('Center') ||
                    el.innerText?.includes('centre')
                );
            if (c) c.click();
        });
        await sleep(1500);

        // Размер "Большой текст" (координата golden: 413, 451)
        await page.mouse.click(413, 451);
        await sleep(2000);
        await page.evaluate(() => {
            const t = Array.from(document.querySelectorAll('.dropdown-item, .item, span, a, button'))
                .find(el =>
                    el.innerText?.includes('Большой текст') ||
                    el.innerText?.includes('Large text') ||
                    el.innerText?.includes('Big text')
                );
            if (t) t.click();
        });
        await sleep(1500);

        // Шрифт Serif (golden: через второй .button-dropdown.is-toolbar-control)
        await page.evaluate(() => {
            const dropdowns = document.querySelectorAll('.button-dropdown.is-toolbar-control');
            if (dropdowns[1]) dropdowns[1].click();
        });
        await sleep(2000);
        await page.evaluate(() => {
            const fonts = Array.from(document.querySelectorAll('.dropdown-item, .item, span, a'));
            const serif = fonts.find(el =>
                el.innerText?.includes('Serif') ||
                el.innerText?.includes('Georgia') ||
                el.innerText?.includes('Playfair')
            );
            if (serif) serif.click();
        });
        await sleep(1000);
        await ensureSaved(page);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 4: РАЗДЕЛИТЕЛЬ
    // ─────────────────────────────────────────────────────────────────────────
    await addSeparator(page);

    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 5: 5 ССЫЛОК с анимацией BLINK
    // ─────────────────────────────────────────────────────────────────────────
    log('5. Добавление 5 ссылок с Blink...');
    
    // Хелпер для создания правильных ссылок именно этого шоурума
    const getSpecUrl = (original, type) => {
        const isGeneric = !original || original.includes('/sale/my/') || original.includes('/rent/car/') || original.includes('/sale/vrp/');
        if (!isGeneric) return original;
        
        // Маппинг для форсированного создания ссылки с глубоким переходом (deep link)
        const map = {
            profile: `https://auto.ae/en/${sr.safe_name}/`,
            sale:    `https://auto.ae/en/${sr.safe_name}/?category=sale`,
            rent:    `https://auto.ae/en/${sr.safe_name}/?category=rent`,
            vrp:     `https://auto.ae/en/${sr.safe_name}/?category=vrp`,
            sold:    `https://auto.ae/en/${sr.safe_name}/?category=sold`
        };
        return map[type];
    };

    const links = [
        { title: '🏢 Official Showroom', sub: `${sr.name} — full catalog`,    url: getSpecUrl(sr.profile_url, 'profile') },
        { title: '🚗 Cars for Sale',     sub: 'New arrivals & current stock', url: getSpecUrl(sr.cars_url,    'sale')    },
        { title: '🔑 Rent a Car',      sub: 'Luxury & sports cars daily',   url: getSpecUrl(sr.rent_url,    'rent')    },
        { title: '🔢 Number Plates',   sub: 'Exclusive VIP plates',         url: getSpecUrl(sr.numbers_url, 'vrp')     },
        { title: '✅ Sold Cars',       sub: 'Our completed deals gallery',  url: getSpecUrl(sr.sold_url,    'sold')    },
    ];

    for (const link of links) {
        log(`   + ${link.title}`);

        const addBtnLink = await page.waitForSelector('button.is-new-block', { timeout: 10000 }).catch(() => null);
        if (!addBtnLink) { log('   [!] Кнопка "Добавить блок" не найдена'); continue; }
        await addBtnLink.click();
        await sleep(3000);
        await selectBlock(page, 'Ссылка');
        await sleep(5000);

        // Умное заполнение полей через Puppeteer (type) для корректной работы React/Vue
        const inputControls = await page.evaluate(() => {
            const modal = document.querySelector('.modal-card-body');
            if (!modal) return [];
            const inps = Array.from(modal.querySelectorAll('input:not([type="hidden"])'));
            
            const urlIdx = inps.findIndex(i => 
                i.type === 'url' || 
                i.placeholder?.toLowerCase().includes('http') || 
                i.placeholder?.toLowerCase().includes('ссылка') ||
                i.placeholder?.toLowerCase().includes('link')
            );
            
            const titleIdx = inps.findIndex(i => 
                i.placeholder?.toLowerCase().includes('заголовок') || 
                i.placeholder?.toLowerCase().includes('title') ||
                i === inps[0]
            );

            const subIdx = inps.findIndex((i, idx) => 
                idx !== urlIdx && 
                idx !== titleIdx && 
                (i.placeholder?.toLowerCase().includes('текст') || 
                 i.placeholder?.toLowerCase().includes('subtitle') ||
                 i.placeholder?.toLowerCase().includes('описание') ||
                 i.placeholder?.toLowerCase().includes('description'))
            );

            return { urlIdx, titleIdx, subIdx };
        });

        const inps = await page.$$('.modal-card-body input:not([type="hidden"])');
        
        if (inputControls.titleIdx !== -1 && inps[inputControls.titleIdx]) {
            await inps[inputControls.titleIdx].click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await inps[inputControls.titleIdx].type(link.title, { delay: 2 });
        }
        
        if (inputControls.subIdx !== -1 && inps[inputControls.subIdx]) {
            await inps[inputControls.subIdx].click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await inps[inputControls.subIdx].type(link.sub, { delay: 2 });
        } else {
             log('      [!] Поле подзаголовка не найдено');
        }

        if (inputControls.urlIdx !== -1 && inps[inputControls.urlIdx]) {
            await inps[inputControls.urlIdx].click({ clickCount: 3 });
            await page.keyboard.press('Backspace');
            await inps[inputControls.urlIdx].type(link.url, { delay: 2 });
        }

        await sleep(1500);

        // Переходим на вкладку ДИЗАЙН
        await page.evaluate(() => {
            const tabs = Array.from(document.querySelectorAll('.nav-tabs a, .tabs a, [role="tab"]'));
            const design = tabs.find(el =>
                el.innerText?.includes('ДИЗАЙН') ||
                el.innerText?.includes('DESIGN') ||
                el.innerText?.includes('Design') ||
                el.innerText?.includes('Дизайн')
            );
            if (design) design.click();
        });
        await sleep(3000);

        // Открываем панель анимации — кликаем кнопку рядом с меткой "Анимация"
        await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('.modal-card-body *'));
            for (const el of all) {
                if (el.children.length === 0 && (el.innerText?.trim() === 'Анимация' || el.innerText?.trim() === 'Animation')) {
                    const row = el.closest('tr, .field, .label-row, div[class]') || el.parentElement?.parentElement;
                    if (row) {
                        const btn = row.querySelector('button, [class*="dropdown"], [class*="select"], [role="button"]');
                        if (btn) { btn.click(); return; }
                    }
                }
            }
            // Fallback: первая кнопка "Нет" в модалке (текущее значение)
            const noneBtn = Array.from(document.querySelectorAll('button'))
                .find(b => (b.innerText?.trim() === 'Нет' || b.innerText?.trim() === 'None') && b.closest('.modal-card-body'));
            if (noneBtn) noneBtn.click();
        });
        await sleep(2000);

        // Выбираем "Блик"
        let blinkClicked = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('button, .button, .dropdown-item, .item, span, a'));
            const blink = items.find(el => {
                const t = (el.innerText || '').trim();
                return t === 'Блик' || t === 'Blink';
            });
            if (blink) { blink.click(); return true; }
            return false;
        });

        if (!blinkClicked) {
            log('   [!] Блик не найден в DOM — пробуем hardwareClick');
            blinkClicked = await hardwareClick(page, 'Блик');
            if (!blinkClicked) await hardwareClick(page, 'Blink');
        }
        await sleep(1500);
        await ensureSaved(page);

    }

    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 6: РАЗДЕЛИТЕЛЬ
    // ─────────────────────────────────────────────────────────────────────────
    await addSeparator(page);

    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 7: WHATSAPP
    // ─────────────────────────────────────────────────────────────────────────
    log('7. WhatsApp...');
    const addBtnWA = await page.waitForSelector('button.is-new-block', { timeout: 10000 }).catch(() => null);
    if (addBtnWA) {
        await addBtnWA.click();
        await sleep(3000);
        await selectBlock(page, 'Мессенджеры');
        await sleep(5000);

        // Выбрать WhatsApp
        await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll(
                '.messenger-list-item, div, span, button, a, li'
            )).filter(el => el.offsetHeight > 0);
            const wa = items.find(el => el.innerText?.trim() === 'WhatsApp');
            if (wa) wa.click();
        });
        await sleep(6000);

        // Заголовок кнопки (English)
        const waInps = await page.$$('.modal-card-body input');
        if (waInps.length >= 1) {
            await waInps[0].click({ clickCount: 3 });
            await page.keyboard.type('Contact via WhatsApp');
        }

        // Выбор страны UAE
        const flagSel = await page.waitForSelector(
            '.iti__flag-container, .input-phone__country',
            { visible: true, timeout: 10000 }
        ).catch(() => null);
        if (flagSel) {
            await flagSel.click();
            await sleep(2000);
            await page.keyboard.type('United Arab Emirates');
            await sleep(2500);
            await page.keyboard.press('Enter');
            await sleep(2000);
        }

        // Телефон
        const pInp = await page.waitForSelector('input[type="tel"]', { timeout: 10000 }).catch(() => null);
        if (pInp) {
            await pInp.click({ clickCount: 3 });
            let phone = (sr.whatsapp || sr.phone || '501234567').replace(/\D/g, '');
            if (phone.startsWith('971')) phone = phone.substring(3);
            if (phone.startsWith('00971')) phone = phone.substring(5);
            await page.keyboard.type(phone);
            await sleep(1500);
        }
        await ensureSaved(page);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 8: ПУБЛИКАЦИЯ (регистрация имени с перебором вариантов)
    // ─────────────────────────────────────────────────────────────────────────
    log('8. Публикация и выбор домена...');
    await sleep(3000);
    
    // Пытаемся открыть окно публикации
    await safeEvaluate(page, () => {
        const btn = Array.from(document.querySelectorAll('a, button, span'))
            .find(el => /получить|get link|publish|опубликовать/i.test(el.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(5000);

    // Выбираем taplink.cc/
    await safeEvaluate(page, () => {
        const rad = Array.from(document.querySelectorAll('.modal-card-body .radio, input[type="radio"], label'))
            .find(el => el.innerText?.includes('taplink.cc') || el.querySelector('input[value*="taplink.cc"]'));
        if (rad) rad.click();
    });
    await sleep(2000);

    const suffixes = ['', '-auto', '-ae', '-cars', '1'];
    let finalDomain = sr.safe_name;

    for (const suffix of suffixes) {
        const attemptName = sr.safe_name + suffix;
        // log(`   Попытка регистрации: ${attemptName}...`);

        const inputSuccess = await retry(async () => {
            // 1. Находим именно текстовое поле (не радио-кнопки!)
            const targetInputFound = await safeEvaluate(page, () => {
                const modal = document.querySelector('.modal.is-active, .modal-card, .modal-content') || document.body;
                const inps = Array.from(modal.querySelectorAll('input:not([type="hidden"]), [contenteditable="true"]'))
                    .filter(i => i.offsetWidth > 0 && i.offsetHeight > 0);
                
                // Ищем то, которое похоже на домен (тип text или с плейсхолдером)
                const textInp = inps.find(i => i.type === 'text' || !i.type || i.placeholder?.includes('вашеимя'));
                if (textInp) {
                    textInp.focus();
                    return true;
                }
                return false;
            });

            if (!targetInputFound) {
                log('   [!] Текстовое поле не найдено, пробуем Tab...');
                await page.keyboard.press('Tab');
            }

            // 2. Очистка + Ввод
            await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await sleep(300);
            await page.keyboard.type(attemptName, { delay: 100 });
            await sleep(500);

            // 3. NUCLEAR FALLBACK (если визуально не ввелось)
            await safeEvaluate(page, (val) => {
                const i = document.activeElement;
                if (i && (i.tagName === 'INPUT' || i.contentEditable === 'true')) {
                    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
                    if (setter) try { setter.call(i, val); } catch(e) {}
                    i.value = val;
                    i.dispatchEvent(new Event('input', { bubbles: true }));
                    i.dispatchEvent(new Event('change', { bubbles: true }));
                    i.dispatchEvent(new Event('blur', { bubbles: true }));
                }
            }, attemptName);

            return true;
        }, 3, 2000).catch(() => false);

        await sleep(1000);

        // 4. ЖМЕМ "ПОДКЛЮЧИТЬ" (максимально агрессивно)
        const connectClicked = await safeEvaluate(page, () => {
            const btns = Array.from(document.querySelectorAll('button, .button, a'));
            const btn = btns.find(el => 
                /подключить|connect|save|опубликовать|продолжить/i.test(el.innerText || '') &&
                el.offsetWidth > 0
            );
            if (btn) {
                btn.scrollIntoView();
                btn.click();
                const rect = btn.getBoundingClientRect();
                return { x: rect.x + rect.width/2, y: rect.y + rect.height/2 };
            }
            return null;
        });

        if (connectClicked) {
            log('   [OK] Кнопка "Подключить" нажата (DOM)');
            await page.mouse.click(connectClicked.x, connectClicked.y).catch(() => {});
        } else {
            log('   [!] Кнопка "Подключить" не найдена, пробуем координаты...');
            await page.mouse.click(720, 810); 
        }

        await sleep(8000);

    // ПРОВЕРКА УСПЕХА
    const modalStatus = await safeEvaluate(page, () => {
        const modal = document.querySelector('.modal.is-active, .modal-card, .modal-content');
        if (!modal) return 'CLOSED_UNKNOWN'; 
        
        const txt = modal.innerText.toLowerCase();
        const hasQR = !!modal.querySelector('canvas, img[src*="qr"], [class*="qr"], .profile-published-modal');
        const hasSuccessTxt = txt.includes('готово') || txt.includes('ready') || txt.includes('поделиться') || txt.includes('share') || txt.includes('копировать') || txt.includes('published');
        
        if (hasQR || hasSuccessTxt) return 'SUCCESS_MODAL';
        if (txt.includes('занято') || txt.includes('taken') || !!modal.querySelector('.help.is-danger')) return 'TAKEN';
        return 'STILL_OPEN'; 
    });

    if (modalStatus === 'SUCCESS_MODAL' || modalStatus === 'CLOSED_UNKNOWN') {
        log(`   [SUCCESS] Домен зарегистрирован: ${attemptName}`);
        finalDomain = attemptName;
        
        // Закрываем модалку успеха максимально быстро
        await safeEvaluate(page, () => {
            const btn = Array.from(document.querySelectorAll('button, .delete, .modal-close'))
                .find(b => /понятно|got it|close|закрыть|ок|ok/i.test(b.innerText || '') || b.classList.contains('delete') || b.classList.contains('modal-close'));
            if (btn) btn.click();
        });
        await sleep(2000);
        break;
    } else if (modalStatus === 'TAKEN') {
        log(`   [!] Домен ${attemptName} занят.`);
    } else {
        // Если висим — пробуем нажать Enter или кликнуть по кнопке еще раз
        log(`   [?] Ожидание ответа... Пробуем подтвердить...`);
        await page.keyboard.press('Enter');
        await sleep(4000);
        
        // Вторичная проверка: вдруг домен всё-таки прошел?
        const isSuccessNow = await safeEvaluate(page, () => {
             const published = !!document.querySelector('.profile-published-modal') || document.body.innerText.includes('опубликовано') || document.body.innerText.includes('Published');
             if (published) return true;
             // Проверка в настройках, если модалка не вылезла
             const domainAddress = document.querySelector('.domain-address, .profile-link');
             return domainAddress && domainAddress.innerText.length > 5;
        });
        if (isSuccessNow) {
            log(`   [SUCCESS] Опубликовано (вторичная проверка)`);
            finalDomain = attemptName;
            break;
        }
    }
}

    log('✅ домен ок');
    log(`✅ Оформление завершено: https://taplink.cc/${finalDomain}`);
    return finalDomain;
}

// ─── Главный цикл ─────────────────────────────────────────────────────────────
async function run() {
    let showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => {
        rl.question('\n⚠️  СБРОСИТЬ ПРОГРЕСС? (y/N): ', ans => r(ans.trim().toLowerCase()));
    });
    rl.close();

    if (answer === 'y' || answer === 'д') {
        showrooms.forEach(s => {
            s.taplink_created  = false;
            s.taplink_designed = false;
            s.taplink_published = false;
        });
        await saveProgress(showrooms);
        log('Прогресс сброшен.');
    }

    const pending = showrooms.filter(s => !s.taplink_designed);
    log(`\n📋 Ожидают обработки: ${pending.length} из ${showrooms.length}`);
    if (testLimit > 0) log(`🧪 Тестовый режим: первые ${testLimit} шоурумов`);

    let processed = 0;

    for (let i = 0; i < showrooms.length; i++) {
        const sr = showrooms[i];
        if (sr.taplink_designed) continue;
        if (testLimit > 0 && processed >= testLimit) break;

        log(`\n[${ i + 1 }/${ showrooms.length }] >>> ${sr.name}`);

        const browser = await puppeteer.launch({
            headless: HEADLESS ? 'new' : false,
            // detached: true позволяет браузеру потенциально выжить при закрытии родительского процесса на Linux/macOS
            // На Windows это сложнее, но мы сделаем максимум
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1280,900',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars'
            ],
            defaultViewport: { width: 1280, height: 900 }
        });

        const mPage = await browser.newPage();
        const tPage = await browser.newPage();

        try {
            // Получаем email
            const email = await getVisualEmail(mPage);
            if (!email) {
                log('❌ Email не получен, пропускаем.');
                await browser.close();
                continue;
            }

            // Регистрируем аккаунт
            const registered = await registerTaplink(tPage, mPage, email, PASS);
            if (!registered) {
                log('❌ Регистрация не удалась, пропускаем.');
                await browser.close();
                continue;
            }
            log('✅ регистрация ок');

            sr.taplink_created = true;
            sr.taplink_email   = email;
            sr.taplink_url     = `https://taplink.cc/${sr.safe_name}`;
            await saveProgress(showrooms);
            
            // СРАЗУ ЛОГИРУЕМ В EXCEL (статус: CREATED)
            await updateExcelReport({ ...sr, taplink_published: false });

            // Оформляем профиль
            const finalName = await designShowroom(tPage, sr);
            if (finalName) {
                sr.taplink_designed  = true;
                sr.taplink_published = true;
                sr.taplink_url = `https://taplink.cc/${finalName}`;
                await saveProgress(showrooms);
                
                // ОБНОВЛЯЕМ EXCEL (статус: SUCCESS)
                await updateExcelReport(sr);
                processed++;
                log(`✅ [${processed}] ${sr.name} — ГОТОВ (домен: ${finalName})`);
                log('✅ окончание ок');
            }

        } catch (e) {
            log(`❌ КРИТИЧЕСКАЯ ОШИБКА [${sr.name}]: ${e.message}`);
            log(e.stack || '');
        } finally {
            await sleep(1000);
            await browser.close().catch(() => {}); // Закрываем браузер для чистоты и скорости
        }
    }

    log(`\n${'='.repeat(60)}`);
    log(`🏁 МАРАФОН ЗАВЕРШЕН. Обработано: ${processed} шоурумов.`);
    log('='.repeat(60));
}

run();
