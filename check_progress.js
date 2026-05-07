import fs from 'fs';
const data = JSON.parse(fs.readFileSync('data/showrooms_data.json', 'utf-8'));
const total = data.length;
const created = data.filter(s => s.taplink_created).length;
const designed = data.filter(s => s.taplink_designed).length;
const published = data.filter(s => s.taplink_published).length;

console.log(`Total showrooms: ${total}`);
console.log(`Created: ${created}`);
console.log(`Designed: ${designed}`);
console.log(`Published: ${published}`);
