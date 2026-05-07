import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

puppeteer.use(StealthPlugin());

// Читаем конфиг для капчи
const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf-8'));
if (config.anticaptcha && config.anticaptcha.apiKey) {
    puppeteer.use(
        RecaptchaPlugin({
            provider: { id: '2captcha', apiKey: config.anticaptcha.apiKey }, 
            visualFeedback: true
        })
    );
}

// Режим работы: false - полный список (~600+), true - тестовый (3 шт)
const TEST_MODE = false;
const BASE_URL = 'https://auto.ae';
const SHOWROOMS_LIST_URL = 'https://auto.ae/ru/showrooms/all/';

// НАСТРОЙКИ СТРАНИЦ ДЛЯ ДОКАЧКИ
let START_PAGE = 1;  // С какой страницы начать
let MAX_PAGES = 55;  // По какую страницу собирать

const progressPath = path.join(process.cwd(), 'data', 'progress.json');

// Загружаем прогресс из файла, если он есть
if (fs.existsSync(progressPath)) {
    try {
        const progress = JSON.parse(fs.readFileSync(progressPath, 'utf-8'));
        if (progress.last_page) {
            START_PAGE = progress.last_page + 1;
            console.log(`>>> Прогресс найден! Начинаем со страницы: ${START_PAGE}`);
        }
    } catch (e) {
        console.log('>>> Ошибка чтения файла прогресса, начинаем сначала.');
    }
}

// Читаем аргументы командной строки (пример: node 1_parser.js 15) - ПРИОРИТЕТ ВЫШЕ
const argPage = process.argv.slice(2).find(a => !isNaN(a));
if (argPage) {
    START_PAGE = parseInt(argPage);
    console.log(`>>> ПРИНУДИТЕЛЬНО: стартовая страница из аргументов: ${START_PAGE}`);
}

const MAX_TEST_ITEMS = 3;
const PHOTOS_LIMIT = 0; // Отключено загрузку фоток, как просил пользователь
const PROXY_URL = null; // Отключено по просьбе пользователя

let proxiesList = [];

// Утилита для автоскролла страницы (для infinite loading)
async function autoScroll(page, maxScrolls = 100) {
    await page.evaluate(async (maxSc) => {
        await new Promise((resolve) => {
            let distance = 800;
            let scrolls = 0;
            
            let timer = setInterval(() => {
                window.scrollBy(0, distance);
                scrolls++;

                // Если достигли лимита или высота не меняется слишком долго
                if (scrolls >= maxSc) {
                    clearInterval(timer);
                    resolve();
                }
            }, 800); 
        });
    }, maxScrolls);
    
    await new Promise(r => setTimeout(r, 4000));
}

/**
 * Чтение существующего JSON для докачки
 */
function loadExistingData(filePath) {
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

// Утилита для скачивания изображения (Google Cloud обходит CORS, auto.ae идет через браузер)
async function downloadImage(url, filepathTemplate, page) {
    if (!url || !url.startsWith('http')) return null;
    try {
        let buffer;
        let ext = 'jpg';

        if (url.includes('googleapis.com')) {
            const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
            buffer = Buffer.from(res.data, 'binary');

            const contentType = res.headers['content-type'] || '';
            if (contentType.includes('png')) ext = 'png';
            else if (contentType.includes('webp')) ext = 'webp';
            else if (contentType.includes('jpeg') || contentType.includes('jpg')) ext = 'jpg';
        } else {
            const resultPayload = await page.evaluate(async (imgUrl) => {
                try {
                    const res = await fetch(imgUrl);
                    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
                    const blob = await res.blob();

                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            let typeExt = 'jpg';
                            if (blob.type.includes('png')) typeExt = 'png';
                            else if (blob.type.includes('webp')) typeExt = 'webp';
                            resolve({ type: 'base64', data: reader.result, ext: typeExt });
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch (err) {
                    return { type: 'error', message: err.message };
                }
            }, url);

            if (resultPayload.type === 'error') throw new Error(resultPayload.message);
            ext = resultPayload.ext || 'jpg';
            const dataBase64 = resultPayload.data.replace(/^data:image\/\w+;base64,/, '');
            buffer = Buffer.from(dataBase64, 'base64');
        }

        const finalFilepath = filepathTemplate.replace('.EXT', '.' + ext);
        fs.writeFileSync(finalFilepath, buffer);
        return { path: finalFilepath, ext: ext };
    } catch (e) {
        console.log(`[Ошибка скачивания фото] ${url}: ${e.message}`);
        return null;
    }
}

function fixUrl(url) {
    if (!url) return url;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('/')) return BASE_URL + url;
    return url;
}

async function loadProxies() {
    if (PROXY_URL) {
        try {
            console.log('Скачиваем прокси по ссылке...');
            const res = await axios.get(PROXY_URL);
            let raw = res.data;
            if (typeof raw !== 'string') raw = JSON.stringify(raw);
            proxiesList = raw.split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 5 && !l.startsWith('//'));
            console.log(`Загружено ${proxiesList.length} прокси по ссылке.`);
        } catch (e) {
            console.log(`Ошибка скачивания прокси (${e.message}). Пробуем прочитать из файла...`);
        }
    }

    if (proxiesList.length === 0) {
        const proxiesPath = path.join(process.cwd(), 'proxies.txt');
        if (fs.existsSync(proxiesPath)) {
            proxiesList = fs.readFileSync(proxiesPath, 'utf-8')
                .split('\n')
                .map(l => l.trim())
                .filter(l => l.length > 5 && !l.startsWith('//'));
            console.log(`Загружено ${proxiesList.length} прокси из локального файла.`);
        }
    }
}

