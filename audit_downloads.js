const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, 'data');
const dirs = fs.readdirSync(dataDir).filter(d => {
  try {
    const s = fs.statSync(path.join(dataDir, d));
    return s.isDirectory() && d !== 'errors';
  } catch(e) { return false; }
});

let hasLogo=0, hasBanner=0, hasPhotos=0;
let noLogo=[], noBanner=[], noPhotos=[];
let photoStats = {};

for (const dir of dirs) {
  const dirPath = path.join(dataDir, dir);
  let files;
  try { files = fs.readdirSync(dirPath); } catch(e) { continue; }
  
  const logo = files.find(f => /^logo\./i.test(f));
  const banner = files.find(f => /^banner\./i.test(f));
  // photos can be photo_*, car_*, or any image
  const photos = files.filter(f => /^(photo_|car_)/i.test(f) || 
    (/\.(jpg|jpeg|png|webp)$/i.test(f) && !/^(logo|banner)/i.test(f)));
  
  if (logo) hasLogo++; else noLogo.push(dir);
  if (banner) hasBanner++; else noBanner.push(dir);
  if (photos.length > 0) hasPhotos++; else noPhotos.push(dir);
  
  photoStats[dir] = { logo: !!logo, banner: !!banner, photoCount: photos.length };
}

const total = dirs.length;
console.log('=== ИТОГ ===');
console.log(`Всего шоурумов: ${total}`);
console.log(`С логотипом:   ${hasLogo} (${(hasLogo/total*100).toFixed(1)}%)`);
console.log(`С баннером:    ${hasBanner} (${(hasBanner/total*100).toFixed(1)}%)`);
console.log(`С фото галереи: ${hasPhotos} (${(hasPhotos/total*100).toFixed(1)}%)`);
console.log('');

// Photo count distribution
const countDist = {};
Object.values(photoStats).forEach(s => {
  countDist[s.photoCount] = (countDist[s.photoCount] || 0) + 1;
});
console.log('=== РАСПРЕДЕЛЕНИЕ ФОТО ===');
Object.keys(countDist).sort((a,b)=>+a-+b).forEach(k => {
  console.log(`  ${k} фото: ${countDist[k]} шоурумов`);
});

console.log('');
console.log(`=== БЕЗ ЛОГОТИПА (${noLogo.length}) ===`);
noLogo.forEach(d => console.log(' -', d));

console.log('');
console.log(`=== БЕЗ БАННЕРА (${noBanner.length}) ===`);
if (noBanner.length <= 10) {
  noBanner.forEach(d => console.log(' -', d));
} else {
  console.log(`  (${noBanner.length} шоурумов без баннера - первые 10:)`);
  noBanner.slice(0,10).forEach(d => console.log(' -', d));
  console.log(`  ...и ещё ${noBanner.length-10}`);
}

console.log('');
console.log(`=== БЕЗ ФОТО (${noPhotos.length}) ===`);
noPhotos.slice(0,20).forEach(d => console.log(' -', d));
if (noPhotos.length > 20) console.log(`  ...и ещё ${noPhotos.length-20}`);

// также проверяем что в папке есть хоть что-нибудь
const empty = dirs.filter(d => {
  try { return fs.readdirSync(path.join(dataDir, d)).length === 0; }
  catch(e) { return false; }
});
console.log('');
console.log(`=== ПУСТЫЕ ПАПКИ (${empty.length}) ===`);
empty.forEach(d => console.log(' -', d));

// Проверяем showrooms_data.json
try {
  const jsonData = JSON.parse(fs.readFileSync(path.join(dataDir, '..', 'data', 'showrooms_data.json') , 'utf8'));
  // если это массив
  if (Array.isArray(jsonData)) {
    console.log(`\n=== В showrooms_data.json записей: ${jsonData.length} ===`);
    const withLogo = jsonData.filter(s => s.logo).length;
    const withBanner = jsonData.filter(s => s.banner || s.background).length;
    const withPhotos = jsonData.filter(s => s.photos && s.photos.length > 0).length;
    console.log(`  С logo URL: ${withLogo}`);
    console.log(`  С banner/background URL: ${withBanner}`);
    console.log(`  С photos: ${withPhotos}`);
  }
} catch(e) {}
