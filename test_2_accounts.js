import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import ExcelJS from 'exceljs';

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath  = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath   = path.join(process.cwd(), 'data', 'bot_log.txt');
const excelPath = path.join(process.cwd(), 'taplink_report.xlsx');
const PASS      = 'SecureShowroom#2024';
const testLimit = 0; // 0 = обрабатывать все

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

async function saveProgress(showrooms) {
    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
}

async function appendReport(sr) {
    const workbook = new ExcelJS.Workbook();
    let worksheet;
    
    if (fs.existsSync(excelPath)) {
        await workbook.xlsx.readFile(excelPath);
        worksheet = workbook.getWorksheet('Отчет Taplink') || workbook.addWorksheet('Отчет Taplink');
    } else {
        worksheet = workbook.addWorksheet('Отчет Taplink');
        worksheet.columns = [
            { header: 'Название шоурума', key: 'name', width: 30 },
            { header: 'Ссылка Taplink', key: 'url', width: 45 },
            { header: 'Email', key: 'email', width: 35 },
            { header: 'Пароль', key: 'pass', width: 20 },
            { header: 'Дата', key: 'date', width: 20 },
        ];
        worksheet.getRow(1).font = { bold: true };
    }

    // Проверяем, нет ли уже такой записи
    let exists = false;
    worksheet.eachRow((row, rowNumber) => {
        if (row.getCell(1).value === sr.name) exists = true;
    });

    if (!exists) {
        worksheet.addRow({
            name: sr.name,
            url: sr.taplink_url,        // Соответствует key: 'url'
            email: sr.taplink_email,    // Соответствует key: 'email'
            pass: sr.taplink_pass || PASS, // Соответствует key: 'pass'
            date: new Date().toLocaleDateString() // Соответствует key: 'date'
        });
        await workbook.xlsx.writeFile(excelPath);
        log(`📊 Данные ${sr.name} добавлены в Excel.`);
    }
}

// ─── Почта (стабильная v10.04) ────────────────────────────────────────────────
async function getVisualEmail(mailPage) {
    log('--- ПОЛУЧЕНИЕ ПОЧТЫ (1secmail) ---');
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
    } catch (e) {
        log(`[!] Ошибка получения почты: ${e.message}`);
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
        } catch (e) {}
        await sleep(2000);
    }
    log('[!] Код не найден.');
    return null;
}

// ─── Регистрация (стабильная v10.04) ─────────────────────────────────────────
async function registerTaplink(tPage, mailPage, email, password) {
    log(`Регистрация: ${email}`);
    await tPage.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await tPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await tPage.type('input[type="email"]', email, { delay: 50 });

    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /продолжить|далее|next/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(5000);

    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"], a'))
            .find(b => /почта существует|да, все верно|yes|continue/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(5000);

    const requiresCode = await tPage.evaluate(() =>
        document.body.innerText.includes('код') || !!document.querySelector('input[autocomplete="one-time-code"]')
    );
    if (requiresCode) {
        const code = await getVisualCode(mailPage);
        if (code) {
            await tPage.bringToFront();
            const inputs = await tPage.$$('input:not([type="hidden"])');
            let entered = 0;
            for (const inp of inputs) {
                if (entered >= 6) break;
                await inp.focus();
                await inp.type(code[entered], { delay: 100 });
                entered++;
            }
            await sleep(2000);
            await tPage.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => /продолжить|далее/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(8000);
        }
    }

    await tPage.waitForSelector('input[type="password"]', { timeout: 15000 });
    const passes = await tPage.$$('input[type="password"]');
    for (const p of passes) await p.type(password, { delay: 50 });

    await tPage.evaluate(() => {
        const cb = document.querySelector('input[type="checkbox"]');
        if (cb) cb.click();
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => /регистр|далее|войти|продолжить/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(10000);
    return true;
}

// ─── Вспомогательные функции дизайна ─────────────────────────────────────────

// Сохранить открытый модальный блок
async function ensureSaved(page) {
    log('   Попытка сохранения...');
    for (let i = 0; i < 4; i++) {
        try {
            const closed = await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll(
                    '.modal-card-foot .is-primary, button.is-primary, button'
                ));
                const btn = btns.find(b =>
                    b.innerText?.includes('Сохранить') ||
                    b.innerText?.includes('Save') ||
                    b.innerText?.includes('Готово') ||
                    b.innerText?.includes('Done')
                );
                if (btn) { btn.click(); return false; }
                return true; // Уже закрыто
            });
            await sleep(3000);
            
            // Проверка видимости модалки с обработкой detached frame
            const modalVisible = await page.evaluate(() => {
                const modal = document.querySelector('.modal-card, .modal.is-active');
                return modal && modal.offsetHeight > 0;
            }).catch(() => false); // Если фрейм отвалился, считаем что модалка исчезла (или обрабатываем ошибку)
            
            if (!modalVisible) { log('   [OK] Сохранено.'); return true; }
        } catch (e) {
            log(`   [!] Ошибка в ensureSaved (возможно detached frame): ${e.message}`);
            await sleep(2000);
        }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1000);
    return false;
}

