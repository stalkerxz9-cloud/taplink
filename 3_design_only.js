/**
 * 3_design_only.js
 * Только оформление — для шоурумов у которых taplink_created=true, но taplink_designed=false
 * Логинится и выполняет полное оформление профиля.
 * 
 * Запуск: node 3_design_only.js
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');

function log(msg) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${time}] ${msg}`);
}
async function clickAddBlockNative(page) {
    try {
        await page.keyboard.press('Escape').catch(()=>{}); // убить окно
        await new Promise(r => setTimeout(r, 500));
        
        const bounds = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('div, span, button, a'))
                .find(b => b.innerText && b.innerText.trim().toLowerCase() === 'добавить блок');
            if (btn) {
                const rect = btn.getBoundingClientRect();
                // Найдём все тултипы и скроем их
                document.querySelectorAll('div').forEach(el => {
                    const z = window.getComputedStyle(el).zIndex;
                    if (z !== 'auto' && parseInt(z) >= 50 && el.offsetHeight > window.innerHeight * 0.5) {
                        el.style.opacity = '0';
                        el.style.pointerEvents = 'none';
                    }
                });
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
            return null;
        });
        
        if (bounds) {
            await page.mouse.click(bounds.x, bounds.y);
            await new Promise(r => setTimeout(r, 500));
            // И ещё раз на всякий случай
            await page.mouse.click(bounds.x, bounds.y);
        } else {
            // Фолбэк на программный клик
            await page.evaluate(() => {
                let btn = document.querySelector('.btn-add-block, [class*="add-block"]');
                if (!btn) btn = Array.from(document.querySelectorAll('div, span, button, a')).find(b => b.innerText && b.innerText.trim().toLowerCase() === 'добавить блок');
                if (btn) { btn.click(); setTimeout(() => btn.click(), 500); }
            });
        }
    } catch(e) {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Логин ────────────────────────────────────────────────────────────────────
async function loginTaplink(page, email, password) {
    log(`Логин: ${email}`);

    // Пробуем разные URL логина
    const loginUrls = [
        'https://taplink.ru/profile/auth/signin/',
        'https://taplink.ru/profile/auth/login/',
    ];

    let formFound = false;
    for (const url of loginUrls) {
        log(`Пробуем: ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
        await sleep(2000);
        try {
            await page.waitForSelector('input', { timeout: 10000 });
            formFound = true;
            log(`Форма найдена на: ${url} ✅`);
            break;
        } catch {
            log(`Форма не найдена на: ${url}, пробуем следующий...`);
        }
    }

    // Фолбек: кликаем кнопку «Войти» на главной
    if (!formFound) {
        log('Пробуем войти через кнопку на главной странице...');
        await page.goto('https://taplink.ru/', { waitUntil: 'networkidle0', timeout: 60000 });
        await sleep(2000);
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('a, button'))
                .find(b => /войти|вход|sign in|login/i.test(b.innerText || ''));
            if (btn) btn.click();
        });
        await sleep(3000);
        try {
            await page.waitForSelector('input', { timeout: 15000 });
            formFound = true;
            log('Форма найдена через кнопку на главной ✅');
        } catch {
            await page.screenshot({ path: 'data/login_debug.png', fullPage: true });
            throw new Error('Форма логина не найдена нигде. Скриншот: data/login_debug.png');
        }
    }

    await sleep(1000);
    const emailInput = await page.$('input[type="email"], input[type="text"], input');
    if (!emailInput) {
        await page.screenshot({ path: 'data/login_debug.png', fullPage: true });
        throw new Error('Поле email не найдено. Скриншот: data/login_debug.png');
    }


    await emailInput.click({ clickCount: 3 });
    await emailInput.type(email, { delay: 50 });

    // Нажимаем «Продолжить» или аналог
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
            .find(b => /продолжить|далее|войти|login|next|sign in/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(3000);

    // Если появилось поле пароля — вводим
    const passInput = await page.$('input[type="password"]');
    if (passInput) {
        await passInput.type(password, { delay: 50 });
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                .find(b => /войти|вход|login|sign in|продолжить/i.test(b.innerText || b.value || ''));
            if (btn) btn.click();
        });
        await sleep(6000);
    } else {
        // Может быть одношаговый вход — оба поля на странице сразу
        const allInputs = await page.$$('input[type="password"]');
        if (allInputs.length > 0) {
            for (const inp of allInputs) await inp.type(password, { delay: 50 });
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                    .find(b => /войти|login|sign in/i.test(b.innerText || b.value || ''));
                if (btn) btn.click();
            });
            await sleep(6000);
        }
    }

    const url = await page.url();
    if (url.includes('/auth/')) {
        await page.screenshot({ path: 'data/login_fail.png', fullPage: true });
        throw new Error(`Логин не удался (URL: ${url}). Скриншот: data/login_fail.png`);
    }
    log(`Логин успешен ✅ (URL: ${url})`);
}

// ─── Оформление ───────────────────────────────────────────────────────────────
async function setupShowroom(page, sr) {
    log(`\n=== Оформление: ${sr.name} ===`);
    log(`    URL: ${sr.taplink_url}`);

    const showroomDir = path.join(process.cwd(), 'data', sr.safe_name);

    try {
        await page.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(3000);

        const afterUrl = await page.url();
        if (afterUrl.includes('/templates/')) {
            log('Обнаружен экран выбора шаблона. Нажимаем "Пустой шаблон"...');
            await page.evaluate(() => {
                const elements = Array.from(document.querySelectorAll('*'));
                const emptyBtn = elements.find(el => el.innerText && el.innerText.trim() === 'Пустой шаблон');
                if (emptyBtn) {
                    const link = emptyBtn.closest('a') || emptyBtn.closest('[role="button"]') || emptyBtn;
                    link.click();
                }
            });
            await sleep(4000);
            
            await page.evaluate(() => {
                const btns = Array.from(document.querySelectorAll('button'));
                const applyBtn = btns.find(b => /применить|выбрать|apply|choose/i.test(b.innerText || ''));
                if (applyBtn) applyBtn.click();
            });
            await sleep(4000);
        }

        // Закрываем любые обучающие попапы и инструкции от Taplink (клик в пустую область)
        log('Кликаем по экрану для закрытия инструкций...');
        await sleep(1500);
        try {
            await page.mouse.click(10, 10);
            await sleep(500);
            await page.mouse.click(100, 100);
            await sleep(1000);
        } catch(e) {}
        
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, div[role="button"], a, span'));
            const skipBtns = btns.filter(b => /понятно|закрыть|пропустить|начать|далее|skip|close|got it|next/i.test(b.innerText || ''));
            skipBtns.forEach(b => { try { b.click(); } catch(e) {} });
        });
        await sleep(2000);

        // ── 1. ЛОГОТИП & ИМЯ ──────────────────────────────────────────────
        log('1️⃣  Загрузка логотипа...');
        const logoFile = path.join(showroomDir, 'logo.jpg');
        if (fs.existsSync(logoFile)) {
            try {
                let fileInput = await page.$('input[type="file"]');
                if (!fileInput) {
                    await page.evaluate(() => {
                        const firstBlock = document.querySelector('.block-elem, [data-id], [class*="block"] img');
                        if (firstBlock) firstBlock.click();
                        else {
                            const els = Array.from(document.querySelectorAll('img, div[class*="avatar"]'));
                            if (els.length > 0) els[0].click();
                        }
                    });
                    await sleep(1500);
                    fileInput = await page.$('input[type="file"]');
                }
                if (fileInput) {
                    await fileInput.uploadFile(logoFile);
                    await sleep(3000);
                    // Сохраняем лого
                    await page.evaluate(() => {
                        const btn = Array.from(document.querySelectorAll('button'))
                            .find(b => /сохран|save|применить/i.test(b.innerText || ''));
                        if (btn) btn.click();
                    });
                    await sleep(2000);
                    log('   Логотип загружен ✅');
                }
            } catch (e) { log(`   ❌ Ошибка лого: ${e.message}`); }
        }

        // ── 2. BIO (Текстовый блок) ───────────────────────────────────────
        if (sr.bio) {
            log('2️⃣  Добавление BIO (Текстовый блок)...');
            try {
                await clickAddBlockNative(page);
                await sleep(1500);
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('.block-types-item, button, span, div'))
                        .find(b => /текст|text/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(1500);
                const ta = await page.$('textarea, [contenteditable="true"]');
                if (ta) {
                    await ta.click();
                    await ta.type(sr.bio, { delay: 5 });
                }
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button'))
                        .find(b => /сохран|save/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(2000);
            } catch (e) { log(`   ❌ Ошибка BIO: ${e.message}`); }
        }

        // ── 3. ГАЛЕРЕЯ (КАРУСЕЛЬ 10 ФОТО) ──────────────────────────────────
        log('3️⃣  Добавление галереи (10 фото)...');
        await page.evaluate(() => {
            const addBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]'))
                .find(b => /(добавить блок|add block)/i.test(b.innerText || ''));
            if (addBtn) addBtn.click();
        });
        await sleep(1000);
        const galleryBtnClicked = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('.block-types-item, button, span, div'))
                .find(b => /галерея|gallery|карусель|carousel/i.test(b.innerText || ''));
            if (btn) { btn.click(); return true; }
            return false;
        });

        if (galleryBtnClicked) {
            await sleep(1500);
            for (let i = 1; i <= 10; i++) {
                const carImg = path.join(showroomDir, `car_${i}.jpg`);
                if (fs.existsSync(carImg)) {
                    const inp = await page.$('input[type="file"]');
                    if (inp) {
                        await inp.uploadFile(carImg);
                        await sleep(2000);
                        log(`   Фото ${i} загружено ✅`);
                    }
                }
            }
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => /сохран|save/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(2000);
        }

        // ── 4. ССЫЛКИ (СТРОГИЙ ПОРЯДОК 1-5) ──────────────────────────────
        const links = [
            { title: 'Шоурум на Auto.ae',     url: sr.profile_url },
            { title: 'Каталог автомобилей',   url: sr.cars_url    },
            { title: 'Аренда авто',            url: sr.rent_url    },
            { title: 'Автомобильные номера',   url: sr.numbers_url },
            { title: 'Проданные авто',         url: sr.sold_url    },
        ];

        log('4️⃣  Добавление ссылок в строгом порядке...');
        for (const link of links) {
            await page.evaluate(() => {
                const addBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]'))
                    .find(b => /(добавить блок|add block)/i.test(b.innerText || ''));
                if (addBtn) addBtn.click();
            });
            await sleep(1000);
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('.block-types-item, button, span, div'))
                    .find(b => /ссылка|link|кнопка/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(1500);

            const inputs = await page.$$('input[type="text"], input[type="url"]');
            if (inputs.length >= 2) {
                await inputs[0].type(link.title, { delay: 10 });
                await inputs[1].type(link.url || sr.profile_url, { delay: 10 });
            }
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => /сохран|save|добавить/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(1500);
            log(`   Ссылка добавлена: ${link.title} ✅`);
        }

        // ── 5. WHATSAPP / СВЯЗАТЬСЯ ──────────────────────────────────────
        if (sr.whatsapp) {
            log('5️⃣  Добавление кнопки WhatsApp...');
            await page.evaluate(() => {
                const addBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]'))
                    .find(b => /(добавить блок|add block)/i.test(b.innerText || ''));
                if (addBtn) addBtn.click();
            });
            await sleep(1000);
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('.block-types-item, button, span, div'))
                    .find(b => /whatsapp|связаться|мессенджер/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(1500);
            const waInput = await page.$('input[type="text"]');
            if (waInput) await waInput.type(sr.whatsapp, { delay: 10 });
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => /сохран|save/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(2000);
        }

        // ── 6. ФОНОВОЕ ИЗОБРАЖЕНИЕ ──────────────────────────────────────────
        const bgFile = path.join(showroomDir, 'banner.jpg');
        if (fs.existsSync(bgFile)) {
            log('6️⃣  Установка фона (баннер)...');
            await page.goto('https://taplink.ru/profile/settings/design/', { waitUntil: 'networkidle2' });
            await sleep(2500);
            const bgBtnClicked = await page.evaluate(() => {
                const found = Array.from(document.querySelectorAll('button, label, div[role="button"]'))
                    .find(b => /своё|свой|фон|загруз|background|upload/i.test(b.innerText || b.getAttribute('aria-label') || ''));
                if (found) { found.click(); return true; }
                return false;
            });
            if (bgBtnClicked) {
                await sleep(1000);
                const bgInput = await page.$('input[type="file"]');
                if (bgInput) {
                    await bgInput.uploadFile(bgFile);
                    await sleep(4000);
                    await page.evaluate(() => {
                        const btn = Array.from(document.querySelectorAll('button'))
                            .find(b => /сохран|save|применить/i.test(b.innerText || ''));
                        if (btn) btn.click();
                    });
                    await sleep(2000);
                    log('   Фон установлен ✅');
                }
            }
        }


        log(`\n✅ Оформление "${sr.name}" завершено!`);
        return true;
    } catch (e) {
        log(`\n❌ Критическая ошибка оформления: ${e.message}`);
        return false;
    }
}

// ─── ГЛАВНАЯ ФУНКЦИЯ ──────────────────────────────────────────────────────────
async function run() {
    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Ищем шоурумы: зарегистрированы, но НЕ оформлены
    const targets = showrooms.filter(s => s.taplink_created && !s.taplink_designed);

    if (targets.length === 0) {
        log('Нет шоурумов для оформления (все уже готовы или ни один не зарегистрирован).');
        return;
    }

    // Для теста берём только первый. Убери .slice(0,1) для обработки всех.
    const toProcess = targets.slice(0, 1);
    log(`Найдено для оформления: ${targets.length}. Обрабатываем: ${toProcess.length}.`);

    const browser = await puppeteer.launch({
        headless: false,
        args: [
            '--no-sandbox', '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', '--window-size=1280,900'
        ],
        defaultViewport: null,
    });

    for (const sr of toProcess) {
        log(`\n>>> Шоурум: ${sr.name}`);
        const page = await browser.newPage();
        try {
            if (!sr.taplink_email || !sr.taplink_pass) {
                log('❌ Нет email/пароля для логина — пропускаем.');
                await page.close();
                continue;
            }

            await loginTaplink(page, sr.taplink_email, sr.taplink_pass);
            const designed = await setupShowroom(page, sr);

            if (designed) {
                sr.taplink_designed = true;
                fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
                log(`💾 Сохранено: ${sr.name}`);
            }
        } catch (e) {
            log(`❌ Ошибка для ${sr.name}: ${e.message}`);
        }
        // Оставляем вкладку открытой для проверки — не закрываем
    }

    log('\n=== Готово! Браузер оставлен открытым для проверки. ===');
    log('Посмотри профиль и закрой браузер вручную.');
}

run();
