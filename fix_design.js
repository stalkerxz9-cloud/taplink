import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const dataPath  = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath   = path.join(process.cwd(), 'data', 'fix_design_log.txt');
const PASS      = 'SecureShowroom#2024';
const HEADLESS  = false; // Видим что происходит
const BATCH     = 5;     // Сколько аккаунтов за раз

// Лимит: 0 = все, иначе только первые N
const LIMIT = 0;

// Начать с конкретного индекса (если прерывалось)
const START_FROM = 0;

function log(msg) {
    const line = `[${new Date().toLocaleTimeString('ru-RU')}] ${msg}`;
    console.log(line);
    fs.appendFileSync(logPath, line + '\n', 'utf-8');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Логин ──────────────────────────────────────────────────────────────────────
async function login(page, email, pass) {
    log(`  Логин: ${email}`);
    await page.goto('https://taplink.ru/profile/auth/login/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(2000);

    // Вводим email
    const emailInp = await page.$('input[type="email"], input[name="email"], input[autocomplete="email"]');
    if (!emailInp) { log('  [ERR] Поле email не найдено'); return false; }
    await emailInp.click({ clickCount: 3 });
    await emailInp.type(email, { delay: 30 });

    // Кнопка Продолжить/Далее
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => /продолжить|далее|next|continue/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(4000);

    // Вводим пароль
    const passInp = await page.$('input[type="password"]');
    if (passInp) {
        await passInp.click({ clickCount: 3 });
        await passInp.type(pass, { delay: 30 });
        await page.keyboard.press('Enter');
        await sleep(5000);
    }

    const url = page.url();
    const ok = !url.includes('login') && !url.includes('auth');
    log(`  ${ok ? '✅ Вошли' : '❌ Логин не удался'} (${url})`);
    return ok;
}

// ── Получить все блоки на странице ─────────────────────────────────────────────
async function getBlocks(page) {
    return await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll(
            '[data-id], .app-pages-site-block-item, .taplink-block, .page-block, [class*="block-item"]'
        )).filter(el => el.offsetHeight > 0);

        return blocks.map(el => {
            const text = (el.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
            const dataId = el.getAttribute('data-id') || el.getAttribute('id') || '';
            return { text, dataId };
        });
    });
}

// ── Удалить дубли кнопок ────────────────────────────────────────────────────────
async function removeDuplicateBlocks(page) {
    log('  Ищем дубли блоков...');

    const result = await page.evaluate(() => {
        // Ключевые тексты кнопок которые не должны дублироваться
        const TARGET_KEYWORDS = [
            'cars for sale', 'car for sale',
            'rent a car',
            'number plates',
            'sold cars',
            'official showroom',
            'contact via whatsapp', 'whatsapp',
        ];

        const blocks = Array.from(document.querySelectorAll(
            '.app-pages-site-block-item, [data-id], [class*="block-wrap"]'
        )).filter(el => el.offsetHeight > 0 && el.offsetWidth > 0);

        const seen = {};
        const toDelete = [];

        for (const block of blocks) {
            const txt = (block.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
            
            for (const kw of TARGET_KEYWORDS) {
                if (txt.includes(kw)) {
                    if (seen[kw]) {
                        // Дубль — удаляем
                        toDelete.push(block);
                    } else {
                        seen[kw] = true;
                    }
                    break;
                }
            }
        }

        // Удаляем дубли через кнопку удаления внутри блока
        let deleted = 0;
        for (const block of toDelete) {
            // Наводим мышь — появляются контрольные кнопки
            block.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
            block.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
            
            // Ищем кнопку удаления
            const delBtn = block.querySelector(
                'button[class*="delete"], button[class*="remove"], [class*="delete-block"], [aria-label*="удалить"], [aria-label*="delete"], [title*="удалить"], [title*="delete"]'
            );
            if (delBtn) {
                delBtn.click();
                deleted++;
            } else {
                // Ставим маркер для ручного поиска
                block.setAttribute('data-fix-delete', 'true');
            }
        }

        return { total: toDelete.length, deleted, markedForDelete: toDelete.length - deleted };
    });

    log(`  Найдено дублей: ${result.total}, удалено сразу: ${result.deleted}, требуют ручного клика: ${result.markedForDelete}`);

    // Если есть помеченные — удаляем через hover + клик кнопки
    if (result.markedForDelete > 0) {
        await sleep(2000);
        const markedBlocks = await page.$$('[data-fix-delete="true"]');
        log(`  Удаляем ${markedBlocks.length} через hover...`);
        
        for (const block of markedBlocks) {
            try {
                const box = await block.boundingBox();
                if (!box) continue;
                
                // Hover чтобы появились кнопки управления
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await sleep(1000);
                
                // Ищем кнопку удаления
                const deleted = await page.evaluate((el) => {
                    const btns = Array.from(el.querySelectorAll('button, [class*="control"], [class*="action"]'));
                    // Ищем иконку корзины или текст "удалить"
                    const del = btns.find(b => {
                        const label = (b.getAttribute('aria-label') || b.title || b.innerText || '').toLowerCase();
                        return label.includes('удалить') || label.includes('delete') || label.includes('remove');
                    }) || btns.find(b => b.querySelector('svg path[d*="M"], svg[class*="trash"], svg[class*="delete"]'));
                    if (del) { del.click(); return true; }
                    return false;
                }, block);

                if (deleted) {
                    log('    ✅ Блок удалён через hover');
                    await sleep(1500);
                    // Подтверждение если есть диалог
                    await page.evaluate(() => {
                        const ok = Array.from(document.querySelectorAll('button, .button'))
                            .find(b => /удалить|да|delete|yes|confirm/i.test(b.innerText || ''));
                        if (ok) ok.click();
                    });
                    await sleep(1000);
                } else {
                    log('    [!] Кнопка удаления не найдена в блоке');
                }
            } catch(e) {
                log(`    [ERR] ${e.message}`);
            }
        }
    }

    await sleep(2000);
    return result.total;
}

// ── Проверить есть ли аватар/баннер ────────────────────────────────────────────
async function hasAvatarBlock(page) {
    return await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll(
            '[data-block-type="avatar"], .is-avatar-block, .tap-avatar, [class*="avatar-block"]'
        ));
        // Также проверяем наличие img с аватаром
        const avatarImg = document.querySelector('.profile-avatar img, .taplink-avatar img, [class*="avatar"] img');
        return blocks.length > 0 || !!avatarImg;
    });
}

