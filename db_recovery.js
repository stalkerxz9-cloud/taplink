import fs from 'fs';
import path from 'path';

const dataPath = 'data/showrooms_data.json';
const backupPath = 'data/backups/showrooms_data_2026-04-08T04-19-57.json';
const dataDir = 'data';

function mergeData() {
    console.log('--- STARTING DATABASE RECOVERY ---');

    // 1. Load current data
    let currentData = [];
    if (fs.existsSync(dataPath)) {
        try {
            currentData = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
            console.log(`Current data entries: ${currentData.length}`);
        } catch (e) {
            console.error('Error reading current data:', e.message);
        }
    }

    // 2. Load backup data
    let backupData = [];
    if (fs.existsSync(backupPath)) {
        try {
            backupData = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));
            console.log(`Backup data entries: ${backupData.length}`);
        } catch (e) {
            console.error('Error reading backup data:', e.message);
        }
    }

    // 3. Combine both lists
    const mergedMap = new Map();

    function addToMap(list) {
        list.forEach(sr => {
            if (!sr.profile_url) return;
            const existing = mergedMap.get(sr.profile_url);
            
            // Prioritize entry with valid name and progress
            if (!existing) {
                mergedMap.set(sr.profile_url, sr);
            } else {
                // Keep the one that has taplink_published or taplink_designed
                if (sr.taplink_published || sr.taplink_designed) {
                    mergedMap.set(sr.profile_url, sr);
                } else if (!existing.taplink_published && sr.name !== 'Unknown' && existing.name === 'Unknown') {
                     mergedMap.set(sr.profile_url, sr);
                }
            }
        });
    }

    addToMap(currentData);
    addToMap(backupData);
    console.log(`Unique showrooms after merge: ${mergedMap.size}`);

    // 4. Scan data directory for missing folders
    const dirs = fs.readdirSync(dataDir).filter(f => {
        return fs.statSync(path.join(dataDir, f)).isDirectory() && 
               !['backups', 'errors', 'node_modules', '.vscode'].includes(f);
    });
    console.log(`Found ${dirs.length} showroom directories on disk.`);

    const existingSafeNames = new Set(Array.from(mergedMap.values()).map(s => s.safe_name));
    
    let recoveredCount = 0;
    dirs.forEach(dirName => {
        if (!existingSafeNames.has(dirName)) {
            // Reconstruct entry
            const baseUrl = `https://auto.ae/ru/${dirName}/`;
            const entry = {
                name: "Unknown", // Will be fixed by bot if needed, but safe_name is key
                profile_url: baseUrl,
                cars_url: `${baseUrl}sale/`,
                rent_url: `${baseUrl}rent/`,
                numbers_url: `${baseUrl}sale/vrp/`,
                sold_url: `${baseUrl}sale/sold/`,
                whatsapp: "",
                logo_url: "",
                logo_local: fs.existsSync(path.join(dataDir, dirName, 'logo.jpg')) ? `data/${dirName}/logo.jpg` : "",
                background_url: "",
                safe_name: dirName,
                images_local: []
            };
            
            // Try to find if some other images exist
            for (let i = 1; i <= 10; i++) {
                if (fs.existsSync(path.join(dataDir, dirName, `car_${i}.jpg`))) {
                    entry.images_local.push(`data/${dirName}/car_${i}.jpg`);
                }
            }

            mergedMap.set(baseUrl, entry);
            recoveredCount++;
        }
    });

    console.log(`Recovered from folders: ${recoveredCount}`);
    
    // 5. Final Deduplication and Cleanup
    const finalData = Array.from(mergedMap.values());
    
    // Last check for name restoration from duplicates if any were Unknown
    // (Actually Map handled it partially, but let's be sure)
    
    console.log(`Final count of unique showrooms: ${finalData.length}`);

    // 6. Save back to original file (and a backup just in case)
    const outPath = 'data/showrooms_data.json';
    const recoveryBackup = `data/backups/showrooms_data_RECOVERED_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    
    fs.writeFileSync(outPath, JSON.stringify(finalData, null, 2), 'utf-8');
    fs.writeFileSync(recoveryBackup, JSON.stringify(finalData, null, 2), 'utf-8');

    console.log(`--- SUCCESS ---`);
    console.log(`Data saved to ${outPath}`);
    console.log(`Recovery backup saved to ${recoveryBackup}`);
}

mergeData();
