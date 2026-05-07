/**
 * audit_final.js
 * Финальная сверка: База JSON vs Папки с данными.
 */

import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const dataDir = path.join(process.cwd(), 'data');

function runAudit() {
    console.log('--- 🛡️ ФИНАЛЬНЫЙ АУДИТ БАЗЫ ДАННЫХ ---');
    
    if (!fs.existsSync(dataPath)) {
        console.error('❌ Ошибка: Файл showrooms_data.json не найден!');
        return;
    }

    const database = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    const jsonCount = database.length;
    
    const folders = fs.readdirSync(dataDir).filter(f => {
        return fs.statSync(path.join(dataDir, f)).isDirectory() && f !== 'backups' && f !== 'errors';
    });
    const folderCount = folders.length;

    console.log(`\n📊 Статистика:`);
    console.log(`   - Записей в JSON:  ${jsonCount}`);
    console.log(`   - Папок в /data/:   ${folderCount}`);

    const jsonSafeNames = new Set(database.map(s => s.safe_name));
    const folderNames = new Set(folders);

    const missingFolders = database.filter(s => !folderNames.has(s.safe_name)).map(s => s.safe_name);
    const extraFolders = folders.filter(f => !jsonSafeNames.has(f));

    if (missingFolders.length > 0) {
        console.log(`\n⚠️ ВНИМАНИЕ: У ${missingFolders.length} шоурумов из базы НЕТ папок с данными!`);
        console.log(`   Примеры: ${missingFolders.slice(0, 5).join(', ')}...`);
    } else {
        console.log('\n✅ Все шоурумы из базы имеют соответствующие папки.');
    }

    if (extraFolders.length > 0) {
        console.log(`\nℹ️ В папке /data/ есть ${extraFolders.length} лишних папок (не в базе).`);
    }

    const noLinks = database.filter(s => !s.profile_url);
    if (noLinks.length > 0) {
        console.log(`\n❌ Критическая ошибка: У ${noLinks.length} записей НЕТ profile_url!`);
    }

    console.log('\n--- АУДИТ ЗАВЕРШЕН ---');
}

runAudit();
