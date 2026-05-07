/**
 * 1c_fetch_banners.js
 * Скачивает баннеры (широкие фоновые фото) для каждого шоурума с Auto.ae
 * Сохраняет как banner.jpg и обновляет background_local в showrooms_data.json
 *
 * Запуск: node 1c_fetch_banners.js
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const dataPath   = path.join(process.cwd(), 'data', 'showrooms_data.json');
const BASE_URL   = 'https://auto.ae';
const DELAY_MS   = 1200;          // пауза между шоурумами
const RESTART_EVERY = 30;         // перезапуск браузера каждые N шоурумов

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/'))  return BASE_URL + url;
    return url;
}

function fileExists(rel) {
    if (!rel) return false;
    return fs.existsSync(path.resolve(process.cwd(), rel));
}

// ─── Скачать изображение ─────────────────────────────────────────────────────
async function downloadImage(url, destTemplate, page) {
    if (!url || !url.startsWith('http')) return null;
    try {
        let buffer, ext = 'jpg';

        if (url.includes('googleapis.com') || url.includes('auto-ae-prod')) {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 20000 });
            buffer = Buffer.from(res.data, 'binary');
            const ct = res.headers['content-type'] || '';
            if (ct.includes('png'))  ext = 'png';
            else if (ct.includes('webp')) ext = 'webp';
        } else {
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
                } catch (e) { return { error: e.message }; }
            }, url);

            if (result.error) throw new Error(result.error);
            ext = result.ext || 'jpg';
            buffer = Buffer.from(result.data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }

        const finalPath = destTemplate.replace('.EXT', '.' + ext);
        fs.writeFileSync(finalPath, buffer);
        return { path: finalPath, ext };
    } catch (e) {
        console.log(`  [!] Ошибка загрузки: ${e.message.slice(0, 80)}`);
        return null;
    }
}

// ─── Найти URL баннера на странице шоурума ────────────────────────────────────
async function findBannerUrl(page, profileUrl) {
    try {
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await sleep(2000);
    } catch (e) {
        console.log(`  [!] Не удалось загрузить страницу: ${e.message.slice(0, 80)}`);
        return null;
    }

    const url = await page.evaluate(() => {
        // ── 1. Ищем <img> с большой шириной (баннер) ──────────────────────
        const imgSelectors = [
            'div[class*="Banner"] img',
            'div[class*="banner"] img',
            'div[class*="Cover"] img',
            'div[class*="cover"] img',
            'div[class*="Hero"] img',
            'div[class*="header"] img',
            'div[class*="Background"] img',
            'picture source',
            'picture img',
        ];
        for (const sel of imgSelectors) {
            const els = document.querySelectorAll(sel);
            for (const el of els) {
                const src = el.src || el.srcset || el.getAttribute('srcset') || '';
                // Берём первый URL из srcset если нужно
                const firstUrl = src.split(' ')[0];
                if (firstUrl && !firstUrl.startsWith('data:') && firstUrl.length > 10) {
                    // Проверяем что это не аватар (маленький)
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 400 || el.naturalWidth > 400) return firstUrl;
                    if (rect.width === 0) return firstUrl; // невидимый — всё равно берём
                }
            }
        }

        // ── 2. Ищем background-image в CSS для широких элементов ──────────
        const allEls = document.querySelectorAll('div, section, header');
        for (const el of allEls) {
            if (el.offsetWidth < 600) continue;
            const style = window.getComputedStyle(el);
            const bg = style.backgroundImage;
            if (bg && bg !== 'none' && bg.startsWith('url(')) {
                const match = bg.match(/url\(["']?(https?[^"')]+)["']?\)/);
                if (match) return match[1];
            }
        }

        // ── 3. Ищем первый img с naturalWidth > 600 ───────────────────────
        const allImgs = document.querySelectorAll('img');
        for (const img of allImgs) {
            if ((img.naturalWidth > 600 || img.width > 600) &&
                img.src && !img.src.startsWith('data:') &&
                !img.src.includes('avatar') && !img.src.includes('logo') &&
                !img.src.includes('s:72')) {
                return img.src;
            }
        }

        return null;
    });

    return url ? fixUrl(url) : null;
}

// ─── Запуск браузера ──────────────────────────────────────────────────────────
async function launchBrowser() {
    return puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
               '--disable-gpu', '--no-first-run', '--js-flags=--max-old-space-size=512'],
        defaultViewport: { width: 1400, height: 900 }
    });
}

// ─── ГЛАВНЫЙ ЦИКЛ ─────────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(dataPath)) {
        console.error('Файл showrooms_data.json не найден!');
        process.exit(1);
    }

    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

    // Фильтруем: нужен только один шоурум из дублей (unique safe_name)
    // и только те, у которых нет banner.* файла
    const seen = new Set();
    const toProcess = [];

    for (const sr of showrooms) {
        const sn = sr.safe_name;
        if (seen.has(sn)) continue;
        seen.add(sn);

        const dir = path.join(process.cwd(), 'data', sn);
        const hasBanner = fs.existsSync(dir) &&
            fs.readdirSync(dir).some(f => f.startsWith('banner.'));

        if (!hasBanner) toProcess.push(sr);
    }

    const total = toProcess.length;
    const uniqueTotal = seen.size;

    console.log(`=== СКАЧИВАНИЕ БАННЕРОВ ===`);
    console.log(`Всего в JSON:           ${showrooms.length}`);
    console.log(`Уникальных шоурумов:    ${uniqueTotal}`);
    console.log(`Нужно скачать баннеров: ${total}`);

    if (total === 0) {
        console.log('\n✅ Все баннеры уже скачаны!');
        return;
    }

    let browser = await launchBrowser();
    let page    = await browser.newPage();
    let done = 0, failed = 0, noBanner = 0;

    for (let i = 0; i < toProcess.length; i++) {
        const sr = toProcess[i];
        const sn = sr.safe_name;
        const dir = path.join(process.cwd(), 'data', sn);

        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        console.log(`\n[${i + 1}/${total}] ${sr.name} (${sn})`);

        // Перезапуск браузера периодически
        if (i > 0 && i % RESTART_EVERY === 0) {
            console.log('  [♻] Перезапуск браузера...');
            try { await browser.close(); } catch(_) {}
            await sleep(1000);
            browser = await launchBrowser();
            page    = await browser.newPage();
        }

        // Проверка живости
        try { await browser.version(); }
        catch {
            console.log('  [!] Браузер упал → перезапуск...');
            try { browser = await launchBrowser(); page = await browser.newPage(); }
            catch (e) { console.log(`  [ФАТАЛ] ${e.message}`); failed++; continue; }
        }

        // URL для посещения — предпочитаем /ru/ версию (меньше блокировок)
        const profileUrl = sr.profile_url || '';

        process.stdout.write(`  [БАННЕР] Ищем на ${profileUrl.slice(0, 60)}... `);
        let bannerUrl = await findBannerUrl(page, profileUrl);

        if (!bannerUrl) {
            console.log(`НЕТ БАННЕРА`);
            noBanner++;
        } else {
            // Разворачиваем proxy URL
            const plainMatch = bannerUrl.match(/plain\/(https?:\/\/.+)/);
            if (plainMatch) bannerUrl = decodeURIComponent(plainMatch[1]);

            const result = await downloadImage(bannerUrl, path.join(dir, 'banner.EXT'), page);
            if (result) {
                const rel = `data/${sn}/banner.${result.ext}`;
                // Обновляем все записи с этим safe_name
                for (const s of showrooms) {
                    if (s.safe_name === sn) {
                        s.background_url   = bannerUrl;
                        s.background_local = rel;
                    }
                }
                console.log(`OK → ${rel}`);
                done++;
            } else {
                console.log(`ОШИБКА ЗАГРУЗКИ`);
                failed++;
            }
        }

        // Сохраняем JSON каждые 10 шоурумов
        if (i % 10 === 0 || i === toProcess.length - 1) {
            fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
        }

        await sleep(DELAY_MS);
    }

    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
    try { await browser.close(); } catch(_) {}

    console.log(`\n=== ИТОГ ===`);
    console.log(`✅ Скачано баннеров:    ${done}`);
    console.log(`❌ Без баннера:         ${noBanner}`);
    console.log(`⚠️  Ошибки загрузки:    ${failed}`);
    console.log(`Обновлён файл:          ${dataPath}`);
}

run().catch(e => {
    console.error('КРИТИЧЕСКАЯ ОШИБКА:', e.message);
    process.exit(1);
});
