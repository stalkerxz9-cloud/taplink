import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import AnonymizeUA from 'puppeteer-extra-plugin-anonymize-ua';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

puppeteer.use(StealthPlugin());
puppeteer.use(AnonymizeUA());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataPath = path.join(__dirname, 'data', 'showrooms_data.json');
const brokenPath = path.join(__dirname, 'data', 'broken_links.json');
const excelPath = path.join(__dirname, 'taplink_report.xlsx');
const PASS = 'SecureShowroom#2024';
const HEADLESS = false;

function log(msg) {
    const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
    console.log(`[${time}] ${msg}`);
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function updateExcelReport(sr) {
    try {
        const workbook = new ExcelJS.Workbook();
        if (fs.existsSync(excelPath)) {
            await workbook.xlsx.readFile(excelPath);
        } else {
            const sheet = workbook.addWorksheet('Taplink Showrooms');
            sheet.columns = [
                { header: 'Название шоурума', key: 'name', width: 30 },
                { header: 'Ссылка Taplink', key: 'url', width: 40 },
                { header: 'Email', key: 'email', width: 30 },
                { header: 'Пароль', key: 'pass', width: 20 },
                { header: 'Дата', key: 'date', width: 20 }
            ];
        }
        const sheet = workbook.getWorksheet(1);
        let row = null;
        sheet.eachRow((r, i) => {
            if (i === 1) return; // Пропускаем заголовок
            if (r.getCell(1).value === sr.name || r.getCell(3).value === sr.taplink_email) {
                row = r;
            }
        });

        if (!row) row = sheet.addRow({});
        row.getCell(1).value = sr.name;
        row.getCell(2).value = sr.taplink_url;
        row.getCell(3).value = sr.taplink_email;
        row.getCell(4).value = PASS;
        row.getCell(5).value = new Date().toLocaleDateString();
        await workbook.xlsx.writeFile(excelPath);
    } catch (e) {
        log(`[!] Ошибка записи Excel: ${e.message}`);
    }
}

async function fixDomain(page, sr) {
    log(`   Извлекаем реальную ссылку для ${sr.name}...`);
    
    // Главная страница профиля (редактор)
    await page.goto('https://taplink.ru/profile/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);

    // 1. Ищем синюю кнопку "Опубликовать" (Publish)
    const btnPublished = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, .button, a'));
        const pubBtn = btns.find(b => {
            const t = (b.innerText || '').trim().toLowerCase();
            return t === 'опубликовать' || t === 'publish';
        });
        if (pubBtn && pubBtn.offsetWidth > 0) {
            pubBtn.click();
            return true;
        }
        return false;
    });

    if (btnPublished) {
        log('      [!] Нажата кнопка "Опубликовать"');
        await sleep(5000);
        // Закрываем окошко с QR-кодом, если оно вылезло
        await page.keyboard.press('Escape').catch(()=>null);
        await sleep(1000);
    }

    // 2. Выдергиваем текст "Моя ссылка: https://taplink.cc/..."
    const trueUrl = await page.evaluate(() => {
        // Пробуем найти прямую ссылку
        const aTags = Array.from(document.querySelectorAll('a'))
            .filter(a => a.innerText && a.innerText.includes('taplink.cc/'));
        if (aTags.length > 0) return aTags[0].innerText.trim();
        
        // Либо парсим весь текст документа
        const matches = document.body.innerText.match(/https?:\/\/taplink\.cc\/[A-Za-z0-9_-]+/i);
        return matches ? matches[0] : null;
    });

    if (trueUrl) {
        log(`      ✅ УСПЕХ! Реальная ссылка профиля: ${trueUrl}`);
        // Возвращаем просто "хвостик" ссылки
        return trueUrl.split('/').pop().trim();
    } else {
        log('      [!] Ссылка не найдена на главной (возможно профиль пуст?)');
        return null;
    }
}

