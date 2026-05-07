/**
 * 1b_fetch_backgrounds.js
 * Докачивает для каждого шоурума:
 *   1. logo_local     — логотип со страницы шоурума (фото профиля в Taplink)
 *   2. background_local — баннер/фон (первое фото авто как fallback)
 *
 * Фото авто (images_local) НЕ трогает — они уже скачаны.
 * Пропускает шоурумы у которых оба файла уже есть.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const BASE_URL = 'https://auto.ae';

// ─── Утилиты ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/'))  return BASE_URL + url;
    return url;
}

function fileExists(relativePath) {
    if (!relativePath) return false;
    return fs.existsSync(path.resolve(process.cwd(), relativePath));
}

async function downloadImage(url, filepathTemplate, page) {
    if (!url || !url.startsWith('http')) return null;
    try {
        let buffer;
        let ext = 'jpg';

        if (url.includes('googleapis.com') || url.includes('auto-ae-prod')) {
            // Google Cloud Storage — качаем через axios
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
            buffer = Buffer.from(res.data, 'binary');
            const ct = res.headers['content-type'] || '';
            if (ct.includes('png'))  ext = 'png';
            else if (ct.includes('webp')) ext = 'webp';
        } else {
            // Другие URL — качаем через браузер
            const result = await page.evaluate(async (imgUrl) => {
                try {
                    const res = await fetch(imgUrl);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const blob = await res.blob();
                    return await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            let ext = 'jpg';
                            if (blob.type.includes('png'))  ext = 'png';
                            if (blob.type.includes('webp')) ext = 'webp';
                            resolve({ data: reader.result, ext });
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch (e) {
                    return { error: e.message };
                }
            }, url);

            if (result.error) throw new Error(result.error);
            ext = result.ext || 'jpg';
            buffer = Buffer.from(result.data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }

        const finalPath = filepathTemplate.replace('.EXT', '.' + ext);
        fs.writeFileSync(finalPath, buffer);
        return { path: finalPath, ext, relativePath: null };
    } catch (e) {
        console.log(`  [!] Ошибка: ${e.message}`);
        return null;
    }
}

// ─── Браузер ──────────────────────────────────────────────────────────────────
async function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        defaultViewport: { width: 1280, height: 800 }
    });
}

// ─── ГЛАВНЫЙ ЦИКЛ ─────────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(dataPath)) {
        console.error('Нет файла showrooms_data.json!');
        return;
    }

    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Статистика
    const needLogo = showrooms.filter(s => !fileExists(s.logo_local)).length;
    const needBg   = showrooms.filter(s => !fileExists(s.background_local)).length;

    console.log(`=== ДОКАЧКА ЛОГОТИПОВ И ФОНОВ ===`);
    console.log(`Всего шоурумов:          ${showrooms.length}`);
    console.log(`Нужен логотип:           ${needLogo}`);
    console.log(`Нужен фон:               ${needBg}`);
    console.log(`Нужно обработать:        ${showrooms.filter(s => !fileExists(s.logo_local) || !fileExists(s.background_local)).length}\n`);

    const toProcess = showrooms.filter(s => !fileExists(s.logo_local) || !fileExists(s.background_local));
    if (toProcess.length === 0) {
        console.log('✅ Всё уже скачано!');
        return;
    }

    let browser = await launchBrowser();
    let page    = await browser.newPage();
    let done = 0;
    let idx  = 0;

    for (let i = 0; i < showrooms.length; i++) {
        const sr = showrooms[i];
        const logoOk = fileExists(sr.logo_local);
        const bgOk   = fileExists(sr.background_local);

        if (logoOk && bgOk) continue;

        idx++;
        const safeName = sr.safe_name || 'unknown';
        const dir = path.join(process.cwd(), 'data', safeName);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        console.log(`\n[${idx}/${toProcess.length}] ${sr.name}`);

        // Проверяем живость браузера
        try { await browser.version(); }
        catch {
            console.log('  [!] Браузер упал — перезапуск...');
            try { browser = await launchBrowser(); page = await browser.newPage(); }
            catch (e) { console.log(`  [ФАТАЛ] ${e.message}`); continue; }
        }

        // ── 1. ЛОГОТИП ────────────────────────────────────────────────────────
        if (!logoOk) {
            let logoUrl = fixUrl(sr.logo_url || '');

            // Если URL есть — качаем без захода на страницу
            if (logoUrl.length > 10) {
                // Для auto.ae image proxy — берём оригинал
                const plainMatch = logoUrl.match(/plain\/(https?:\/\/.+)/);
                if (plainMatch) logoUrl = decodeURIComponent(plainMatch[1]);

                process.stdout.write(`  [ЛОГО] Скачиваем... `);
                const result = await downloadImage(logoUrl, path.join(dir, 'logo.EXT'), page);
                if (result) {
                    sr.logo_local = `data/${safeName}/logo.${result.ext}`;
                    console.log(`OK → ${sr.logo_local}`);
                } else {
                    // Fallback: первое фото авто
                    if (sr.images_local && sr.images_local.length > 0) {
                        sr.logo_local = sr.images_local[0];
                        console.log(`FALLBACK = первое фото авто`);
                    } else {
                        console.log(`НЕТ ЛОГОТИПА`);
                    }
                }
            } else {
                // Нет URL — заходим на страницу и ищем
                process.stdout.write(`  [ЛОГО] Ищем на странице... `);
                try {
                    await page.goto(sr.profile_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await sleep(1500);

                    logoUrl = await page.evaluate(() => {
                        const selectors = [
                            'div[class*="Avatar_avatar"] img',
                            'div[class*="ShowroomAvatar"] img',
                            'div[class*="avatar"] img',
                            'div[class*="logo"] img',
                            '.showroom-logo img',
                        ];
                        for (const sel of selectors) {
                            const img = document.querySelector(sel);
                            if (img && img.src && !img.src.startsWith('data:')) return img.src;
                        }
                        return '';
                    });

                    if (logoUrl) {
                        const plainMatch = logoUrl.match(/plain\/(https?:\/\/.+)/);
                        if (plainMatch) logoUrl = decodeURIComponent(plainMatch[1]);
                        const result = await downloadImage(logoUrl, path.join(dir, 'logo.EXT'), page);
                        if (result) {
                            sr.logo_url   = logoUrl;
                            sr.logo_local = `data/${safeName}/logo.${result.ext}`;
                            console.log(`OK → ${sr.logo_local}`);
                        } else {
                            sr.logo_local = sr.images_local?.[0] || '';
                            console.log(`FALLBACK`);
                        }
                    } else {
                        sr.logo_local = sr.images_local?.[0] || '';
                        console.log(`НЕ НАЙДЕН`);
                    }
                } catch (e) {
                    console.log(`ОШИБКА: ${e.message}`);
                }
            }
        } else {
            console.log(`  [ЛОГО] Уже есть ✓`);
        }

        // ── 2. ФОН ────────────────────────────────────────────────────────────
        if (!bgOk) {
            let bgUrl = fixUrl(sr.background_url || '');

            if (bgUrl.length > 10) {
                // Скачиваем напрямую
                const plainMatch = bgUrl.match(/plain\/(https?:\/\/.+)/);
                if (plainMatch) bgUrl = decodeURIComponent(plainMatch[1]);

                process.stdout.write(`  [ФОН]  Скачиваем... `);
                const result = await downloadImage(bgUrl, path.join(dir, 'background.EXT'), page);
                if (result) {
                    sr.background_local = `data/${safeName}/background.${result.ext}`;
                    console.log(`OK → ${sr.background_local}`);
                } else {
                    // Fallback: первое фото авто
                    sr.background_local = sr.images_local?.[0] || '';
                    console.log(`FALLBACK = первое фото авто`);
                }
            } else {
                // Нет background_url — заходим на страницу
                process.stdout.write(`  [ФОН]  Ищем баннер на странице... `);
                try {
                    // Заходим только если ещё не заходили для логотипа (в рамках этого шоурума)
                    const curUrl = page.url();
                    if (!curUrl.includes(sr.safe_name)) {
                        await page.goto(sr.profile_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        await sleep(1500);
                    }

                    bgUrl = await page.evaluate(() => {
                        const selectors = [
                            'div[class*="Banner_banner"] img',
                            'div[class*="ShowroomBanner"] img',
                            'div[class*="banner"] img',
                            'div[class*="Hero"] img',
                            'div[class*="Cover"] img',
                        ];
                        for (const sel of selectors) {
                            const img = document.querySelector(sel);
                            if (img && img.src && !img.src.startsWith('data:')) return img.src;
                        }
                        return '';
                    });

                    if (bgUrl) {
                        const plainMatch = bgUrl.match(/plain\/(https?:\/\/.+)/);
                        if (plainMatch) bgUrl = decodeURIComponent(plainMatch[1]);
                        const result = await downloadImage(bgUrl, path.join(dir, 'background.EXT'), page);
                        if (result) {
                            sr.background_url   = bgUrl;
                            sr.background_local = `data/${safeName}/background.${result.ext}`;
                            console.log(`OK → ${sr.background_local}`);
                        } else {
                            sr.background_local = sr.images_local?.[0] || '';
                            console.log(`FALLBACK`);
                        }
                    } else {
                        // Нет баннера — используем первое фото авто
                        sr.background_local = sr.images_local?.[0] || '';
                        console.log(`НЕТ БАННЕРА → первое фото авто`);
                    }
                } catch (e) {
                    sr.background_local = sr.images_local?.[0] || '';
                    console.log(`ОШИБКА → fallback: ${e.message}`);
                }
            }
        } else {
            console.log(`  [ФОН]  Уже есть ✓`);
        }

        done++;
        // Сохраняем после каждого шоурума
        fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
        await sleep(300);
    }

    await browser.close();
    console.log(`\n=== ГОТОВО ===`);
    console.log(`Обработано: ${done}`);
    console.log(`Файл обновлён: ${dataPath}`);
}

run().catch(e => {
    console.error('КРИТИЧЕСКАЯ ОШИБКА:', e.message);
    process.exit(1);
});