function getRandomProxy() {
    if (proxiesList.length === 0) return null;
    const rnd = proxiesList[Math.floor(Math.random() * proxiesList.length)];
    const pts = rnd.split(':');
    if (pts.length === 4) return { ip: pts[0], port: pts[1], user: pts[2], pass: pts[3] };
    if (pts.length === 2) return { ip: pts[0], port: pts[1] };
    return null;
}

/**
 * Вспомогательная функция для запуска браузера (аналогично боту)
 */
async function launchNewBrowser() {
    const proxy = getRandomProxy();
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1280,800',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--mute-audio',
        '--no-first-run',
        '--js-flags=--max-old-space-size=512'
    ];
    if (proxy) args.push(`--proxy-server=${proxy.ip}:${proxy.port}`);

    console.log(`[БРАУЗЕР] Запуск инстанса... ${proxy ? `(Proxy: ${proxy.ip})` : '(No proxy)'}`);
    const browser = await puppeteer.launch({ 
        headless: 'new',   // <-- возвращено в фоновый режим
        args, 
        defaultViewport: { width: 1280, height: 800 }
    });

    return { browser, proxy };
}

/**
 * RUN
 */
async function run() {
    await loadProxies();
    let browserContext = null;

    console.log('=== ЗАПУСК ПАРСЕРА AUTO.AE (ОПТИМИЗИРОВАННЫЙ) ===');
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

    const dataPath = path.join(dataDir, 'showrooms_data.json');
    let showrooms = loadExistingData(dataPath);
    console.log(`Уже собрано в базе: ${showrooms.length} записей.`);
    
    const maxPagesToScrape = TEST_MODE ? 1 : MAX_PAGES;
    let totalProcessed = 0;

    for (let pageNum = START_PAGE; pageNum <= maxPagesToScrape; pageNum++) {
        const pageUrl = pageNum === 1 ? SHOWROOMS_LIST_URL : `${SHOWROOMS_LIST_URL}?page=${pageNum}`;
        console.log(`\n--- СТРАНИЦА ${pageNum}/${maxPagesToScrape} ---`);
        
        let pageSuccess = false;
        let pageAttempts = 0;

        while (!pageSuccess && pageAttempts < 5) {
            pageAttempts++;

            // Проверка жизни браузера или его запуск
            if (!browserContext) {
                browserContext = await launchNewBrowser();
            } else {
                try {
                    await browserContext.browser.version();
                } catch (e) {
                    console.log('⚠️ Браузер упал. Перезапуск...');
                    browserContext = await launchNewBrowser();
                }
            }

            let page = null;
            try {
                page = await browserContext.browser.newPage();
                if (browserContext.proxy?.user) {
                    await page.authenticate({ 
                        username: browserContext.proxy.user, 
                        password: browserContext.proxy.pass 
                    });
                }

                console.log(`Переход на список: ${pageUrl} (Попытка ${pageAttempts})...`);
                await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                
                await page.waitForSelector('a[class*="ShowroomItem_link"]', { timeout: 30000 });
                await page.solveRecaptchas();
                
                const pageLinks = await page.evaluate(() => {
                    const elements = document.querySelectorAll('a[class*="ShowroomItem_link"]');
                    return [...new Set(Array.from(elements).map(el => el.href))];
                });
                
                console.log(`Найдено шоурумов на странице: ${pageLinks.length}`);
                
                for (let i = 0; i < pageLinks.length; i++) {
                    const showroomUrl = pageLinks[i];
                    totalProcessed++;
                    
                    const urlSafeName = showroomUrl.split('/').filter(Boolean).pop();
                    const exists = showrooms.find(s => s.safe_name === urlSafeName || s.profile_url === showroomUrl);
                    const showroomDir = path.join(dataDir, urlSafeName || 'unknown');

                    // НОВОЕ: Режим «Только Контакты» - если папка уже есть
                    const skipPhotos = fs.existsSync(showroomDir) && (fs.readdirSync(showroomDir).length >= 5);
                    if (skipPhotos) {
                        console.log(`[${totalProcessed}] [Turbo] ${urlSafeName} (собираем только контакты)`);
                    }

                    console.log(`\n[${totalProcessed}] Обработка: ${showroomUrl}`);
                    
                    try {
                        const showroomPage = await browserContext.browser.newPage();
                        if (browserContext.proxy?.user) {
                            await showroomPage.authenticate({ 
                                username: browserContext.proxy.user, 
                                password: browserContext.proxy.pass 
                            });
                        }

                        // Переходим и ждем только загрузки DOM
                        await showroomPage.goto(showroomUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                        
                        const details = await showroomPage.evaluate(() => {
                            const name = document.querySelector('h1')?.innerText?.trim() || 'Unknown';
                            const logoImg = document.querySelector('div[class*="Avatar_avatar"] img');
                            const bannerImg = document.querySelector('div[class*="Banner_banner"] img');
                            const logo = logoImg ? logoImg.src : '';
                            const background = bannerImg ? bannerImg.src : '';
                            const waLink = document.querySelector('a[href*="wa.me"], a[href*="whatsapp.com"]');
                            const whatsapp = waLink ? waLink.href : '';

                            return { name, logo, background, whatsapp };
                        });

                        details.url = showroomUrl;
                        details.logo = fixUrl(details.logo);
                        details.background = ''; // Игнорируем баннеры по просьбе пользователя

                        const finalShowroomDir = path.join(dataDir, urlSafeName);
                        if (!fs.existsSync(finalShowroomDir)) fs.mkdirSync(finalShowroomDir, { recursive: true });

                        let logoLocalPath = '';
                        if (details.logo) {
                            // Игнорируем скачивание фото машин, скачиваем ТОЛЬКО логотип
                            const logoRes = await downloadImage(details.logo, path.join(finalShowroomDir, 'logo.EXT'), showroomPage);
                            if (logoRes) {
                                logoLocalPath = `data/${urlSafeName}/logo.${logoRes.ext}`;
                                console.log(`   [ЛОГО] Скачано: ${logoLocalPath}`);
                            }
                        }
                        
                        console.log(`   Showroom: ${details.name}`);

                        const base = showroomUrl.endsWith('/') ? showroomUrl : showroomUrl + '/';
                        const showroomEntry = {
                            name: details.name,
                            profile_url: showroomUrl,
                            cars_url: `${base}sale/`,
                            rent_url: `${base}rent/`,
                            numbers_url: `${base}sale/vrp/`,
                            sold_url: `${base}sale/sold/`,
                            whatsapp: details.whatsapp,
                            logo_url: details.logo,
                            logo_local: logoLocalPath,
                            background_url: '',
                            safe_name: urlSafeName,
                            images_local: []
                        };

                        const existingShowroomIndex = showrooms.findIndex(s => s.profile_url === showroomUrl);
                        if (existingShowroomIndex !== -1) {
                            showrooms[existingShowroomIndex] = showroomEntry;
                        } else {
                            showrooms.push(showroomEntry);
                        }

                        fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
                        await showroomPage.close().catch(() => {});
                    } catch (err) {
                        console.error(`   [!] Ошибка в ${showroomUrl}: ${err.message}`);
                    }
                }
                
                pageSuccess = true;
                // Сохраняем прогресс после успешного завершения страницы
                fs.writeFileSync(progressPath, JSON.stringify({ last_page: pageNum, timestamp: new Date().toISOString() }, null, 2));
                console.log(`[ПРОГРЕСС] Страница ${pageNum} сохранена в лог.`);
            } catch (err) {
                console.log(`⚠️ Ошибка на странице ${pageNum} (попытка ${pageAttempts}): ${err.message}`);
                // В случае ошибки на странице - перезапустим браузер в следующей попытке
                if (browserContext) await browserContext.browser.close().catch(() => {});
                browserContext = null;
                await new Promise(r => setTimeout(r, 4000));
            } finally {
                if (page) await page.close().catch(() => { });
            }
        }
    }

    console.log(`\n[Готово] Сбор данных завершен.`);
    if (browserContext) await browserContext.browser.close().catch(() => {});
}

run();
