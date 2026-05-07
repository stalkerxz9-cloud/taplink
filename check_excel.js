import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const excelPath = path.join(__dirname, 'taplink_report.xlsx');

async function checkExcel() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelPath);
    const sheet = workbook.getWorksheet(1);
    
    let rows = 0;
    let urls = new Set();
    let emails = new Set();
    let badUrls = [];
    let emptyDocs = 0;

    let seenEmails = new Set();
    let dupes = [];

    sheet.eachRow((row, i) => {
        if (i === 1) return; // skip header
        const name = row.getCell(1).value;
        const email = row.getCell(3).value;

        if (email) {
            if (seenEmails.has(email)) {
                dupes.push({row: i, name, email});
            } else {
                seenEmails.add(email);
            }
        }
    });

    console.log("Дубликаты email:", dupes);
}

checkExcel();
