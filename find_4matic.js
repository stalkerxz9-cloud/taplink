import fs from 'fs';
const data = JSON.parse(fs.readFileSync('data/showrooms_data.json', 'utf-8'));
const sr = data.find(s => s.name?.toLowerCase().includes('4matic') || s.safe_name?.includes('4matic'));
console.log(JSON.stringify(sr, null, 2));
