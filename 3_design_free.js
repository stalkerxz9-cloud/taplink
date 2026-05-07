/**
 * 3_design_free.js (v8.00 THE MATRIX LAUNCH)
 * ГЛОБАЛЬНАЯ АВТОМАТИЗАЦИЯ 600+ ШОУРУМОВ.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

async function run() {
    const database = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const total = database.length;
    
    log(`🏁 СТАРТ ГЛОБАЛЬНОГО МАРАФОНА: ${total} шоурумов.`);

    for (let index = 0; index < total; index++) {
        const sr = database[index];
        if (sr.taplink_published) continue; // Пропуск уже готовых

        log(`\n[${index + 1}/${total}] >>> 🏎️ ЦЕЛЬ: ${sr.name || sr.safe_name}`);
        
        const browser = await puppeteer.launch({ 
            headless: false, 
            args: ['--no-sandbox', '--window-size=1280,800', '--disable-setuid-sandbox'] 
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });
        page.setDefaultNavigationTimeout(60000);

        try {
            const email = sr.taplink_email || 'ejw97@mailnesia.store';
            const pass = sr.taplink_pass || 'SecureShowroom#2024';
            
            await page.goto('https://taplink.ru/profile/auth/signin/', { waitUntil: 'domcontentloaded' });
            await (await page.waitForSelector('input[type="email"]')).type(email);
            await page.keyboard.press('Enter'); await sleep(2500);
            await (await page.waitForSelector('input[type="password"]')).type(pass);
            await page.keyboard.press('Enter'); await sleep(8000);

            const srDir = path.resolve(process.cwd(), 'data', sr.safe_name);

            // 1. АВАТАР + БАННЕР
            const logo = path.join(srDir, 'logo.jpg');
            if (fs.existsSync(logo)) {
                await (await page.waitForSelector('button.is-new-block')).click(); await sleep(2500);
                await page.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Аватар'))?.click());
                await sleep(4000);
                await page.mouse.click(504, 505); await sleep(2500);
                const [fC] = await Promise.all([page.waitForFileChooser(), page.evaluate(() => document.querySelectorAll('input[type="file"]')[0].click())]);
                await fC.accept([logo]); await sleep(6000);
                await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(el => el.innerText?.includes('Загрузить'))?.click());
                await sleep(6500);
                await page.mouse.click(857, 670); await sleep(3000); 
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button, i, .upload-input-button, [title*="галереи"]')).find(el => el.innerText?.includes('галереи') || el.title?.includes('галереи') || el.classList.contains('icon-image-gallery'));
                    if (btn) btn.click();
                });
                await sleep(6500);
                await page.mouse.click(341, 385); await sleep(4000);
                await ensureSaved(page); 
            }

            await addSeparator(page);

            // 2. BIO
            await page.click('button.is-new-block'); await sleep(3000);
            await page.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Текст'))?.click());
            await sleep(5000);
            const editor = await page.waitForSelector('textarea, [contenteditable="true"]');
            await editor.click(); 
            const bioText = `Продажа и экспорт премиальных автомобилей напрямую из ОАЭ. Широкий выбор люксовых моделей в наличии и под заказ. Гарантия юридической чистоты, профессиональный подбор и быстрая доставка в любую точку мира. Наши менеджеры помогут вам на каждом этапе сделки.`;
            await page.keyboard.type(sr.bio || bioText, { delay: 1 });
            await sleep(1500);
            await page.mouse.click(670, 298); await sleep(2500); // Центр
            await page.evaluate(() => {
                const c = Array.from(document.querySelectorAll('.dropdown-item, .item, span, a')).find(el => el.innerText?.includes('По центру') || el.innerText?.includes('Center'));
                if (c) c.click();
            });
            await sleep(1500);
            await page.mouse.click(413, 451); await sleep(2000); // Размер
            await page.evaluate(() => {
                const t = Array.from(document.querySelectorAll('.dropdown-item, .item, span, a')).find(el => el.innerText?.includes('Большой текст'));
                if (t) t.click();
            });
            await sleep(1500);
            await page.evaluate(() => {
                const d = document.querySelectorAll('.button-dropdown.is-toolbar-control');
                if (d[1]) d[1].click();
            });
            await sleep(2000);
            await page.evaluate(() => {
                const fonts = Array.from(document.querySelectorAll('.dropdown-item, .item, span'));
                const serious = fonts.find(el => el.innerText?.includes('Serif') || el.innerText?.includes('Georgia'));
                if (serious) serious.click();
            });
            await sleep(1000); await ensureSaved(page); 

            await addSeparator(page);

            // 3. LINKS
            const links = [
                { t: 'Сам шоурум', s: 'Более 500 предложений', u: sr.profile_url },
                { t: 'Авто шоурума', s: 'Каталог автомобилей', u: sr.cars_url },
                { t: 'Аренда авто', s: 'Люкс и спорткары ежедневно', u: sr.rent_url },
                { t: 'Автомобильные номера', s: 'Эксклюзивные госномера', u: sr.numbers_url },
                { t: 'Проданные авто', s: 'Галерея сделок', u: sr.sold_url }
            ];

            for (const l of links) {
                await page.click('button.is-new-block'); await sleep(2500);
                await page.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Ссылка'))?.click());
                await sleep(4000);
                const inps = await page.$$('.modal-card-body input');
                if (inps.length >= 3) { 
                    await inps[0].type(l.t); 
                    await inps[1].type(l.s); 
                    await inps[2].type(l.u); 
                }
                await page.evaluate(() => Array.from(document.querySelectorAll('.nav-tabs a')).find(el => el.innerText?.includes('ДИЗАЙН'))?.click());
                await sleep(3000);
                await page.evaluate(() => {
                    const tr = Array.from(document.querySelectorAll('label')).find(el => el.innerText?.includes('Анимация'))?.parentElement.querySelector('button, .select');
                    if (tr) tr.click();
                });
                await sleep(3000);
                await page.mouse.click(836, 415); await sleep(1500); // Блик
                await ensureSaved(page); 
            }

            await addSeparator(page);

            // 4. WhatsApp
            await page.click('button.is-new-block'); await sleep(3000);
            await page.evaluate(() => Array.from(document.querySelectorAll('button.is-block-button')).find(el => el.innerText?.includes('Мессенджеры'))?.click());
            await sleep(6000);
            await page.evaluate(() => Array.from(document.querySelectorAll('button, a')).find(el => el.innerText?.includes('Добавить новый пункт'))?.click());
            await sleep(3500);
            await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('.messenger-list-item, div, span, button'));
                const wa = items.find(el => el.innerText?.trim() === 'WhatsApp' && el.offsetHeight > 0);
                if (wa) wa.click();
            });
            await sleep(7500); 
            const waInps = await page.$$('.modal-card-body input');
            if (waInps.length >= 2) { 
                await waInps[0].click({clickCount: 3}); 
                await page.keyboard.type('Связаться в WhatsApp'); 
            }
            const flag = await page.waitForSelector('.iti__flag-container, .input-phone__country', { visible: true });
            await flag.click(); await sleep(2000);
            await page.keyboard.type('United Arab Emirates'); await sleep(2500);
            await page.keyboard.press('Enter'); await sleep(2000);
            const pInp = await page.waitForSelector('input[type="tel"]');
            await pInp.click({clickCount: 3});
            let cl = (sr.whatsapp || '501234567').replace(/\D/g, '');
            if (cl.startsWith('971')) cl = cl.substring(3);
            await page.keyboard.type(cl); await sleep(1500);
            await ensureSaved(page);

            // 5. PUBLISH
            await sleep(3500);
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('a, button, span')).find(el => el.innerText?.includes('Получить ссылку') || el.innerText?.includes('ссылку'));
                if (btn) btn.click();
            });
            await sleep(4500);
            await page.evaluate(() => {
                const options = document.querySelectorAll('.modal-card-body .radio, .modal-card-body label');
                if (options[0]) options[0].click();
            });
            await sleep(2000);
            log(`   Ввод названия (Sniper: 462, 550)...`);
            await page.mouse.click(462, 550); await sleep(1500);
            await page.keyboard.type(sr.safe_name, { delay: 90 }); await sleep(2500);
            
            await page.evaluate(() => {
                const btn = Array.from(document.querySelectorAll('button')).find(el => el.innerText?.includes('Подключить'));
                if (btn) btn.click();
            });
            await sleep(6500);

            log(`✅ [УСПЕХ] ${sr.safe_name} Опубликован.`);
            sr.taplink_designed = true; sr.taplink_published = true;
            fs.writeFileSync(dataPath, JSON.stringify(database, null, 2));

        } catch (e) { log(`❌ [ОШИБКА] ${sr.safe_name}: ${e.message}`); }
        await browser.close(); await sleep(500);
    }
    log('🏁 МАРАФОН ЗАВЕРШЕН.');
}
run();
