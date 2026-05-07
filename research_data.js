import fs from 'fs';
const data = JSON.parse(fs.readFileSync('data/showrooms_data.json', 'utf-8'));

const total = data.length;
const unknown = data.filter(s => s.name === 'Unknown').length;
const hasBio = data.filter(s => s.bio && s.bio.length > 10).length;
const designed = data.filter(s => s.taplink_designed).length;
const published = data.filter(s => s.taplink_published).length;
const created = data.filter(s => s.taplink_created).length;

const hasLogo = data.filter(s => s.logo_local && fs.existsSync(s.logo_local)).length;
const hasImages = data.filter(s => s.images_local && s.images_local.length > 0).length;

console.log('--- DATA RESEARCH ---');
console.log(`Total:     ${total}`);
console.log(`Unknown:   ${unknown}`);
console.log(`Has Bio:   ${hasBio}`);
console.log(`Created:   ${created}`);
console.log(`Designed:  ${designed}`);
console.log(`Published: ${published}`);
console.log(`Has Logo:  ${hasLogo}`);
console.log(`Has Imgs:  ${hasImages}`);

// Check for duplicates
const names = data.map(s => s.name);
const uniqueNames = new Set(names);
console.log(`Unique Names: ${uniqueNames.size}`);

if (total > uniqueNames.size) {
    console.log('Found Duplicates!');
}