// ── Добавить аватар с логотипом ──────────────────────────────────────────────
async function addAvatar(page, sr) {
    const logoPath = path.resolve(process.cwd(), 'data', sr.safe_name, 'logo.jpg');
    if (!fs.existsSync(logoPath)) {
        log(`  [!] Логотип не найден: ${logoPath}`);
        return false;
    }

    log('  Добавляем аватар...');

    // Нажимаем + Добавить блок
    const addBtn = await page.$('button.is-new-block');
    if (!addBtn) { log('  [!] Кнопка добавить блок не найдена'); return false; }
    await addBtn.click();
    await sleep(3000);

    // Выбираем "Аватар"
    await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('button, .item, [class*="block-button"]'));
        const av = items.find(el => {
            const t = (el.innerText || '').trim().toLowerCase();
            return t === 'аватар' || t === 'avatar';
        });
        if (av) av.click();
    });
    await sleep(5000);

    // Загружаем файл логотипа
    const fileInput = await page.$('input[type="file"]');
    if (fileInput) {
        await fileInput.uploadFile(logoPath);
        log('  ✅ Логотип загружен');
        await sleep(5000);
    }

    // Закрываем кроппер если появился
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button'))
            .find(b => /загрузить|upload|применить|сохранить/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(3000);

    // Сохраняем блок аватара
    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('.modal-card-foot button, .modal button'))
            .find(b => /сохранить|save|готово/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(3000);
    return true;
}

// ── Проверить что ссылка жива ──────────────────────────────────────────────────
async function checkUrl(url) {
    try {
        const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
        return r.status;
    } catch(e) {
        return 0;
    }
}

// ── Опубликовать профиль ────────────────────────────────────────────────────────
async function publishProfile(page, sr) {
    log('  Публикуем профиль...');

    await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('a, button, span'))
            .find(el => /получить|get link|publish|опубликовать/i.test(el.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(5000);

    // taplink.cc/
    await page.evaluate(() => {
        const rad = Array.from(document.querySelectorAll('input[type="radio"], label'))
            .find(el => el.innerText?.includes('taplink.cc') || el.value?.includes('taplink.cc'));
        if (rad) rad.click();
    });
    await sleep(2000);

    const suffixes = ['', 'ae', '-auto', '-cars', '1', '2'];
    for (const suffix of suffixes) {
        const name = sr.safe_name + (suffix ? suffix : '');
        log(`  Пробуем домен: ${name}`);

        await page.evaluate((val) => {
            const inp = document.querySelector('.modal-card-body input[type="text"]');
            if (inp) {
                inp.focus();
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (setter) setter.call(inp, val);
                inp.value = val;
                inp.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, name);
        await sleep(2500);

        const isFree = await page.evaluate(() => {
            const err = document.querySelector('.help.is-danger, .error-msg, [class*="is-danger"]');
            if (err && err.offsetHeight > 0) return false;
            const ok = document.querySelector('.help.is-success, .success-msg, [class*="is-success"]');
            return !!ok;
        });

        if (isFree) {
            log(`  ✅ Домен свободен: ${name}`);
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('.modal-card-foot button, .modal button'))
                    .find(b => /сохранить|опубликовать|применить|publish|save/i.test(b.innerText || ''));
                if (btn) btn.click();
            });
            await sleep(5000);
            return `https://taplink.cc/${name}`;
        }
    }
    return null;
}

