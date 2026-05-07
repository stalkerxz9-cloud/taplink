const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const SHOW_BROWSER = true; 
const DATA_PATH = path.join(__dirname, 'data', 'showrooms_data.json');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    console.log("--- TEST RUN v2 (Correcting Fields) ---");
    if (!fs.existsSync(DATA_PATH)) {
        console.error("Database not found!");
        return;
    }

    const showrooms = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
    const browser = await puppeteer.launch({
        headless: !SHOW_BROWSER,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    for (let i = 0; i < 5; i++) {
        const sr = showrooms[i];
        const url = sr.profile_url || sr.url; // Пробуем оба варианта
        
        console.log(`\n[${i+1}/5] Тест для: ${sr.name || 'Unknown'}`);
        console.log(`   🔗 URL: ${url}`);

        if (!url) {
            console.log("   ⚠️ URL не найден, пропускаем.");
            continue;
        }

        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
            await sleep(2000);

            // Кликаем на контакты
            const btnFound = await page.evaluate(() => {
                const selectors = [
                    'button[class*="Contact_button"]',
                    'a[class*="Contact_button"]',
                    'button:has(svg)',
                    '.Showroom_name__container + div button'
                ];
                for (let s of selectors) {
                    try {
                        const btn = document.querySelector(s);
                        if (btn && btn.getClientRects().length > 0) { btn.click(); return true; }
                    } catch(e) {}
                }
                return false;
            });

            if (btnFound) {
                console.log('   🔘 Кнопка контактов нажата. Ждем 3 сек для модалки...');
                await sleep(3000);
            }

            const details = await page.evaluate(() => {
                const res = { whatsapp: '', bio: '', address: '', socials: { instagram: '', facebook: '', tiktok: '' } };
                
                // Bio
                const bio = document.querySelector('[class*="Showroom_description"], [class*="description"]');
                if (bio) res.bio = bio.innerText.trim();

                // Address
                const addr = document.querySelector('[class*="ContactModal_address"], [class*="address"]');
                if (addr) res.address = addr.innerText.trim();

                // WhatsApp
                const wa = Array.from(document.querySelectorAll('a[href*="wa.me"], a[href*="whatsapp.com"]'))
                    .map(a => a.href)[0];
                if (wa) res.whatsapp = wa;

                // Socials
                const links = Array.from(document.querySelectorAll('a[href*="instagram.com"], a[href*="facebook.com"]'));
                links.forEach(a => {
                    const h = a.href.toLowerCase();
                    if (h.includes('auto.ae')) return;
                    if (h.includes('instagram.com')) res.socials.instagram = a.href;
                    if (h.includes('facebook.com')) res.socials.facebook = a.href;
                });

                return res;
            });

            if (details.bio) console.log(`   ✅ BIO собрано (${details.bio.length} симв.)`);
            else console.log(`   ❌ BIO не найден`);

            if (details.address) console.log(`   📍 ADDRESS: ${details.address}`);
            else console.log(`   ❌ ADDRESS не найден`);

            if (details.whatsapp) console.log(`   📱 WhatsApp: ${details.whatsapp}`);
            
            if (Object.values(details.socials).some(v => v)) {
                console.log(`   📱 Соцсети найдены: ${Object.keys(details.socials).filter(k => details.socials[k]).join(', ')}`);
            }

            // Обновляем данные в БД
            sr.bio = details.bio || sr.bio;
            sr.address = details.address || sr.address;
            sr.whatsapp = details.whatsapp || sr.whatsapp;
            sr.socials = details.socials;

        } catch (e) {
            console.log(`   🛑 Ошибка: ${e.message}`);
        }
    }

    fs.writeFileSync(DATA_PATH, JSON.stringify(showrooms, null, 2));
    console.log("\n--- ТЕСТ ЗАВЕРШЕН (Данные обновлены) ---");
    await browser.close();
})();
