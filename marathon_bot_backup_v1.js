import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUAPlugin from 'puppeteer-extra-plugin-anonymize-ua';
import fs from 'fs';
import path from 'path';
import readline from 'readline';

// ─── Конфиг ───────────────────────────────────────────────────────────────────
const dataPath    = path.join(process.cwd(), 'data', 'showrooms_data.json');
const logPath     = path.join(process.cwd(), 'data', 'bot_log.txt');
const PASS        = 'SecureShowroom#2024';
const testLimit   = 2; 

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUAPlugin());

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

// ─── Почта ────────────────────────────────────────────────────────────────────
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

// ─── Окружение ────────────────────────────────────────────────────────────────
async function ensureSaved(page) {
    await sleep(2500);
    const clicked = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div, span, a'))
            .find(el => {
                const t = el.innerText?.trim().toLowerCase();
                return t === 'сохранить' || t === 'save' || t === 'применить' || t === 'apply';
            });
        if (btn) { btn.click(); return true; }
        return false;
    });
    if (clicked) log('   [OK] Изменения сохранены.');
    await sleep(4000);
}

// Функция для надежного открытия меню "Добавить блок"
async function openNewBlockMenu(page) {
    await page.keyboard.press('Escape').catch(()=>{}); // Закрыть любые окна
    await sleep(1000);
    const clicked = await page.evaluate(() => {
        // Сначала ищем по классу (10.04), потом по тексту
        let btn = document.querySelector('button.is-new-block');
        if (!btn) {
            btn = Array.from(document.querySelectorAll('button, span, div'))
                .find(el => el.innerText?.trim().toLowerCase() === 'добавить блок' || el.innerText?.trim().toLowerCase() === 'add block');
        }
        if (btn) { btn.click(); return true; }
        return false;
    });
    if (!clicked) {
        log('   [!] Не удалось найти кнопку "Добавить блок" по тексту. Пробуем по координатам (центр снизу)...');
        await page.mouse.click(640, 750); // Примерные координаты кнопки на пустом шаблоне
    }
    await sleep(2500);
}

// Функция для выбора типа блока в открытом меню
async function selectBlockType(page, typeName) {
    const clicked = await page.evaluate((name) => {
        const regex = new RegExp(name, 'i');
        const btns = Array.from(document.querySelectorAll('button.is-block-button, .block-item, .block-types-item, button'));
        const target = btns.find(b => regex.test(b.innerText || ''));
        if (target) { target.click(); return true; }
        return false;
    }, typeName);
    if (!clicked) log(`   [!] Не удалось выбрать тип блока: ${typeName}`);
    await sleep(3500);
}

// ─── Регистрация ──────────────────────────────────────────────────────────────
async function registerTaplink(tPage, mailPage, email, password) {
    log(`Регистрация: ${email}`);
    await tPage.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await tPage.waitForSelector('input[type="email"]', { timeout: 30000 });
    await tPage.type('input[type="email"]', email, { delay: 50 });
    
    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, input[type="submit"]')).find(b => /продолжить|далее|next/i.test(b.innerText || b.value || ''));
        if (btn) btn.click();
    });
    await sleep(5000);

    await tPage.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button, div[role="button"], a')).find(b => /почта существует|да, все верно|yes|continue/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(5000);

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
            await sleep(2000);
            await tPage.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(b => /продолжить|далее/i.test(b.innerText || ''));
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
        const btn = Array.from(document.querySelectorAll('button')).find(b => /регистр|далее|войти|продолжить/i.test(b.innerText || ''));
        if (btn) btn.click();
    });
    await sleep(10000);
    return true;
}