// ── Главная функция обработки одного аккаунта ──────────────────────────────────
async function processShowroom(browser, sr, index) {
    log(`\n[${index}] ${sr.name} | ${sr.taplink_url}`);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    try {
        // 1. Проверяем живость ссылки
        const status = await checkUrl(sr.taplink_url);
        log(`  URL статус: ${status}`);

        // 2. Логинимся
        const loggedIn = await login(page, sr.taplink_email, sr.taplink_pass || PASS);
        if (!loggedIn) {
            log('  ❌ Не удалось залогиниться, пропускаем');
            await page.close();
            return { status: 'login_failed' };
        }

        // 3. Переходим в редактор
        await page.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2', timeout: 60000 });
        await sleep(4000);

        // 4. Удаляем дубли
        const dupCount = await removeDuplicateBlocks(page);
        log(`  Удалено дублей: ${dupCount}`);

        // 5. Проверяем аватар
        const hasAvatar = await hasAvatarBlock(page);
        if (!hasAvatar) {
            log('  Аватар отсутствует, добавляем...');
            await addAvatar(page, sr);
        } else {
            log('  ✅ Аватар есть');
        }

        // 6. Если ссылка была 404 — переопубликовываем
        if (status === 404 || status === 0) {
            log('  Ссылка мертва, переопубликовываем...');
            const newUrl = await publishProfile(page, sr);
            if (newUrl) {
                log(`  ✅ Новый URL: ${newUrl}`);
                sr.taplink_url = newUrl;
                sr.fix_status = 'republished';
            } else {
                log('  ❌ Не удалось опубликовать');
                sr.fix_status = 'publish_failed';
            }
        } else {
            sr.fix_status = 'fixed';
        }

        await page.close();
        return { status: 'ok', dupCount };

    } catch(e) {
        log(`  [CRASH] ${e.message}`);
        await page.close().catch(() => {});
        return { status: 'error', err: e.message };
    }
}

// ── MAIN ───────────────────────────────────────────────────────────────────────
async function main() {
    log('\n========= FIX DESIGN START =========');
    log(`Время: ${new Date().toLocaleString('ru-RU')}`);

    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    
    // Только те у кого есть email и URL
    let targets = showrooms
        .filter(s => s.taplink_email && s.taplink_url)
        .slice(START_FROM, LIMIT > 0 ? START_FROM + LIMIT : undefined);

    log(`Всего для обработки: ${targets.length}`);

    // Статистика
    let fixed = 0, failed = 0, skipped = 0;

    for (let i = 0; i < targets.length; i += BATCH) {
        const batch = targets.slice(i, i + BATCH);
        log(`\n--- Батч ${Math.floor(i/BATCH)+1}: шоурумы ${i+1}-${i+batch.length} ---`);

        const browser = await puppeteer.launch({
            headless: HEADLESS,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
        });

        for (let j = 0; j < batch.length; j++) {
            const sr = batch[j];
            const globalIdx = START_FROM + i + j + 1;

            try {
                const result = await processShowroom(browser, sr, globalIdx);
                if (result.status === 'ok') fixed++;
                else if (result.status === 'login_failed') skipped++;
                else failed++;
            } catch(e) {
                log(`[ERR] ${sr.name}: ${e.message}`);
                failed++;
            }

            // Сохраняем прогресс после каждого шоурума
            fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
            
            // Пауза между аккаунтами
            if (j < batch.length - 1) await sleep(3000);
        }

        await browser.close();
        log(`\n📊 Прогресс: ${fixed} исправлено, ${failed} ошибок, ${skipped} пропущено из ${targets.length}`);

        // Пауза между батчами
        if (i + BATCH < targets.length) {
            log('Пауза 10 сек между батчами...');
            await sleep(10000);
        }
    }

    log(`\n========= ИТОГ =========`);
    log(`✅ Исправлено: ${fixed}`);
    log(`❌ Ошибок: ${failed}`);
    log(`⏭ Пропущено: ${skipped}`);
    log(`========================\n`);
}

main().catch(e => {
    log(`[FATAL] ${e.message}`);
    process.exit(1);
});
