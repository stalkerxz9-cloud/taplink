/**
 * fix_links.js
 * Универсальный корректор ссылок. Превращает общие URL в персональные для каждого шоурума.
 */

import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const bkpDir = path.join(process.cwd(), 'data', 'backups');
const bkpPath = path.join(bkpDir, 'showrooms_data_PRE_FIX.json');

function run() {
    try {
        console.log('--- LINK ARCHITECT v1.0 ---');
        
        if (!fs.existsSync(dataPath)) {
            console.error('❌ Файл данных не найден!');
            return;
        }

        const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
        console.log(`📊 Загружено записей: ${data.length}`);

        // Бэкап
        if (!fs.existsSync(bkpDir)) fs.mkdirSync(bkpDir, { recursive: true });
        fs.copyFileSync(dataPath, bkpPath);
        console.log(`🛡️ Бэкап создан: ${path.basename(bkpPath)}`);

        // Обработка
        let fixedCount = 0;
        data.forEach(sr => {
            if (!sr.profile_url) return;

            let base = sr.profile_url;
            if (!base.endsWith('/')) base += '/';

            // Применяем строгую логику ТЗ (на базе profile_url)
            sr.cars_url = `${base}sale/`;
            sr.rent_url = `${base}rent/`;
            sr.numbers_url = `${base}sale/vrp/`;
            sr.sold_url = `${base}sale/sold/`;
            
            fixedCount++;
        });

        // Сохранение
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
        
        console.log('\n✅ ГОТОВО!');
        console.log(`🔗 Исправлено ссылок для ${fixedCount} шоурумов.`);
        console.log('---');
        
        // Пример для проверки
        const sample = data.find(s => s.name?.includes('4 Matic') || s.safe_name === '4maticmotors');
        if (sample) {
            console.log('📝 Пример (4 Matic Motors):');
            console.log(`   Showroom: ${sample.profile_url}`);
            console.log(`   Cars:     ${sample.cars_url}`);
            console.log(`   Rent:     ${sample.rent_url}`);
            console.log(`   Numbers:  ${sample.numbers_url}`);
            console.log(`   Sold:     ${sample.sold_url}`);
        }

    } catch (e) {
        console.error(`❌ Ошибка: ${e.message}`);
    }
}

run();
