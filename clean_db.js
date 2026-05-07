import fs from 'fs';
const data = JSON.parse(fs.readFileSync('data/showrooms_data.json', 'utf-8'));
const unique = [];
const seen = new Set();

for (const sr of data) {
    const key = sr.profile_url; // Уникальный ключ - URL профиля
    if (!seen.has(key)) {
        seen.add(key);
        unique.push(sr);
    }
}

fs.writeFileSync('data/showrooms_data.json', JSON.stringify(unique, null, 2));
console.log(`База очищена: было ${data.length}, стало ${unique.length} записей.`);
