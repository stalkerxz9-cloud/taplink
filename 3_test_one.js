import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const PASS = 'SecureShowroom#2024';

function log(msg) {
    const time = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${time}] ${msg}`);
}

async function clickAddBlockNative(page) {
    try {
        await page.keyboard.press('Escape').catch(()=>{}); // убить окно
        await new Promise(r => setTimeout(r, 500));
        
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('*'));
            const addBtn = btns.find(b => b.children.length === 0 && b.innerText && b.innerText.trim().toLowerCase() === 'добавить блок');
            
            if (addBtn) {
                // Если блок найден, кликаем по нему поднимаясь по иерархии
                let curr = addBtn;
                for (let i = 0; i < 4; i++) {
                    if (curr) { try { curr.click(); } catch(e){} curr = curr.parentElement; }
                }
            } else {
                // Дополнительный поиск по старым классам, если это единственная кнопка
                let alt = document.querySelector('.btn-add-block');
                if (alt) alt.click();
            }
        });
        await new Promise(r => setTimeout(r, 800));
    } catch(e) {}
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Почта (1secmail.cc) ──────────────────────────────────────────────────────
async function getVisualEmail(mailPage) {
    log('--- ПОЛУЧЕНИЕ ПОЧТЫ ---');
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

            if (code) {
                log(`Код найден: ${code}`);
                return code;
            }
        } catch (e) {
            log(`[КОД ОШИБКА] ${e.message}`);
        }
        log(`Попытка ${i + 1}/20...`);
    }
    log('Код не получен.');
    return null;
}

// ─── Регистрация ──────────────────────────────────────────────────────────────
async function registerTaplink(tPage, mailPage, email, password) {
    log(`Регистрация: ${email}`);
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

// ─── Оформление профиля ───────────────────────────────────────────────────────
async function setupShowroom(page, sr) {
    log(`[${sr.name}] Начинаем оформление...`);

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
        await sleep(3000);

        let afterUrl = await page.url();

        if (afterUrl.includes('/templates/')) {
            log('Обнаружен экран выбора шаблона. Переходим к хардкорному физическому кликеру (как у вас на скриншотах)...');
            
            async function hardwareClick(text) {
                const coords = await page.evaluate((searchStr) => {
                    // Ищем самый глубокий текстовый узел
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    while (node = walker.nextNode()) {
                        if (node.nodeValue.trim().toLowerCase() === searchStr.toLowerCase()) {
                            const rect = node.parentElement.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0) {
                                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                            }
                        }
                    }
                    return null;
                }, text);

                if (coords) {
                    log(`   [+] Бьем мышкой по "${text}" -> X: ${Math.round(coords.x)}, Y: ${Math.round(coords.y)}`);
                    await page.mouse.click(coords.x, coords.y);
                    await sleep(500);
                    // Двойной клик на всякий случай
                    await page.mouse.click(coords.x, coords.y);
                } else {
                    log(`   [!] Текст "${text}" не виден на экране!`);
                }
            }

            await sleep(3000); // Ждём прогрузки стартового ИИ-баннера
            
            log('1. Кликаем по вкладке...');
            await hardwareClick('Мобильные сайты');
            await sleep(3000);

            log('2. Кликаем по шаблону...');
            await hardwareClick('Пустой шаблон');
            await sleep(3000);
            
            log('3. Кликаем по кнопке во всплывающем окне...');
            await hardwareClick('Да');
            await sleep(6000);
        }

        // Закрываем любые обучающие попапы и инструкции от Taplink
        log('Убиваем туториал и приветственные баннеры AI...');
        await sleep(1500);
        try {
            await page.mouse.click(10, 10);
            await sleep(500);
        } catch(e) {}
        
        await page.evaluate(() => {
            // Ищем синюю кнопку "Добавить блок" из баннера
            const aiBtn = Array.from(document.querySelectorAll('button, a, div, span'))
                .find(b => b.innerText && String(b.innerText).trim().toLowerCase() === 'добавить блок');
            
            if (aiBtn) {
                let curr = aiBtn;
                for (let i = 0; i < 6; i++) {
                    if (curr) { try { curr.click(); } catch(e) {} curr = curr.parentElement; }
                }
            }
            
            const btns = Array.from(document.querySelectorAll('button, div[role="button"], a, span'));
            const skipBtns = btns.filter(b => /понятно|закрыть|пропустить|начать|далее|skip|close|got it|next/i.test(b.innerText || ''));
            skipBtns.forEach(b => { try { b.click(); } catch(e) {} });
        });
        await sleep(2000);
        // Еще раз кликаем в пустоту, чтобы закрыть боковое меню "Добавить блок", если оно открылось
        try { await page.mouse.click(10, 10); } catch(e) {}
        await sleep(1000);

        // Функция для точного выбора блока из меню
        async function clickBlockMenuItem(regexStr) {
            await page.evaluate((reg) => {
                const regex = new RegExp(reg, 'i');
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                let node;
                while (node = walker.nextNode()) {
                    if (regex.test(node.nodeValue.trim())) {
                        const el = node.parentElement;
                        // Элемент должен быть видимым
                        if (el && el.offsetHeight > 0) {
                            let curr = el;
                            // Прокликиваем наверх, чтобы нажать нужную кнопку
                            for (let i = 0; i < 4; i++) {
                                if (curr) { try { curr.click(); } catch(e){} curr = curr.parentElement; }
                            }
                            return;
                        }
                    }
                }
            }, regexStr);
        }

        // ── 1. ЛОГОТИП И ОБЛОЖКА (HERO-АВАТАР ИЗ СКРИНШОТОВ) ──────────────────────────────────────────────
        log('1️⃣  Загрузка логотипа, формы и обложки...');
        try {
            // Кликаем по базовому блоку (пустышке на пустом шаблоне)
            await page.evaluate(() => {
                const firstBlock = document.querySelector('.btn-link-block, .block-elem, [data-id]');
                if (firstBlock) firstBlock.click();
            });
            await sleep(2000);

            // Если не открылось, добавляем вручную
            let fileInput = await page.$('input[type="file"]');
            if (!fileInput) {
                await clickAddBlockNative(page);
                await page.evaluate(() => {
                    let btn = Array.from(document.querySelectorAll('.block-types-item')).find(b => /аватар|avatar/i.test(b.innerText || ''));
                    if (!btn) btn = Array.from(document.querySelectorAll('*')).find(b => b.children.length === 0 && /аватар|avatar/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(2000);
            }

            // ПЕРЕХОД В ДИЗАЙН ДЛЯ ВЫБОРА КВАДРАТНОГО ЛОГОТИПА
            log('   Устанавливаем квадратный дизайн...');
            await page.evaluate(() => {
                const designTab = Array.from(document.querySelectorAll('div, span, button'))
                    .find(el => el.innerText && el.innerText.trim().toUpperCase() === 'ДИЗАЙН');
                if (designTab) designTab.click();
            });
            await sleep(1000);
            await page.evaluate(() => {
                const toggles = document.querySelectorAll('.blue-toggle.has-background');
                if (toggles.length > 1) toggles[1].click(); // Вторая опция - скругленный квадрат
            });
            await sleep(1000);

            // ВОЗВРАТ В КОНТЕНТ
            await page.evaluate(() => {
                const contentTab = Array.from(document.querySelectorAll('div, span, button'))
                    .find(el => el.innerText && el.innerText.trim().toUpperCase() === 'КОНТЕНТ');
                if (contentTab) contentTab.click();
            });
            await sleep(1000);

            // ЗАГРУЗКА ЛОГО (Аватара)
            const logoFile = sr.logo_local || (sr.images_local && sr.images_local.length > 0 ? sr.images_local[0] : null);
            if (logoFile) {
                const fullLogoPath = path.resolve(process.cwd(), logoFile);
                if (fs.existsSync(fullLogoPath)) {
                    fileInput = await page.$('input[type="file"]');
                    if (fileInput) {
                        await fileInput.uploadFile(fullLogoPath);
                        await sleep(4000); // Ждем загрузку картинки
                        log('   Логотип загружен ✅');
                    }
                }
            }

            // ВЫБОР ОБЛОЖКИ (ГАЛЕРЕЯ -> ОФИСНЫЙ ФОН)
            log('   Устанавливаем офисную обложку...');
            await page.evaluate(() => {
                // Нажатие на выбор картинки Обложки
                const els = Array.from(document.querySelectorAll('div, span'));
                const coverTarget = els.find(e => e.innerText && e.innerText.trim() === 'Обложка');
                if (coverTarget && coverTarget.parentElement) {
                    const btnBox = coverTarget.parentElement.parentElement.querySelector('.image-placeholder, [role="button"], button');
                    if (btnBox) btnBox.click();
                }
            });
            await sleep(1500);

            await page.evaluate(() => {
                // Выбор "Из галереи изображений"
                const galBtn = Array.from(document.querySelectorAll('div, span, button'))
                    .find(b => /галерея|gallery/i.test(b.innerText || ''));
                if (galBtn) galBtn.click();
            });
            await sleep(2500);

            await page.evaluate(() => {
                // Выбор 6-й офисной картинки из дефолтной библиотеки Taplink
                const pics = document.querySelectorAll('.pictures-library .column > div, .lazy.is-loaded');
                if (pics.length >= 6) { pics[5].click(); } 
                else if (pics.length > 0) { pics[0].click(); }
            });
            await sleep(2500);

            // Сохраняем главный модуль
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button'))
                    .find(b => /сохран|save|применить/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(2500);

        } catch (e) { log(`   ❌ Ошибка Лого/Обложки: ${e.message}`); }

        // ── 2. BIO (Текстовый блок) ───────────────────────────────────────
        if (sr.bio) {
            log('2️⃣  Добавление BIO (Текстовый блок)...');
            try {
                await clickAddBlockNative(page);
                await page.evaluate(() => {
                    let btn = Array.from(document.querySelectorAll('.block-types-item')).find(b => /текст|text/i.test(b.innerText || ''));
                    if (!btn) btn = Array.from(document.querySelectorAll('*')).find(b => b.children.length === 0 && /текст|text/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(1500);
                const ta = await page.$('textarea, [contenteditable="true"]');
                if (ta) {
                    await ta.click();
                    await ta.type(sr.bio, { delay: 5 });
                }
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => /сохран|save/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(2000);
            } catch (e) { log(`   ❌ Ошибка BIO: ${e.message}`); }
        }

        // ── 3. ССЫЛКИ ──────────────────────────────
        const links = [
            { title: 'Шоурум на Auto.ae',     url: sr.profile_url },
            { title: 'Каталог автомобилей',   url: sr.cars_url    },
            { title: 'Аренда авто',            url: sr.rent_url    },
            { title: 'Автомобильные номера',   url: sr.numbers_url },
            { title: 'Проданные авто',         url: sr.sold_url    },
        ].filter(l => l.url);

        log('3️⃣  Добавление ссылок в строгом порядке...');
        for (const link of links) {
            try {
                await clickAddBlockNative(page);
                await page.evaluate(() => {
                    let btn = Array.from(document.querySelectorAll('.block-types-item')).find(b => /ссылка|link|кнопка/i.test(b.innerText || ''));
                    if (!btn) btn = Array.from(document.querySelectorAll('*')).find(b => b.children.length === 0 && /ссылка|link|кнопка/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(1500);

                const inputs = await page.$$('input[type="text"], input[type="url"]');
                if (inputs.length >= 2) {
                    await inputs[0].type(link.title, { delay: 10 });
                    await inputs[1].type(link.url || sr.profile_url, { delay: 10 });
                }
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => /сохран|save|добавить/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(1500);
                log(`   Ссылка добавлена: ${link.title} ✅`);
            } catch (e) {}
        }

        // ── 4. WHATSAPP (ЕСЛИ ЕСТЬ) ──────────────────────────────
        if (sr.whatsapp) {
            log('4️⃣  Добавление WhatsApp...');
            try {
                await clickAddBlockNative(page);
                await page.evaluate(() => {
                    let btn = Array.from(document.querySelectorAll('.block-types-item')).find(b => /whatsapp|мессенджер/i.test(b.innerText || ''));
                    if (!btn) btn = Array.from(document.querySelectorAll('*')).find(b => b.children.length === 0 && /whatsapp|мессенджер/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(1500);

                const inputs = await page.$$('input');
                // Вводим телефон в первое найденное поле
                if (inputs.length > 0) {
                    await inputs[0].type(sr.whatsapp, { delay: 10 });
                }
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button')).find(b => /сохран|save|добавить/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(2000);
                log('   WhatsApp добавлен ✅');
            } catch (e) {}
        }

        // ── 5. ГАЛЕРЕЯ (КАРУСЕЛЬ) ──────────────────────────────────
        if (sr.images_local && sr.images_local.length > 0) {
            log('5️⃣  Добавление галереи...');
            try {
                await clickAddBlockNative(page);
                const galleryBtnClicked = await page.evaluate(() => {
                    let btn = Array.from(document.querySelectorAll('.block-types-item')).find(b => /галерея|gallery|карусель|carousel/i.test(b.innerText || ''));
                    if (!btn) btn = Array.from(document.querySelectorAll('*')).find(b => b.children.length === 0 && /галерея|gallery|карусель|carousel/i.test(b.innerText || ''));
                    if (btn) { btn.click(); return true; }
                    return false;
                });

                if (galleryBtnClicked) {
                    await sleep(1500);
                    const galleryPics = sr.images_local.slice(0, 3);
                    for (let i = 0; i < galleryPics.length; i++) {
                        const fullPath = path.resolve(process.cwd(), galleryPics[i]);
                        if (fs.existsSync(fullPath)) {
                            const inp = await page.$('input[type="file"]');
                            if (inp) {
                                await inp.uploadFile(fullPath);
                                await sleep(2000);
                                log(`   Фото ${i+1} загружено ✅`);
                            }
                        }
                    }
                    await page.evaluate(() => {
                        const btn = Array.from(document.querySelectorAll('button')).find(b => /сохран|save/i.test(b.innerText || ''));
                        if (btn) btn.click();
                    });
                    await sleep(2000);
                }
            } catch (e) {}
        }

        log(`[${sr.name}] ✅ Настройка завершена.`);
        return true;
    } catch (e) {
        log(`[КРИТИЧЕСКАЯ ОШИБКА НАСТРОЙКИ] ${e.message}`);
        return false;
    }
}

// ─── ГЛАВНАЯ ФУНКЦИЯ ──────────────────────────────────────────────────────────
async function runTest() {
    log('=== ТЕСТ: 1 ШОУРУМ ===');

    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Берём первый незавершённый шоурум
    const sr = showrooms.find(s => !s.taplink_created && !s.taplink_designed && s.logo_local);
    if (!sr) {
        log('Все шоурумы уже обработаны!');
        return;
    }

    log(`Тестируем: ${sr.name}`);
    log(`  safe_name: ${sr.safe_name}`);
    log(`  bio: ${sr.bio ? sr.bio.substring(0, 60) + '...' : 'НЕТ'}`);
    log(`  logo_local: ${sr.logo_local || 'НЕТ'}`);
    log(`  фото: ${(sr.images_local || []).length} шт.`);

    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,800'],
        defaultViewport: null,
    });

    const mailPage = await browser.newPage();
    const tPage    = await browser.newPage();

    try {
        const email = await getVisualEmail(mailPage);
        if (!email) throw new Error('Не удалось получить email');

        await tPage.bringToFront();
        await registerTaplink(tPage, mailPage, email, PASS);

        sr.taplink_created = true;
        sr.taplink_email   = email;
        sr.taplink_pass    = PASS;
        sr.taplink_url     = `https://taplink.cc/${sr.safe_name}`;

        const designed = await setupShowroom(tPage, sr);
        if (designed) {
            sr.taplink_designed = true;
        }

        // Сохраняем результат
        fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));

        log('');
        log('=== РЕЗУЛЬТАТ ===');
        log(`Шоурум: ${sr.name}`);
        log(`Email: ${sr.taplink_email}`);
        log(`Taplink URL: ${sr.taplink_url}`);
        log(`Оформлен: ${sr.taplink_designed ? 'ДА ✅' : 'НЕТ ❌'}`);

    } catch (e) {
        log(`[КРИТИЧЕСКАЯ ОШИБКА] ${e.message}`);
    }

    log('');
    log('Браузер оставлен открытым для проверки.');
    log('ПРОЦЕСС БУДЕТ ЖДАТЬ ВЕЧНО. Нажмите Ctrl+C для выхода.');
    
    // НЕ закрываем браузер и держим процесс живым
    await new Promise(() => {}); 
}

runTest();