// Добавить разделитель
async function addSeparator(page) {
    try {
        if (page.isClosed()) return;
        log('   + Разделитель...');
        // Проверка фрейма
        await page.evaluate(() => document.body.offsetWidth).catch(() => sleep(2000));
        
        await openNewBlockMenu(page);
        await sleep(2500);
        
        await page.evaluate(() => {
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
    const clicked = await page.evaluate(() => {
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
        await page.evaluate(() => document.body.offsetWidth).catch(() => sleep(1000));
        await sleep(1500);

        const clicked = await page.evaluate((targetName) => {
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
        const pos = await page.evaluate((txt) => {
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

        const clicked = await page.evaluate((sel) => {
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
        await page.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(5000);
    }

    // Закрываем мусорные попапы
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, span, div, a'));
        const close = btns.find(b => /понятно|закрыть|пропустить|skip|close|got it/i.test(b.innerText || ''));
        if (close) close.click();
    });
    await sleep(1500);




    // ─────────────────────────────────────────────────────────────────────────
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
        
        // DEBUG: Логируем состояние DOM перед началом
        await page.evaluate(() => {
            const blocks = Array.from(document.querySelectorAll('*')).filter(el => 
                el.className && typeof el.className === 'string' && el.className.includes('block')
            );
            console.log(`[DEBUG] Найдено элементов с классом block: ${blocks.length}`);
        });

        // ПРОВЕРКА: Ищем блок по любым признакам (даже если это просто первый div в редакторе)
        let avatarOpened = await page.evaluate(() => {
            // 1. Ищем по точным признакам аватара или дефолтного блока
            const av = document.querySelector('[data-block-type="avatar"], .is-avatar-block, .tap-avatar, .btn-link-block, .app-pages-site-block');
            if (av) {
                av.scrollIntoView();
                // Используем dispatchEvent для надежности если обычный click не сработал
                av.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                av.click(); 
                return true;
            }
            // 2. Ищем ВООБЩЕ любой блок в списке если выше не сработало
            const anyBlock = document.querySelector('.taplink-block, .page-block, .app-block-item');
            if (anyBlock) {
                anyBlock.scrollIntoView();
                anyBlock.click();
                return true;
            }
            return false;
        }).catch(() => false);

        if (avatarOpened) {
            log('   [OK] Существующий блок найден/кликнут. Ждем открытия модалки...');
        } else {
            log('   [!] Похоже, страница пуста. Пробуем создать новый блок...');
            await openNewBlockMenu(page);
            await selectBlock(page, 'Аватар');
            avatarOpened = true;
        }
        
        await sleep(7000); 
        await page.screenshot({ path: 'debug_step1.png' }).catch(() => {});

        // Проверяем: открылся ли диалог? (Ищем любое активное модальное окно)
        let isModalVisible = await page.evaluate(() => {
            const modal = document.querySelector('.modal.is-active, .modal-card, .modal-content, [class*="modal"]');
            if (!modal) return false;
            // Проверяем наличие кнопки сохранения внутри модалки
            const hasSave = Array.from(modal.querySelectorAll('button'))
                .some(b => /сохранить|save|применить|apply/i.test(b.innerText || ''));
            return modal.offsetHeight > 100 && hasSave;
        });

        if (!isModalVisible) {
            log('   [!] Модалка не найдена — пробуем найти по вкладкам (КОНТЕНТ/ДИЗАЙН)...');
            isModalVisible = await page.evaluate(() => {
                const text = document.body.innerText;
                return text.includes('КОНТЕНТ') && text.includes('ДИЗАЙН') && text.includes('НАСТРОЙКИ');
            });
        }

        if (!isModalVisible) {
            log('   [!] Всё еще не видим модалку — создаем новый блок (fallback)');
            await openNewBlockMenu(page);
            await selectBlock(page, 'Аватар');
            await sleep(5000);
        } else {
            log('   [OK] Окно редактирования Аватара открыто');
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
    const links = [
        { title: '🏢 Official Showroom',           sub: `${sr.name} — full catalog`,        url: sr.profile_url },
        { title: '🚗 Cars for Sale',               sub: 'New arrivals & current stock',     url: sr.cars_url    },
        { title: '🔑 Rent a Car',                  sub: 'Luxury & sports cars daily',       url: sr.rent_url    },
        { title: '🔢 Number Plates',               sub: 'Exclusive VIP plates',             url: sr.numbers_url },
        { title: '✅ Sold Cars',                   sub: 'Our completed deals gallery',      url: sr.sold_url    },
    ];

    for (const link of links) {
        if (!link.url) {
            log(`   [skip] Нет URL для: ${link.title}`);
            continue;
        }
        log(`   + ${link.title}`);

        const addBtnLink = await page.waitForSelector('button.is-new-block', { timeout: 10000 }).catch(() => null);
        if (!addBtnLink) { log('   [!] Кнопка "Добавить блок" не найдена'); continue; }
        await addBtnLink.click();
        await sleep(3000);
        await selectBlock(page, 'Ссылка');
        await sleep(4000);

        // Заполняем поля: заголовок (inps[0]) + подзаголовок (inps[1]) + URL (inps[2])
        const inps = await page.$$('.modal-card-body input');
        if (inps.length >= 2) {
            await inps[0].triple_click?.() || await inps[0].click({ clickCount: 3 });
            await inps[0].type(link.title, { delay: 5 });
            if (inps[1]) {
                await inps[1].click({ clickCount: 3 });
                await inps[1].type(link.sub, { delay: 5 });
            }
            if (inps[2]) {
                await inps[2].click({ clickCount: 3 });
                await inps[2].type(link.url, { delay: 5 });
            } else if (inps[1]) {
                // Если нет третьего — ищем URL-поле по placeholder
                const urlInp = await page.$('input[type="url"], input[placeholder*="http"], input[name*="url"]');
                if (urlInp) {
                    await urlInp.click({ clickCount: 3 });
                    await urlInp.type(link.url, { delay: 5 });
                }
            }
        }
        await sleep(1000);

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
    // ШАГ 8: ПУБЛИКАЦИЯ (регистрация имени с перебором вариантов до победного)
    // ─────────────────────────────────────────────────────────────────────────
    log('8. Публикация и выбор домена...');
    await sleep(3000);
    
    // Пытаемся открыть окно публикации: ищем кнопку "Опубликовать", "Получить ссылку" или "Publish"
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('a, button, span, .button'));
        const btn = btns.find(el => 
            /получить|get link|publish|опубликовать|настроить|setup/i.test(el.innerText || '') &&
            el.offsetHeight > 0
        );
        if (btn) btn.click();
    });
    await sleep(5000);

    // Выбираем taplink.cc/ (первый вариант в списке)
    await page.evaluate(() => {
        const rad = document.querySelector('.modal-card-body .radio, .modal-card-body input[type="radio"], .modal-card-body label');
        if (rad) rad.click();
    });
    await sleep(2000);

    const suffixes = ['', '-auto', '-ae', '-cars', '1', '2', '-uae', '-dubai', '-showroom', '777', '-vip'];
    let finalDomain = sr.safe_name;
    let registeredSuccess = false;

    for (const suffix of suffixes) {
        const attemptName = sr.safe_name + suffix;
        log(`   >>> Попытка регистрации: ${attemptName}...`);

        // Ищем поле ввода максимально надежно
        const inputFound = await page.evaluate((val) => {
            const modal = document.querySelector('.modal.is-active, .modal-card');
            if (!modal) return false;
            
            const inputs = Array.from(modal.querySelectorAll('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'));
            if (inputs.length > 0) {
                const inp = inputs[0];
                inp.focus();
                inp.value = ''; // Очищаем через DOM
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            }
            return false;
        }, attemptName);

        if (inputFound) {
            // Печатаем через клавиатуру для имитации реальности
            await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await sleep(500);
            await page.keyboard.type(attemptName, { delay: 50 });
        } else {
            log('   [!] Поле ввода не найдено через DOM, пробуем клик по координатам...');
            await page.mouse.click(640, 500); // Примерный центр модалки
            await sleep(500);
            await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(attemptName, { delay: 50 });
        }
        await sleep(2000);

        // Жмем "Подключить" (Connect / Save)
        await page.evaluate(() => {
            const modal = document.querySelector('.modal.is-active');
            if (!modal) return;
            const btns = Array.from(modal.querySelectorAll('button, .button, a'));
            const btn = btns.find(el => /подключить|connect|save|публиковать|готово|done/i.test(el.innerText || ''));
            if (btn) {
                btn.scrollIntoView();
                btn.click();
            }
        });
        await sleep(8000); 

        // ПРОВЕРКА УСПЕХА: Окно должно ИСЧЕЗНУТЬ или появиться успех (кнопка копирования)
        const status = await page.evaluate((val) => {
            const modal = document.querySelector('.modal.is-active');
            if (!modal) return 'CLOSED'; // Успех, окно закрылось
            
            const txt = modal.innerText.toLowerCase();
            // Если видим текст про "копировать", "qr-код" — это успех
            if (txt.includes('скопировать') || txt.includes('copy link') || txt.includes('qr-код') || txt.includes('get link')) {
                // Извлекаем актуальный домен из поля ввода (Taplink может убрать дефис и т.д.)
                const inp = modal.querySelector('input');
                if (inp && inp.value.includes('taplink.cc/')) {
                    const extracted = inp.value.split('taplink.cc/')[1].split('?')[0].split('#')[0].trim();
                    return { type: 'SUCCESS_UI', domain: extracted };
                }
                return { type: 'SUCCESS_UI', domain: val }; // Fallback
            }
            // Если видим текст про "занято", "ошибку" или красную помощь
            if (txt.includes('занято') || txt.includes('taken') || txt.includes('уже используется') || !!modal.querySelector('.is-danger')) {
                return { type: 'TAKEN' };
            }
            return { type: 'STILL_OPEN' }; // Возможно просто тормозит
        }, attemptName);

        if (status === 'CLOSED' || status.type === 'SUCCESS_UI') {
            const registeredDomain = (status.type === 'SUCCESS_UI' && status.domain) ? status.domain : attemptName;
            log(`   [SUCCESS] Домен зарегистрирован: ${registeredDomain}`);
            finalDomain = registeredDomain;
            registeredSuccess = true;
            break;
        } else if (status.type === 'TAKEN') {
            log(`   [!] Домен ${attemptName} занят, пробуем следующий...`);
        } else {
            log(`   [?] Окно все еще открыто. Повторный клик "Подключить"...`);
            await page.keyboard.press('Enter');
            await sleep(5000);
            const secondCheck = await page.evaluate((val) => {
                const modal = document.querySelector('.modal.is-active');
                if (!modal) return true;
                const txt = modal.innerText.toLowerCase();
                const isSuccess = txt.includes('скопировать') || txt.includes('qr-код');
                if (isSuccess) {
                    const inp = modal.querySelector('input');
                    if (inp && inp.value.includes('taplink.cc/')) {
                        return inp.value.split('taplink.cc/')[1].split('?')[0].trim();
                    }
                    return val;
                }
                return false;
            }, attemptName);
            if (secondCheck) {
                log(`   [SUCCESS] Домен зарегистрирован со второй попытки.`);
                finalDomain = (typeof secondCheck === 'string') ? secondCheck : attemptName;
                registeredSuccess = true;
                break;
            }
        }
    }

    if (!registeredSuccess) {
        log('   [!] Не удалось подобрать свободный домен из списка суффиксов.');
    }

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
            headless: false,
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

            sr.taplink_created = true;
            sr.taplink_email   = email;
            sr.taplink_url     = `https://taplink.cc/${sr.safe_name}`;
            await saveProgress(showrooms);

            // Оформляем профиль
            const finalName = await designShowroom(tPage, sr);
            if (finalName) {
                sr.taplink_designed  = true;
                sr.taplink_published = true;
                sr.taplink_url = `https://taplink.cc/${finalName}`; // Сохраняем реальное имя
                await saveProgress(showrooms);
                await appendReport(sr); // Добавляем в Excel
                processed++;
                log(`✅ [${processed}] ${sr.name} — ГОТОВ (домен: ${finalName})`);
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
