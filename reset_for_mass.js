import fs from 'fs';
import path from 'path';

const dataPath = 'data/showrooms_data.json';
const backupDir = 'data/backups';

// Список тех, кого НЕЛЬЗЯ трогать (safe_name или точное имя)
const KEEP_NAMES = ['PUPIL OF FATE MOTORS', 'DEIZ'];
const KEEP_SAFES = ['pupiloffatemotors', 'deiz_rental', 'qmotors'];

async function resetDatabase() {
    console.log('--- СТАРТ СБРОСА БАЗЫ ДЛЯ МАССОВОЙ ПЕРЕРЕГИСТРАЦИИ ---');

    if (!fs.existsSync(dataPath)) {
        console.error('Ошибка: файл базы не найден!');
        return;
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    
    // Бэкап перед сбросом
    const backupPath = path.join(backupDir, `showrooms_data_BEFORE_MASS_RESET_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`Создан бэкап: ${backupPath}`);

    let resetCount = 0;
    let keptCount = 0;

    const clearedData = data.map(sr => {
        const isKeep = KEEP_NAMES.includes(sr.name) || KEEP_SAFES.includes(sr.safe_name);
        
        if (isKeep) {
            keptCount++;
            return sr;
        }

        // Если это не исключение и аккаунт был тронут - сбрасываем
        if (sr.taplink_created || sr.taplink_designed || sr.taplink_published || sr.taplink_email) {
            resetCount++;
            return {
                ...sr,
                taplink_created: false,
                taplink_designed: false,
                taplink_published: false,
                taplink_email: "",
                taplink_pass: "",
                taplink_url: "",
                // Сохраняем все остальные поля (названия, ссылки auto.ae, локальные фото)
            };
        }

        return sr;
    });

    fs.writeFileSync(dataPath, JSON.stringify(clearedData, null, 2), 'utf-8');

    console.log(`\nИтог:`);
    console.log(`- Сохранено аккаунтов: ${keptCount}`);
    console.log(`- Сброшено аккаунтов:  ${resetCount}`);
    console.log(`- Всего в базе:        ${clearedData.length}`);
    console.log('\n[ГОТОВО] База очищена и готова к массовому запуску.');
}

resetDatabase();
