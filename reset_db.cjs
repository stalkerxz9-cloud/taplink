const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data', 'showrooms_data.json');
const bkpDir = path.join(__dirname, 'data', 'backups');

if (!fs.existsSync(bkpDir)) fs.mkdirSync(bkpDir, { recursive: true });

// 1. Создаем бэкап
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const bkpPath = path.join(bkpDir, `showrooms_data_BEFORE_FULL_RESET_${timestamp}.json`);

if (fs.existsSync(dataPath)) {
    fs.copyFileSync(dataPath, bkpPath);
    console.log(`🛡️ Бэкап создан: ${bkpPath}`);
}

// 2. Читаем и сбрасываем
const db = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const resetDb = db.map(sr => {
    return {
        ...sr,
        taplink_created: false,
        taplink_email: "",
        taplink_pass: "",
        taplink_url: "",
        taplink_designed: false,
        taplink_published: false
    };
});

fs.writeFileSync(dataPath, JSON.stringify(resetDb, null, 2));
console.log(`✅ База успешно сброшена! ${db.length} шоурумов готовы к новой регистрации.`);
