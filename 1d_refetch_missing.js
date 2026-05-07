/**
 * 1d_refetch_missing.js
 * Дособирает шоурумы у которых нет папки или папка пустая.
 * Берёт список URL из showrooms_data.json и перебирает только недостающие.
 * Также добавляет шоурумы которых нет в JSON вообще (со страниц списка).
 *
 * Запуск: node 1d_refetch_missing.js
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import axios from 'axios';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const dataDir      = path.join(process.cwd(), 'data');
const dataPath     = path.join(dataDir, 'showrooms_data.json');
const BASE_URL     = 'https://auto.ae';
const LIST_URL     = 'https://auto.ae/ru/showrooms/all/';
const PHOTOS_LIMIT = 6;
const DELAY_MS     = 1500;
const RESTART_EVERY = 20;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fixUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/'))  return BASE_URL + url;
    return url;
}

function folderIsComplete(safeName) {
    const dir = path.join(dataDir, safeName);
    if (!fs.existsSync(dir)) return false;
    const files = fs.readdirSync(dir);
    const hasPhotos = files.some(f => /^car_/i.test(f));
    const hasLogo   = files.some(f => /^logo\./i.test(f));
    return hasPhotos && hasLogo;
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
            const r = await page.evaluate(async (imgUrl) => {
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
            if (r.error) throw new Error(r.error);
            ext = r.ext || 'jpg';
            buffer = Buffer.from(r.data.replace(/^data:image\/\w+;base64,/, ''), 'base64');
        }
        const finalPath = destTemplate.replace('.EXT', '.' + ext);
        fs.writeFileSync(finalPath, buffer);
        return { path: finalPath, ext };
    } catch (e) {
        console.log(`    [!] Ошибка: ${e.message.slice(0, 80)}`);
        return null;
    }
}

// ─── Обработать один шоурум ──────────────────────────────────────────────────
async function processShowroom(showroomUrl, browser, showrooms) {
    const urlSafeName = showroomUrl.replace(/\/$/, '').split('/').pop();
    const safeName    = urlSafeName || 'unknown';
    const dir         = path.join(dataDir, safeName);

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    let showroomPage;
    try {
        showroomPage = await browser.newPage();
        await showroomPage.goto(showroomUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2500);

        const details = await showroomPage.evaluate(() => {
            const name = document.querySelector('h1')?.innerText?.trim() || 'Unknown Showroom';

            const logoImg   = document.querySelector('div[class*="Avatar_avatar"] img, div[class*="avatar"] img');
            const bannerImg = document.querySelector(
                'div[class*="Banner"] img, div[class*="banner"] img, div[class*="Cover"] img, picture img'
            );

            // background via CSS
            let bgViaCss = '';
            for (const el of document.querySelectorAll('div, section')) {
                if (el.offsetWidth < 600) continue;
                const bg = window.getComputedStyle(el).backgroundImage;
                if (bg && bg !== 'none' && bg.startsWith('url(')) {
                    const m = bg.match(/url\(["']?(https?[^"')]+)["']?\)/);
                    if (m) { bgViaCss = m[1]; break; }
                }
            }

            const logo       = logoImg   ? logoImg.src   : '';
            const background = bannerImg ? bannerImg.src : bgViaCss;
            const waLink     = document.querySelector('a[href*="wa.me"], a[href*="whatsapp.com"]');
            const whatsapp   = waLink ? waLink.href : '';

            const getLink = (kw) => { const a = document.querySelector(`a[href*="${kw}"]`); return a ? a.href : ''; };
            return {
                name, logo, background, whatsapp,
                carsUrl:    getLink('/sale/') || getLink('category=sale'),
                rentUrl:    getLink('/rent/'),
                numbersUrl: getLink('/vrp/') || getLink('/numbers/'),
                soldUrl:    getLink('/sold/'),
            };
        });

        details.logo       = fixUrl(details.logo);
        details.background = fixUrl(details.background);

        // ── Фото авто ──────────────────────────────────────────────────────
        const carImages = await showroomPage.evaluate((limit) => {
            let imgs = [];
            const cards = document.querySelectorAll('.slick-slide, div[class*="PublishedAdvertCard"], div[class*="AdvertCard"]');
            for (const card of cards) {
                const img = card.querySelector('picture img, img[src]:not([src^="data"])');
                if (img && img.src && !img.src.startsWith('data:')) imgs.push(img.src);
            }
            if (imgs.length === 0) {
                // Fallback: все img шире 200px
                document.querySelectorAll('img').forEach(img => {
                    if (img.width > 200 && img.src && !img.src.startsWith('data:')
                        && !img.src.includes('avatar') && !img.src.includes('s:72'))
                        imgs.push(img.src);
                });
            }
            return [...new Set(imgs)].slice(0, limit);
        }, PHOTOS_LIMIT);

        console.log(`   ${details.name} | лого:${!!details.logo} баннер:${!!details.background} фото:${carImages.length}`);

        // ── Скачать логотип ────────────────────────────────────────────────
        let logoLocal = '';
        if (details.logo) {
            let logoUrl = details.logo;
            const pm = logoUrl.match(/plain\/(https?:\/\/.+)/);
            if (pm) logoUrl = decodeURIComponent(pm[1]);
            const r = await downloadImage(logoUrl, path.join(dir, 'logo.EXT'), showroomPage);
            if (r) logoLocal = `data/${safeName}/logo.${r.ext}`;
        }
        // fallback лого
        if (!logoLocal) {
            const existing = fs.readdirSync(dir).find(f => /^logo\./i.test(f));
            if (existing) logoLocal = `data/${safeName}/${existing}`;
        }

        // ── Скачать баннер ─────────────────────────────────────────────────
        let bgLocal = '';
        if (details.background) {
            let bgUrl = details.background;
            const pm = bgUrl.match(/plain\/(https?:\/\/.+)/);
            if (pm) bgUrl = decodeURIComponent(pm[1]);
            const r = await downloadImage(bgUrl, path.join(dir, 'banner.EXT'), showroomPage);
            if (r) bgLocal = `data/${safeName}/banner.${r.ext}`;
        }

        // ── Скачать фото авто ──────────────────────────────────────────────
        const downloadedImages = [];
        // Не перезаписываем уже скачанные
        const existingPhotos = fs.readdirSync(dir).filter(f => /^car_/i.test(f));
        if (existingPhotos.length >= carImages.length && existingPhotos.length > 0) {
            existingPhotos.forEach(f => downloadedImages.push(`data/${safeName}/${f}`));
            console.log(`    Фото: уже есть ${existingPhotos.length} шт, пропускаем`);
        } else {
            for (let j = 0; j < carImages.length; j++) {
                let imgUrl = fixUrl(carImages[j]);
                const pm = imgUrl.match(/plain\/(https?:\/\/.+)/);
                if (pm) imgUrl = decodeURIComponent(pm[1]);
                const r = await downloadImage(imgUrl, path.join(dir, `car_${j+1}.EXT`), showroomPage);
                if (r) downloadedImages.push(`data/${safeName}/car_${j+1}.${r.ext}`);
            }
            console.log(`    Фото: скачано ${downloadedImages.length}`);
        }

        await showroomPage.close().catch(() => {});

        // ── Обновить JSON ──────────────────────────────────────────────────
        const idx = showrooms.findIndex(s => s.safe_name === safeName || s.profile_url === showroomUrl);
        const entry = {
            name:           details.name,
            profile_url:    showroomUrl,
            cars_url:       details.carsUrl    || '',
            rent_url:       details.rentUrl    || '',
            numbers_url:    details.numbersUrl || '',
            sold_url:       details.soldUrl    || '',
            whatsapp:       details.whatsapp   || '',
            logo_url:       details.logo       || '',
            background_url: details.background || '',
            safe_name:      safeName,
            images_local:   downloadedImages,
            logo_local:     logoLocal || downloadedImages[0] || '',
            background_local: bgLocal || downloadedImages[0] || '',
        };
        if (idx !== -1) showrooms[idx] = { ...showrooms[idx], ...entry };
        else            showrooms.push(entry);

        return true;
    } catch (e) {
        console.log(`    [!] ОШИБКА: ${e.message.slice(0, 100)}`);
        try { if (showroomPage && !showroomPage.isClosed()) await showroomPage.close(); } catch(_) {}
        return false;
    }
}

// ─── Получить все ссылки со страницы списка ────────────────────────────────
async function fetchPageLinks(browser, pageNum) {
    let page;
    try {
        page = await browser.newPage();
        const url = `${LIST_URL}?page=${pageNum}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(2000);

        const links = await page.evaluate(() => {
            const els = document.querySelectorAll('a[class*="ShowroomItem_link"]');
            return [...new Set(Array.from(els).map(el => el.href))];
        });

        await page.close().catch(() => {});
        return links;
    } catch (e) {
        console.log(`  [!] Страница ${pageNum} ошибка: ${e.message.slice(0, 80)}`);
        try { if (page && !page.isClosed()) await page.close(); } catch(_) {}
        return [];
    }
}

// ─── ГЛАВНЫЙ ЦИКЛ ──────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
    let showrooms = fs.existsSync(dataPath)
        ? JSON.parse(fs.readFileSync(dataPath, 'utf-8'))
        : [];

    console.log(`=== ДОСБОР ПРОПУЩЕННЫХ ШОУРУМОВ ===`);
    console.log(`Записей в JSON: ${showrooms.length}`);

    // ── ШАГ 1: собрать все URL со всех страниц списка ─────────────────────
    console.log(`\n[ШАГ 1] Сбор URL шоурумов со страниц...`);
    let browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
               '--disable-gpu', '--no-first-run'],
        defaultViewport: { width: 1280, height: 800 }
    });

    const allUrls = new Set();
    let emptyPages = 0;
    for (let p = 1; p <= 60; p++) {
        process.stdout.write(`  Страница ${p}... `);
        const links = await fetchPageLinks(browser, p);
        if (links.length === 0) {
            emptyPages++;
            console.log(`пусто (${emptyPages} подряд)`);
            if (emptyPages >= 3) { console.log('  Конец списка.'); break; }
            continue;
        }
        emptyPages = 0;
        links.forEach(l => allUrls.add(l));
        console.log(`${links.length} шоурумов (итого: ${allUrls.size})`);
        await sleep(800);
    }

    console.log(`\nВсего URL на сайте: ${allUrls.size}`);

    // ── ШАГ 2: найти недостающие ──────────────────────────────────────────
    const knownUrls = new Set(showrooms.map(s => s.profile_url));
    const knownNames = new Set(showrooms.map(s => s.safe_name));

    const missing = [];
    for (const url of allUrls) {
        const sn = url.replace(/\/$/, '').split('/').pop();
        // Нет в JSON ИЛИ нет папки с файлами
        if (!knownUrls.has(url) && !knownNames.has(sn)) {
            missing.push(url);
        } else if (!folderIsComplete(sn)) {
            missing.push(url);
        }
    }

    console.log(`\nПропущенных / неполных: ${missing.length}`);
    if (missing.length === 0) {
        console.log('✅ Всё уже собрано!');
        await browser.close();
        return;
    }

    missing.slice(0, 20).forEach(u => console.log(`  - ${u}`));
    if (missing.length > 20) console.log(`  ...и ещё ${missing.length - 20}`);

    // ── ШАГ 3: обработать недостающие ────────────────────────────────────
    console.log(`\n[ШАГ 3] Обработка ${missing.length} шоурумов...`);
    let done = 0, failed = 0;

    for (let i = 0; i < missing.length; i++) {
        const url = missing[i];
        const sn  = url.replace(/\/$/, '').split('/').pop();
        console.log(`\n[${i + 1}/${missing.length}] ${sn}`);

        // Перезапуск браузера периодически
        if (i > 0 && i % RESTART_EVERY === 0) {
            console.log('  [♻] Перезапуск браузера...');
            try { await browser.close(); } catch(_) {}
            await sleep(1500);
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                defaultViewport: { width: 1280, height: 800 }
            });
        }

        // Проверка живости
        try { await browser.version(); }
        catch {
            console.log('  [!] Браузер упал → перезапуск...');
            try {
                browser = await puppeteer.launch({
                    headless: 'new',
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                    defaultViewport: { width: 1280, height: 800 }
                });
            } catch (e) { console.log(`  [ФАТАЛ] ${e.message}`); failed++; continue; }
        }

        const ok = await processShowroom(url, browser, showrooms);
        if (ok) done++; else failed++;

        // Сохраняем JSON каждые 5 шоурумов
        if (i % 5 === 0 || i === missing.length - 1) {
            fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
            console.log(`  💾 JSON сохранён (${showrooms.length} записей)`);
        }

        await sleep(DELAY_MS);
    }

    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
    try { await browser.close(); } catch(_) {}

    console.log(`\n=== ГОТОВО ===`);
    console.log(`✅ Обработано: ${done}`);
    console.log(`❌ Ошибки:     ${failed}`);
    console.log(`📄 Итого в JSON: ${showrooms.length}`);
}

run().catch(e => {
    console.error('КРИТИЧЕСКАЯ ОШИБКА:', e.message);
    process.exit(1);
});
