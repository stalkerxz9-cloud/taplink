import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath  = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath   = path.join(process.cwd(), 'data', 'bot_log.txt');
const PASS      = 'SecureShowroom#2024';
const testLimit = 2; // 0 = без ограничений (полный марафон)

function log(msg) {
    const time = new Date().toLocaleTimeString();
    const line = `[${time}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logPath, line + '\n', 'utf-8');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function saveProgress(showrooms) {
    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
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
        const modalVisible = await page.evaluate(() => {
            const modal = document.querySelector('.modal-card, .modal.is-active');
            return modal && modal.offsetHeight > 0;
        });
        if (!modalVisible) { log('   [OK] Сохранено.'); return true; }
    }
    await page.keyboard.press('Escape');
    await sleep(1000);
    return false;
}

// Добавить разделитель
async function addSeparator(page) {
    log('   + Разделитель...');
    const opened = await page.evaluate(() => {
        const btn = document.querySelector('button.is-new-block');
        if (btn) { btn.click(); return true; }
        return false;
    });
    if (!opened) { log('   [!] Кнопка "Добавить блок" не найдена'); return; }
    await sleep(2000);
    await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button.is-block-button, button'));
        const sep = btns.find(el =>
            el.innerText?.includes('Разделитель') || el.innerText?.includes('Divider')
        );
        if (sep) sep.click();
    });
    await sleep(2000);
    await ensureSaved(page);
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
        log('   [!] Кнопка "Добавить блок" не найдена, клик по координатам...');
        await page.mouse.click(640, 750);
    }
    await sleep(2500);
}

// Клик по тексту через TreeWalker — золотая техника
async function hardwareClick(page, text) {
    const pos = await page.evaluate((txt) => {
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
    }, text);

    if (pos) {
        await page.mouse.click(pos.x, pos.y);
        log(`   [OK] hardwareClick: "${text}"`);
    } else {
        log(`   [!] hardwareClick: текст "${text}" не найден`);
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
        await hardwareClick(page, 'Да');
        // Fallback: DOM-поиск кнопки подтверждения
        await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, .button, a'))
                .find(b => {
                    const t = (b.innerText || '').trim();
                    return t === 'Да' || t === 'Yes' || t === 'OK' ||
                        t === 'Применить' || t === 'Выбрать шаблон' ||
                        t === 'Начать' || t === 'Продолжить';
                });
            if (btn) btn.click();
        }).catch(() => {});
        await sleep(8000);

        // Закрываем обучающее меню если есть
        await page.mouse.click(10, 10);
        await sleep(1000);

        // Убираем дефолтный аватар-заглушку из DOM (сдвигает координаты!)
        await page.evaluate(() => {
            const defBlock = document.querySelector('.btn-link-block');
            if (defBlock) defBlock.remove();
        }).catch(() => {});
        await sleep(1000);

        // Возвращаемся в редактор
        await page.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(4000);
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

        // Удаляем авто-созданный пустой блок аватара (он сдвигает координаты)
        await page.evaluate(() => {
            const blocks = Array.from(document.querySelectorAll(
                '.block-avatar, .block-type-avatar, [data-block-type="avatar"], .is-avatar-block, ' +
                '[class*="block"][class*="avatar"], .page-block:first-child'
            ));
            blocks.forEach(b => {
                // Удаляем только если в блоке нет реального изображения (пустышка)
                const img = b.querySelector('img[src*="avatar"], img:not([src*="default"])');
                if (!img) b.remove();
            });
        }).catch(() => {});
        await sleep(1000);

        // ── GOLDEN-подход: добавляем новый блок Аватар через меню ─────────────
        log('   Добавляем блок Аватар (Golden-метод)...');
        const addBtnEl = await page.waitForSelector('button.is-new-block', { timeout: 15000 }).catch(() => null);
        if (!addBtnEl) {
            log('   [!] Кнопка добавления блока не найдена');
        } else {
            await addBtnEl.click();
            await sleep(2500);
            await page.evaluate(() =>
                Array.from(document.querySelectorAll('button.is-block-button, button'))
                    .find(el => el.innerText?.includes('Аватар') || el.innerText?.includes('Avatar'))?.click()
            );
            await sleep(4500); // Ждём открытия диалога "Аватар"

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
            // Кнопка "↑ Загрузить" в строке Аватар (НЕ в строке Обложка)
            // Из скриншота: button "Загрузить" ≈ viewport (596, 408)
            await page.evaluate(() => {
                // Ищем кнопку "Загрузить" в строке Аватар (не Обложка)
                const allLabels = Array.from(document.querySelectorAll('.modal-card-body *'))
                    .filter(el => el.children.length === 0 && el.innerText?.trim() === 'Аватар');
                for (const lbl of allLabels) {
                    const row = lbl.closest('tr, .field, .label-row, div[class]') || lbl.parentElement?.parentElement;
                    if (row) {
                        const up = row.querySelector('button, a');
                        if (up && /загрузить|upload/i.test(up.innerText || '')) { up.click(); return; }
                    }
                }
                // Fallback: первая кнопка "Загрузить" в модалке
                const btns = Array.from(document.querySelectorAll('.modal-card-body button, .modal-card-body a'));
                const uploadBtn = btns.find(b => /загрузить|upload/i.test(b.innerText || ''));
                if (uploadBtn) uploadBtn.click();
            });
            await sleep(1500);

            const [fcLogo] = await Promise.all([
                page.waitForFileChooser({ timeout: 7000 }),
                page.evaluate(() => document.querySelector('input[type="file"]')?.click())
            ]).catch(() => [null]);

            if (fcLogo) {
                await fcLogo.accept([logoPath]);
                log('   [OK] Логотип загружен');
                await sleep(8000); // Даём время на обработку
            } else {
                log('   [!] fileChooser не сработал — пробуем прямую загрузку');
                const inp = await page.$('input[type="file"]');
                if (inp) { await inp.uploadFile(logoPath); await sleep(8000); }
            }

            // ── 1.3 Обложка — Бурж Халифа из галереи ─────────────────────────
            log('   1.3 Обложка — Бурж Халифа...');
            // Прокручиваем диалог вниз чтобы увидеть поле "Обложка"
            await page.evaluate(() => {
                const modal = document.querySelector('.modal-card-body');
                if (modal) modal.scrollTop = 300;
            });
            await sleep(1500);

            // Кликаем иконку галереи в строке "Обложка"
            const coverGallOpened = await page.evaluate(() => {
                const allEls = Array.from(document.querySelectorAll('.modal-card-body *'));
                for (const el of allEls) {
                    if (el.children.length === 0 && el.innerText?.trim() === 'Обложка') {
                        const row = el.closest('tr, .field, .label-row, div[class]') || el.parentElement?.parentElement;
                        if (!row) continue;
                        // Первая кнопка с иконкой (SVG/I/IMG) в строке Обложка
                        const iconBtns = Array.from(row.querySelectorAll('button, a, span'))
                            .filter(b => b.offsetWidth > 0 && b.querySelector('svg, i, img, [class*="icon"]'));
                        if (iconBtns[0]) { iconBtns[0].click(); return true; }
                        // Кнопка по title-атрибуту
                        const byTitle = row.querySelector('[title*="галер"], [title*="gallery"]');
                        if (byTitle) { byTitle.click(); return true; }
                    }
                }
                return false;
            });

            if (!coverGallOpened) {
                log('   DOM: нет — координаты галереи Обложки (634, 480)');
                await page.mouse.click(634, 480);
            }
            await sleep(4000); // Ждём открытия галереи

            // Определяем открылась ли галерея
            const galleryOpen = await page.evaluate(() =>
                document.body.innerText.includes('Галерея') ||
                !!document.querySelector('[class*="gallery"], [class*="picture-gallery"]')
            );

            if (galleryOpen) {
                log('   Галерея открыта — прокрутка к началу → клик Бурж Халифа');
                await page.evaluate(() => {
                    const modal = document.querySelector('.modal-card-body');
                    if (modal) modal.scrollTop = 0;
                });
                await sleep(800);

                // DOM-клик на первый элемент галереи
                const firstPicClicked = await page.evaluate(() => {
                    const sels = [
                        '.picture-gallery-item', '.gallery-item', '.pictures-gallery-item',
                        '[class*="gallery-item"]', '[class*="picture-item"]',
                        '[class*="thumb"]', '.media-item', '.stock-item'
                    ];
                    for (const sel of sels) {
                        const items = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetWidth > 0);
                        if (items.length) { items[0].click(); return sel; }
                    }
                    // Ищем картинки в модалке
                    const imgs = Array.from(document.querySelectorAll('.modal-card-body img'))
                        .filter(img => img.offsetWidth > 50);
                    if (imgs.length) {
                        (imgs[0].closest('button, a, li, div[class]') || imgs[0]).click();
                        return 'img';
                    }
                    return null;
                });

                if (firstPicClicked) {
                    log(`   [OK] Бурж Халифа выбрана (DOM: ${firstPicClicked})`);
                } else {
                    log('   Координаты: (341, 150) — первое фото галереи');
                    await page.mouse.click(341, 150);
                }
            } else {
                log('   [!] Галерея не открылась — Golden fallback (341, 385)');
                await page.mouse.click(341, 385);
            }
            await sleep(4000);
        }
        await ensureSaved(page);

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
        await sleep(2500);
        await page.evaluate(() =>
            Array.from(document.querySelectorAll('button.is-block-button, button'))
                .find(el => el.innerText?.includes('Текст') || el.innerText?.includes('Text'))?.click()
        );
        await sleep(5000);

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
        await sleep(2500);

        await page.evaluate(() =>
            Array.from(document.querySelectorAll('button.is-block-button, button'))
                .find(el => el.innerText?.includes('Ссылка') || el.innerText?.includes('Link'))?.click()
        );
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

        // Открываем панель анимации — кликаем кнопку "Нет" рядом с меткой "Анимация"
        await page.evaluate(() => {
            // Точный поиск: кнопка рядом с текстом "Анимация"
            const all = Array.from(document.querySelectorAll('.modal-card-body *'));
            for (const el of all) {
                if (el.children.length === 0 && el.innerText?.trim() === 'Анимация') {
                    const row = el.closest('tr, .field, .label-row, div[class]') || el.parentElement?.parentElement;
                    if (row) {
                        // Кнопка-дропдаун (показывает текущее значение "Нет" / "Блик" и т.д.)
                        const btn = row.querySelector('button, [class*="dropdown"], [class*="select"], [role="button"]');
                        if (btn) { btn.click(); return; }
                    }
                }
            }
            // Fallback: кнопка с текстом "Нет" (текущее значение анимации = Нет)
            const noneBtn = Array.from(document.querySelectorAll('button'))
                .find(b => b.innerText?.trim() === 'Нет' && b.closest('.modal-card-body'));
            if (noneBtn) noneBtn.click();
        });
        await sleep(2000);

        // Выбираем "Блик" из открытой панели анимации
        // ВАЖНО: в русском UI это = "Блик" (не "Blink"!)
        const blinkClicked = await page.evaluate(() => {
            // Ищем именно КНОПКУ с текстом "Блик" (точное совпадение)
            const buttons = Array.from(document.querySelectorAll('button, .button'));
            const blink = buttons.find(b =>
                b.innerText?.trim() === 'Блик' || b.innerText?.trim() === 'Blink'
            );
            if (blink) { blink.click(); return true; }

            // Fallback: любой элемент с точным текстом
            const anyEl = Array.from(document.querySelectorAll('*'))
                .filter(el =>
                    el.children.length === 0 &&
                    (el.innerText?.trim() === 'Блик' || el.innerText?.trim() === 'Blink') &&
                    el.offsetWidth > 0
                );
            if (anyEl.length > 0) { anyEl[0].click(); return true; }
            return false;
        });

        if (!blinkClicked) {
            log('   [!] Блик не найден в DOM — координаты');
            // Из скриншота 4 при Window Bounds 0,80; 1536,744:
            // "Блик" в content coords ≈ (648, 271)
            // При 1280px viewport: "Блик" ≈ x=522, y=271 (правый столбец, первая строка)
            await page.mouse.click(522, 271);
        }
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
        await sleep(2500);
        await page.evaluate(() =>
            Array.from(document.querySelectorAll('button.is-block-button, button'))
                .find(el =>
                    el.innerText?.includes('Мессенджеры') ||
                    el.innerText?.includes('Messengers') ||
                    el.innerText?.includes('Messaging')
                )?.click()
        );
        await sleep(5000);

        // Добавить новый пункт
        await page.evaluate(() =>
            Array.from(document.querySelectorAll('button, a'))
                .find(el =>
                    el.innerText?.includes('Добавить новый пункт') ||
                    el.innerText?.includes('Add new item') ||
                    el.innerText?.includes('Add item')
                )?.click()
        );
        await sleep(3500);

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
    // ШАГ 8: ПУБЛИКАЦИЯ (привязка имени профиля)
    // ─────────────────────────────────────────────────────────────────────────
    log('8. Публикация...');
    await sleep(3000);
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span'))
            .find(el =>
                el.innerText?.includes('Получить ссылку') ||
                el.innerText?.includes('Get link') ||
                el.innerText?.includes('Publish') ||
                el.innerText?.includes('Опубликовать')
            );
        if (btn) btn.click();
    });
    await sleep(4500);

    // Выбираем первый radio (taplink.cc/...)
    await page.evaluate(() => {
        const options = document.querySelectorAll('.modal-card-body .radio, .modal-card-body label, input[type="radio"]');
        if (options[0]) options[0].click();
    });
    await sleep(2000);

    // Вводим safe_name — ищем input в модалке по placeholder или по типу
    log(`   Ввод имени домена: ${sr.safe_name}`);
    const domainInput = await page.$(
        '.modal-card-body input[type="text"], .modal-card-body input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])'
    );
    if (domainInput) {
        await domainInput.click({ clickCount: 3 });
        await sleep(500);
        await domainInput.type(sr.safe_name, { delay: 80 });
        log(`   [OK] Домен введён в поле ввода`);
    } else {
        // Fallback: координатный клик как в golden
        await page.mouse.click(462, 550);
        await sleep(1000);
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await page.keyboard.type(sr.safe_name, { delay: 80 });
        log(`   [!] Домен введён через координаты`);
    }
    await sleep(2500);

    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(el =>
                el.innerText?.includes('Подключить') ||
                el.innerText?.includes('Connect') ||
                el.innerText?.includes('Publish') ||
                el.innerText?.includes('Save')
            );
        if (btn) btn.click();
    });
    await sleep(7000);

    log(`✅ ГОТОВО: https://taplink.cc/${sr.safe_name}`);
    return true;
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
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--window-size=1280,900',
                '--disable-blink-features=AutomationControlled'
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
            const designed = await designShowroom(tPage, sr);
            if (designed) {
                sr.taplink_designed  = true;
                sr.taplink_published = true;
                await saveProgress(showrooms);
                processed++;
                log(`✅ [${processed}] ${sr.name} — ГОТОВ`);
            }

        } catch (e) {
            log(`❌ КРИТИЧЕСКАЯ ОШИБКА [${sr.name}]: ${e.message}`);
            log(e.stack || '');
        } finally {
            await sleep(3000);
            await browser.close().catch(() => {});
            await sleep(2000);
        }
    }

    log(`\n${'='.repeat(60)}`);
    log(`🏁 МАРАФОН ЗАВЕРШЕН. Обработано: ${processed} шоурумов.`);
    log('='.repeat(60));
}

run();
