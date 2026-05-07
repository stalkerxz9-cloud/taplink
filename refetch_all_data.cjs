const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

puppeteer.use(StealthPlugin());

const dataPath = path.join(__dirname, 'data', 'showrooms_data.json');
const dataDir = path.join(__dirname, 'data');
const proxiesPath = path.join(__dirname, 'proxies.txt');

let proxiesList = [];

function loadProxies() {
    if (fs.existsSync(proxiesPath)) {
        proxiesList = fs.readFileSync(proxiesPath, 'utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l.length > 5 && !l.startsWith('//'));
        console.log(`Загружено прокси: ${proxiesList.length}`);
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

// Настройки
const CONCURRENCY = 1; // Установил 1 для идеального порядка в консоли
const REFETCH_ALL_CONTACTS = true; 
const DOWNLOAD_LOGOS = true;
const USE_PROXY = false; 
const SHOW_BROWSER = false; // Отключил видимый режим по просьбе пользователя

async function downloadImage(url, filepathTemplate) {
    if (!url || !url.startsWith('http')) return null;
    try {
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
        const buffer = Buffer.from(res.data, 'binary');
        let ext = 'jpg';
        const contentType = res.headers['content-type'] || '';
        if (contentType.includes('png')) ext = 'png';
        else if (contentType.includes('webp')) ext = 'webp';
        
        const finalFilepath = filepathTemplate.replace('.EXT', '.' + ext);
        fs.writeFileSync(finalFilepath, buffer);
        return ext;
    } catch (e) {
        return null;
    }
}

// ГЕНЕРАТОР АНГЛИЙСКИХ ОПИСАНИЙ (Bio)
function generateEnglishBio(name, keywords = '') {
    const templates = [
        `${name} is a premier automotive destination in Dubai, offering a curated selection of high-quality vehicles and exceptional customer service.`,
        `Experience excellence with ${name}. We provide a diverse range of premium vehicles in Dubai, ensuring reliability and a seamless car buying experience.`,
        `Dedicated to automotive excellence, ${name} offers top-tier vehicles and professional guidance for every customer in the UAE.`,
        `${name} specializes in bringing you the finest selection of cars in Dubai, combining competitive pricing with uncompromised quality.`
    ];

    // Специальные шаблоны для аренды
    if (keywords.toLowerCase().includes('rent')) {
        return `${name} is a leading car rental service in Dubai, providing a wide fleet of luxury and exotic vehicles for an unforgettable driving experience.`;
    }
    
    // Специальные шаблоны для Luxury
    if (keywords.toLowerCase().includes('luxury') || keywords.toLowerCase().includes('premium')) {
        return `${name} offers an exclusive collection of luxury and high-performance vehicles in Dubai, catering to the most discerning automotive enthusiasts.`;
    }

    return templates[Math.floor(Math.random() * templates.length)];
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    console.log('--- 🚀 REFETCH ALL DATA: CONTACTS & LOGOS (WITH PROXIES) ---');
    loadProxies();
    
    if (!fs.existsSync(dataPath)) {
        console.error('База данных не найдена!');
        return;
    }

    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    console.log(`Всего в базе: ${showrooms.length} объектов.`);

    const proxy = USE_PROXY ? getRandomProxy() : null;
    const args = ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'];
    if (proxy) args.push(`--proxy-server=${proxy.ip}:${proxy.port}`);

    const browser = await puppeteer.launch({
        headless: !SHOW_BROWSER,
        args
    });

    const workQueue = [...showrooms];
    let processed = 0;

    async function worker() {
        while (workQueue.length > 0) {
            const sr = workQueue.shift();
            const index = showrooms.indexOf(sr);
            if (!sr.profile_url) continue;
            
            // Включаем краткий индикатор начала
            process.stdout.write(`[${index + 1}/${showrooms.length}] ⏳ ${sr.name.substring(0, 30)}...`);
            
            const page = await browser.newPage();
            if (proxy && proxy.user) {
                await page.authenticate({ username: proxy.user, password: proxy.pass });
            }
            try {
                // Ждем более полной загрузки (увеличил таймаут до 90 сек)
                await page.goto(sr.profile_url, { waitUntil: 'networkidle2', timeout: 90000 });
                await new Promise(r => setTimeout(r, 4000)); 

                // НОВОЕ: Проверка на Cloudflare
                const isBlocked = await page.evaluate(() => {
                    return document.body.innerText.includes('Один момент') || document.body.innerText.includes('Just a moment');
                });
                if (isBlocked) {
                    console.log('   ⚠️ Обнаружен Cloudflare! Ждем 15 секунд...');
                    await new Promise(r => setTimeout(r, 15000));
                }

                // Пытаемся открыть модальное окно контактов
                const btnFound = await page.evaluate(() => {
                    const selectors = [
                        'button[class*="Button_button_secondary"]',
                        'div[class*="Header_actions"] button',
                        'button[class*="ShowroomContact"]',
                        'button:has(svg[class*="phone"])',
                        'button:has(svg[class*="Phone"])'
                    ];
                    
                    for (let s of selectors) {
                        try {
                            const btn = document.querySelector(s);
                            if (btn && btn.click) {
                                btn.click();
                                return true;
                            }
                        } catch(e) {}
                    }
                    return false;
                });

                if (btnFound) {
                    await sleep(3000);
                }

                // 1. Извлекаем данные (Глубокий поиск)
                const details = await page.evaluate(() => {
                    const results = { whatsapp: '', logo_url: '', bio: '', socials: { instagram: '', facebook: '', tiktok: '' }, name: '', keywords: '' };
                    
                    // Собираем ключевые слова для генератора
                    results.keywords = document.body.innerText.substring(0, 3000);

                    // 0) Пытаемся забрать имя
                    const nameEl = document.querySelector('h1, [class*="Showroom_name"]');
                    if (nameEl) results.name = nameEl.innerText.trim();

                    // А) Поиск ссылок WhatsApp
                    const waLinks = Array.from(document.querySelectorAll('a'))
                        .filter(a => {
                            if (!a.href) return false;
                            const h = a.href.toLowerCase();
                            return h.includes('wa.me') || h.includes('whatsapp.com') || h.includes('api.whatsapp');
                        })
                        .map(a => a.href.split('?')[0].replace(/\D/g, ''))
                        .filter(num => num.length >= 10);
                    
                    if (waLinks.length > 0) results.whatsapp = `https://wa.me/${waLinks[0]}`;

                    // Б) Поиск через tel: ссылки (СТРОГО ПО СКРИНШОТУ: классы и атрибуты)
                    if (!results.whatsapp) {
                        // Ищем по специфическому классу со скрина и атрибуту tel:
                        const telLinks = Array.from(document.querySelectorAll('a[class*="ContactModal_phone__link"], a[href^="tel:"]'))
                            .map(a => a.href.replace(/\D/g, ''))
                            .filter(num => num.length >= 10);
                        if (telLinks.length > 0) results.whatsapp = `https://wa.me/${telLinks[0]}`;
                    }
                    
                    // В) Поиск в специальном контейнере (ContactModal_phone) или просто текст номера
                    if (!results.whatsapp) {
                        const modalPhone = document.querySelector('[class*="ContactModal_phone"], [class*="phone"], [class*="Phone"]');
                        if (modalPhone) {
                            const clean = modalPhone.innerText.replace(/\D/g, '');
                            if (clean.length >= 10) {
                                // Превращаем в WhatsApp ссылку (ОАЭ код 971 если нет другого)
                                const waBase = clean.startsWith('971') ? clean : '971' + clean.replace(/^0+/, '');
                                results.whatsapp = `https://wa.me/${waBase}`;
                            }
                        }
                    }

                    // Г) Поиск BIO (Описания)
                    const bioEl = document.querySelector('[class*="Showroom_description"], [class*="description"]');
                    results.bio = bioEl ? bioEl.innerText.trim() : '';

                    // Е) Поиск соцсетей (Игнорируем подвал Auto.ae)
                    const links = Array.from(document.querySelectorAll('a[href*="instagram.com"], a[href*="facebook.com"], a[href*="tiktok.com"]'));
                    links.forEach(a => {
                        const h = a.href.toLowerCase();
                        if (h.includes('auto.ae')) return;
                        if (h.includes('instagram.com')) results.socials.instagram = a.href;
                        if (h.includes('facebook.com')) results.socials.facebook = a.href;
                        if (h.includes('tiktok.com')) results.socials.tiktok = a.href;
                    });

                    // Ж) Поиск логотипа
                    const logoImg = document.querySelector('div[class*="Avatar_avatar"] img, img[alt*="logo"], .showroom-logo img');
                    results.logo_url = logoImg ? logoImg.src : '';
                    
                    return results;
                });
                
                // 2. БЛОК ГЕНЕРАЦИИ BIO (Если его нет или он на русском)
                const isRussian = /[а-яА-Я]/.test(details.bio);
                if (!details.bio || isRussian) {
                    sr.bio = generateEnglishBio(sr.name || details.name || 'This showroom', details.keywords);
                } else {
                    sr.bio = details.bio;
                }

                // ФОРМИРУЕМ ОДНУ КРАСИВУЮ СТРОКУ РЕЗУЛЬТАТА
                const bioStatus = details.bio && !isRussian ? 'Real' : 'Gen';
                const waSt = sr.whatsapp ? 'WA: OK' : 'WA: --';
                
                process.stdout.write('\r' + ''.padEnd(70) + '\r'); 
                console.log(`[${index + 1}/${showrooms.length}] 🚗 ${sr.name.padEnd(25)} | Bio: ${bioStatus} | ${waSt} | ✅ ГОТОВО`);

                // Дозабираем логотип отдельно если через evaluate не вышло
                if (!details.logo_url) {
                    details.logo_url = await page.evaluate(() => {
                         const img = document.querySelector('div[class*="Avatar_avatar"] img');
                         return img ? img.src : '';
                    });
                }

                // 2. Обновляем WhatsApp
                if (details.whatsapp) {
                    sr.whatsapp = details.whatsapp;
                }

                // 3. Обновляем Логотип
                if (details.logo_url) {
                    sr.logo_url = details.logo_url;
                    
                    const srFolder = path.join(dataDir, sr.safe_name);
                    if (!fs.existsSync(srFolder)) fs.mkdirSync(srFolder, { recursive: true });
                    
                    const localLogoPath = path.join(srFolder, 'logo.jpg');
                    // Скачиваем если файла нет или DOWNLOAD_LOGOS = true
                    if (!fs.existsSync(localLogoPath) || DOWNLOAD_LOGOS) {
                        const ext = await downloadImage(details.logo_url, path.join(srFolder, 'logo.EXT'));
                        if (ext) sr.logo_local = `data/${sr.safe_name}/logo.${ext}`;
                    }
                }

                // Сохраняем прогресс каждые 10 объектов
                if (processed % 10 === 0) {
                    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
                }
                
                processed++;
            } catch (err) {
                console.error(`   ❌ Ошибка: ${err.message}`);
            } finally {
                await page.close();
            }
        }
    }

    // Запускаем воркеров
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);

    // Финальное сохранение
    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2));
    console.log('\n--- ✅ ВСЕ ДАННЫЕ ОБНОВЛЕНЫ ---');
    await browser.close();
}

run();
