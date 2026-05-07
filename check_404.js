import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, 'data', 'showrooms_data.json');

async function check404s() {
    console.log('🔍 Запуск диагностики 404 ошибок...');

    if (!fs.existsSync(jsonPath)) {
        console.error('Ошибка: Файл data/showrooms_data.json не найден!');
        return;
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const published = data.filter(sr => sr.taplink_published === true);

    console.log(`Проверяем ${published.length} опубликованных ссылок...`);

    const broken = [];
    
    // Проверяем пачками по 10 сразу для скорости
    for (let i = 0; i < published.length; i += 10) {
        const chunk = published.slice(i, i + 10);
        const results = await Promise.all(chunk.map(async (sr) => {
            try {
                const response = await axios.get(sr.taplink_url, { 
                    timeout: 5000,
                    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
                });
                return { name: sr.name, url: sr.taplink_url, status: response.status };
            } catch (err) {
                return { name: sr.name, url: sr.taplink_url, status: err.response?.status || 'TIMEOUT/ERROR' };
            }
        }));

        for (const res of results) {
            if (res.status === 404) {
                console.log(`❌ 404: ${res.name} (${res.url})`);
                broken.push(res);
            }
        }
        process.stdout.write(`Проверено: ${Math.min(i + 10, published.length)}/${published.length}\r`);
    }

    console.log('\n--- Итог диагностики ---');
    console.log(`Найдено битых ссылок (404): ${broken.length}`);
    
    if (broken.length > 0) {
        const brokenPath = path.join(__dirname, 'data', 'broken_links.json');
        fs.writeFileSync(brokenPath, JSON.stringify(broken, null, 2));
        console.log(`Список битых ссылок сохранен в: ${brokenPath}`);
    }
}

check404s();
