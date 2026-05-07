/**
 * audit2.js — анализ состояния данных
 * Показывает: дубли в JSON, пропущенные шоурумы, статус баннеров
 */
import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const dataDir  = path.join(process.cwd(), 'data');
const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// ── 1. Уникальные safe_name ───────────────────────────────────────────────────
const byName = {};
for (const s of showrooms) {
    const sn = s.safe_name || 'UNKNOWN';
    if (!byName[sn]) byName[sn] = [];
    byName[sn].push(s.profile_url);
}

const uniqueNames  = Object.keys(byName);
const duplicates   = uniqueNames.filter(n => byName[n].length > 1);

console.log(`=== АНАЛИЗ showrooms_data.json ===`);
console.log(`Всего записей в JSON:     ${showrooms.length}`);
console.log(`Уникальных safe_name:     ${uniqueNames.length}`);
console.log(`Дублей (safe_name):       ${duplicates.length}`);

if (duplicates.length > 0 && duplicates.length <= 20) {
    console.log('\nДублирующиеся шоурумы:');
    duplicates.forEach(d => {
        console.log(`  ${d}:`);
        byName[d].forEach(url => console.log(`    - ${url}`));
    });
}

// ── 2. Папки на диске ─────────────────────────────────────────────────────────
const folders = fs.readdirSync(dataDir)
    .filter(f => {
        try { return fs.statSync(path.join(dataDir, f)).isDirectory() && f !== 'errors'; }
        catch { return false; }
    });

console.log(`\n=== ПАПКИ НА ДИСКЕ ===`);
console.log(`Всего папок:              ${folders.length}`);

// Шоурумы в JSON без папки
const namesInJson = new Set(uniqueNames);
const namesOnDisk = new Set(folders);

const inJsonNotDisk = uniqueNames.filter(n => !namesOnDisk.has(n));
const onDiskNotJson = folders.filter(n => !namesInJson.has(n));

console.log(`В JSON, нет на диске:     ${inJsonNotDisk.length}`);
console.log(`На диске, нет в JSON:     ${onDiskNotJson.length}`);

if (inJsonNotDisk.length > 0) {
    console.log('\nШоурумы БЕЗ папки (нужно скачать фото):');
    inJsonNotDisk.forEach(n => console.log(`  - ${n}: ${byName[n][0]}`));
}

if (onDiskNotJson.length > 0 && onDiskNotJson.length <= 20) {
    console.log('\nПапки без записи в JSON:');
    onDiskNotJson.forEach(n => console.log(`  - ${n}`));
}

// ── 3. Статус файлов ──────────────────────────────────────────────────────────
let hasLogo=0, hasBanner=0, hasPhotos=0;
let noLogo=[], noBanner=[], noPhotos=[];

for (const folder of folders) {
    const dir = path.join(dataDir, folder);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }

    const logo   = files.find(f => /^logo\./i.test(f));
    const banner = files.find(f => /^banner\./i.test(f));
    const photos = files.filter(f => /^car_/i.test(f));

    if (logo)         hasLogo++;   else noLogo.push(folder);
    if (banner)       hasBanner++; else noBanner.push(folder);
    if (photos.length) hasPhotos++; else noPhotos.push(folder);
}

const total = folders.length;
console.log(`\n=== СТАТУС ФАЙЛОВ ===`);
console.log(`С логотипом:   ${hasLogo}/${total} (${(hasLogo/total*100).toFixed(1)}%)`);
console.log(`С баннером:    ${hasBanner}/${total} (${(hasBanner/total*100).toFixed(1)}%)`);
console.log(`С фото авто:   ${hasPhotos}/${total} (${(hasPhotos/total*100).toFixed(1)}%)`);

console.log(`\nБезлоготипных: ${noLogo.length}`);
if (noLogo.length && noLogo.length <= 30) noLogo.forEach(n => console.log(`  - ${n}`));

console.log(`\nБезбаннерных:  ${noBanner.length}`);
if (noBanner.length <= 10) {
    noBanner.forEach(n => console.log(`  - ${n}`));
} else {
    console.log(`  (первые 5: ${noBanner.slice(0,5).join(', ')} ...)`);
}

console.log(`\nБез фото авто: ${noPhotos.length}`);
if (noPhotos.length > 0) noPhotos.slice(0,10).forEach(n => console.log(`  - ${n}`));
