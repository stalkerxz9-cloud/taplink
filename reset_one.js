import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const db = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// Находим первый шоурум, который был "оформлен" ошибочно
const target = db.find(s => s.taplink_designed === true);
if (target) {
    target.taplink_designed = false;
    fs.writeFileSync(dataPath, JSON.stringify(db, null, 2));
    console.log(`Статус шоурума "${target.name}" сброшен. Можно запускать тест снова.`);
} else {
    console.log('Нет шоурумов со статусом "оформлен".');
}