async function runFixer() {
    log('🚀 ЗАПУСК ФИКСЕРА 404...');
    
    if (!fs.existsSync(brokenPath)) {
        log('❌ Файл broken_links.json не найден. Сначала запустите check_404.js');
        return;
    }

    const broken = JSON.parse(fs.readFileSync(brokenPath, 'utf8'));
    let showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

    log(`Найдено ${broken.length} битых ссылок. Начинаем исправление...`);

    const browser = await puppeteer.launch({
        headless: HEADLESS ? 'new' : false,
        args: ['--no-sandbox', '--window-size=1280,900', '--no-proxy-server']
    });

    for (let i = 0; i < broken.length; i++) {
        const item = broken[i];
        const sr = showrooms.find(s => s.name === item.name);
        if (!sr) continue;

        log(`\n[${i+1}/${broken.length}] Исправляем: ${sr.name}`);

        let page;
        try {
            page = await browser.newPage();
            await page.setViewport({ width: 1280, height: 900 });

            // Жестко очищаем куки для этой вкладки
            const client = await page.target().createCDPSession();
            await client.send('Network.clearBrowserCookies');

            // 1. ЛОГИН
            await page.goto('https://taplink.ru/profile/auth/signup/', { waitUntil: 'domcontentloaded' });
            await sleep(3000);

            // ПЕРЕКЛЮЧАЕМ НА "АВТОРИЗАЦИЯ" ТАБ (чтобы войти, а не регаться)
            await page.evaluate(() => {
                const tabs = Array.from(document.querySelectorAll('a, button, span, .tabs li')).filter(el => /авторизация|вход|login|sign in/i.test(el.innerText || ''));
                if (tabs.length > 0) tabs[0].click();
            });
            await sleep(2000);

            // Ждем поле email
            await page.waitForSelector('input[type="email"], input[name="email"]', {visible: true, timeout: 30000});
            await page.type('input[type="email"], input[name="email"]', sr.taplink_email, { delay: 50 });
            
            // Если есть поле пароля сразу — вводим
            const pwdImmediate = await page.$('input[type="password"], input[name="password"]');
            if (pwdImmediate) {
                await pwdImmediate.type(PASS, {delay: 50});
                await page.keyboard.press('Enter');
            } else {
                // Двухшаговый логин
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button, input[type="submit"]'))
                        .find(b => /продолжить|далее|next|войти|да, все верно/i.test(b.innerText || b.value || ''));
                    if (btn) btn.click();
                });
                await sleep(2000);
                await page.keyboard.press('Enter'); 
                await sleep(4000);
                
                // Проверяем ошибку удаленного аккаунта
                const deleted = await page.evaluate(() => {
                    return document.body.innerText.toLowerCase().includes('почтовый ящик не существует') || 
                           document.body.innerText.toLowerCase().includes('не найден');
                });
                if (deleted) {
                    log(`❌ АККАУНТ УДАЛЕН ТАПЛИНКОМ: ${sr.taplink_email}`);
                    if (page) await page.close().catch(()=>null);
                    continue;
                }

                await page.waitForSelector('input[type="password"], input[name="password"]', {visible: true, timeout: 15000});
                await page.type('input[type="password"], input[name="password"]', PASS, { delay: 50 });
                await page.evaluate(() => {
                    const btn = Array.from(document.querySelectorAll('button'))
                        .find(b => /регистр|далее|войти|продолжить|login/i.test(b.innerText || ''));
                    if (btn) btn.click();
                });
                await sleep(2000);
                await page.keyboard.press('Enter');
            }
            
            await sleep(6000);

            // 2. ИСПРАВЛЕНИЕ
            const fixedName = await fixDomain(page, sr);
            if (fixedName) {
                sr.taplink_url = `https://taplink.cc/${fixedName}`;
                sr.taplink_published = true;
                
                // Сохраняем в JSON сразу
                fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
                
                // Обновляем EXCEL
                await updateExcelReport(sr);
                log(`✅ ${sr.name} ИСПРАВЛЕН: ${sr.taplink_url}`);
            } else {
                log(`❌ Не удалось исправить ${sr.name}`);
            }

            if (page) await page.close().catch(()=>null);

        } catch (e) {
            log(`❌ ОШИБКА при исправлении ${sr.name}: ${e.message}`);
            if (page) await page.close().catch(()=>null);
        }
    }

    log('\n--- ИСПРАВЛЕНИЕ ЗАВЕРШЕНО ---');
    await browser.close();
}

runFixer();