// ─── Дизайн (Версия 10.04 Улучшенная) ────────────────────────────────────────
async function designShowroom(tPage, sr) {
    log(`[${sr.name}] Начинаем оформление (Улучшенная версия 10.04)...`);
    
    if ((await tPage.url()).includes('profile/setup/')) {
        await tPage.waitForSelector('input[name="username"]', { timeout: 15000 }).catch(()=>{});
        await tPage.type('input[name="username"]', sr.safe_name, { delay: 50 });
        await tPage.keyboard.press('Enter');
        await sleep(6000);
    }

    // 1. Выбор шаблона
    await tPage.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2' });
    await sleep(4000);

    if ((await tPage.url()).includes('/templates/')) {
        log('Выбор шаблона (10.04 - Координаты)...');
        await tPage.mouse.click(372, 238); await sleep(3000); // Мобильные сайты
        await tPage.mouse.click(460, 549); await sleep(5000); // Пустой шаблон
        await tPage.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('button, div, span')).find(el => el.innerText?.trim() === 'Да' || el.innerText?.trim() === 'Yes');
            if (btn) btn.click();
        });
        await sleep(10000);
    }

    // ВАЖНО: После выбора шаблона Taplink может кинуть в настройки дизайна. 
    // Нам нужно вернуться на главную страницу редактирования!
    log('Переход на главную страницу профиля...');
    await tPage.goto('https://taplink.ru/profile/', { waitUntil: 'networkidle2' });
    await sleep(5000);

    // Закрываем мусор
    await tPage.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, span, div, a'));
        const close = btns.find(b => /понятно|закрыть|пропустить|skip|close|got it/i.test(b.innerText || ''));
        if (close) close.click();
    });
    await sleep(2000);

    // ШАГ 1: АВАТАР
    const logoPath = sr.logo_local || `data/${sr.safe_name}/logo.jpg`;
    if (fs.existsSync(path.resolve(logoPath))) {
        log('1. Загрузка Логотипа...');
        await openNewBlockMenu(tPage);
        await selectBlockType(tPage, 'Аватар|Avatar');
        
        const fileInp = await tPage.waitForSelector('input[type="file"]', { timeout: 10000 }).catch(()=>null);
        if (fileInp) {
            await fileInp.uploadFile(path.resolve(logoPath));
            await sleep(8000); 
            await ensureSaved(tPage);
        } else {
            log('   [!] Не найдено поле для загрузки файла логотипа.');
        }
    }

    // ШАГ 2: БАННЕР/КАРТИНКА
    if (sr.images_local && sr.images_local.length > 0) {
        const bannerPath = path.resolve(process.cwd(), sr.images_local[0]);
        if (fs.existsSync(bannerPath)) {
            log('2. Загрузка Баннера/Картинки...');
            await openNewBlockMenu(tPage);
            await selectBlockType(tPage, 'Баннер|Banner');
            
            await sleep(3000);
            const isPro = await tPage.evaluate(() => document.body.innerText.includes('PRO') || !!document.querySelector('.is-pro-label'));
            if (isPro) {
                log('   ⚠️ Баннер заблокирован (PRO). Используем Картинку...');
                await tPage.keyboard.press('Escape'); await sleep(1500);
                await openNewBlockMenu(tPage);
                await selectBlockType(tPage, 'Картинка|Image');
            }
            
            const bInp = await tPage.waitForSelector('input[type="file"]', { timeout: 10000 }).catch(()=>null);
            if (bInp) {
                await bInp.uploadFile(bannerPath);
                await sleep(8000);
                await ensureSaved(tPage);
            }
        }
    }

    // ШАГ 3: БИО
    log('3. Добавление Bio...');
    await openNewBlockMenu(tPage);
    await selectBlockType(tPage, 'Текст|Text');
    await sleep(2000);
    await tPage.keyboard.type('Official Showroom Information\n\n', { delay: 1 });
    await tPage.keyboard.type(sr.bio, { delay: 1 });
    await sleep(2000); 
    await ensureSaved(tPage);

    // ШАГ 4: ССЫЛКИ
    log('4. Добавление ссылок...');
    const linksToAdd = [
        { t: 'Official Showroom Catalog', link: sr.profile_url },
        { t: 'Current Stock - Cars for Sale', link: sr.cars_url }
    ];
    for (const item of linksToAdd) {
        if (!item.link) continue;
        log(`   - Добавление ссылки: ${item.t}`);
        await openNewBlockMenu(tPage);
        await selectBlockType(tPage, 'Ссылка|Link');
        
        await tPage.waitForSelector('input[type="text"]', { timeout: 10000 }).catch(()=>{});
        const inps = await tPage.$$('input[type="text"]');
        if (inps.length >= 2) {
            await inps[0].type(item.t);
            await inps[1].type(item.link);
        }
        await ensureSaved(tPage);
    }

    log(`[${sr.name}] Оформление завершено ✅`);
    return true;
}

// ─── Главный цикл ─────────────────────────────────────────────────────────────
async function run() {
    let showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise(r => {
        rl.question('\n⚠️ СБРОСИТЬ ПРОГРЕСС? (y/N): ', ans => r(ans.toLowerCase()));
    });
    rl.close();

    if (answer === 'y' || answer === 'д') {
        showrooms.forEach(s => { s.taplink_created = false; s.taplink_designed = false; });
        await saveProgress(showrooms);
        log('Прогресс сброшен.');
    }

    let processed = 0;
    for (let i = 0; i < showrooms.length; i++) {
        const sr = showrooms[i];
        if (sr.taplink_designed) continue;
        if (testLimit > 0 && processed >= testLimit) break;

        log(`\n[${i+1}/${showrooms.length}] >>> ${sr.name}`);
        
        const browser = await puppeteer.launch({
            headless: false,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'],
            defaultViewport: { width: 1280, height: 900 }
        });
        
        const mPage = await browser.newPage();
        const tPage = await browser.newPage();

        try {
            const email = await getVisualEmail(mPage);
            if (!email) { await browser.close(); continue; }

            const registered = await registerTaplink(tPage, mPage, email, PASS);
            if (!registered) { await browser.close(); continue; }
            
            sr.taplink_created = true;
            sr.taplink_email = email;
            sr.taplink_url = `https://taplink.cc/${sr.safe_name}`;
            await saveProgress(showrooms);

            const designed = await designShowroom(tPage, sr);
            if (designed) {
                sr.taplink_designed = true;
                await saveProgress(showrooms);
                processed++;
            }

        } catch (e) {
            log(`Критическая ошибка: ${e.message}`);
        } finally {
            await sleep(5000);
            await browser.close().catch(()=>{});
        }
    }
    log('\n=== МАРАФОН ЗАВЕРШЕН ===');
}

run();
