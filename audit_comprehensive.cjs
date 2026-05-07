const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data', 'showrooms_data.json');
const dataDir = path.join(__dirname, 'data');

async function runAudit() {
    console.log('--- 🔎 ГЛУБОКИЙ АУДИТ ДАННЫХ v1.0 ---\n');

    if (!fs.existsSync(dataPath)) {
        console.error('❌ Ошибка: Файл showrooms_data.json не найден!');
        return;
    }

    const database = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const total = database.length;
    
    let stats = {
        ready: 0,
        missingLogo: 0,
        missingBanner: 0,
        missingLinks: 0,
        missingWhatsapp: 0
    };

    const missingLogosList = [];
    const missingLinksList = [];

    database.forEach((sr, index) => {
        let isReady = true;
        const srPath = path.join(dataDir, sr.safe_name);
        
        // 1. Проверка логотипа
        const logoPath = path.join(srPath, 'logo.jpg');
        if (!fs.existsSync(logoPath)) {
            stats.missingLogo++;
            isReady = false;
            missingLogosList.push(sr.name || sr.safe_name);
        }

        // 2. Проверка баннера
        if (!sr.images_local || sr.images_local.length === 0) {
            stats.missingBanner++;
            isReady = false;
        }

        // 3. Проверка ссылок (ТЗ 5.0)
        const mandatoryLinks = ['profile_url', 'cars_url', 'rent_url', 'numbers_url', 'sold_url'];
        const missing = mandatoryLinks.filter(key => !sr[key] || sr[key] === "");
        if (missing.length > 0) {
            stats.missingLinks++;
            isReady = false;
            missingLinksList.push(`${sr.safe_name} (нет: ${missing.join(', ')})`);
        }

        // 4. Проверка WhatsApp
        if (!sr.whatsapp || sr.whatsapp === "") {
            stats.missingWhatsapp++;
        }

        if (isReady) stats.ready++;
    });

    console.log(`📊 ИТОГО СТАТИСТИКА:`);
    console.log(`   - Всего шоурумов:      ${total}`);
    console.log(`   - ПОЛНОСТЬЮ ГОТОВЫ:     ${stats.ready} (${((stats.ready/total)*100).toFixed(1)}%)`);
    console.log(`   - Нет логотипа:         ${stats.missingLogo}`);
    console.log(`   - Нет фото для баннера: ${stats.missingBanner}`);
    console.log(`   - Ошибки в ссылках:     ${stats.missingLinks}`);
    console.log(`   - Нет WhatsApp:         ${stats.missingWhatsapp}`);

    if (missingLogosList.length > 0) {
        console.log('\n⚠️ ПРИМЕРЫ БЕЗ ЛОГОТИПОВ:');
        console.log(missingLogosList.slice(0, 10).join(', ') + (missingLogosList.length > 10 ? '...' : ''));
    }

    if (missingLinksList.length > 0) {
        console.log('\n⚠️ ОШИБКИ ССЫЛОК (ТЗ 5.0):');
        console.log(missingLinksList.slice(0, 5).join('\n') + (missingLinksList.length > 5 ? '\n...' : ''));
        console.log('\n💡 СОВЕТ: Если у шоурума есть profile_url, но нет остальных, запустите `node fix_links.js`');
    }

    console.log('\n--- АУДИТ ЗАВЕРШЕН ---');
}

runAudit();
