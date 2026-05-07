import ExcelJS from 'exceljs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const excelPath = path.join(__dirname, 'taplink_report.xlsx');

async function removeDateColumn() {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(excelPath);
    const sheet = workbook.getWorksheet(1);
    
    // Удаляем 5-ю колонку (Дата)
    sheet.spliceColumns(5, 1);
    
    await workbook.xlsx.writeFile(excelPath);
    console.log("Колонка 'Дата' успешно удалена из taplink_report.xlsx");
}

removeDateColumn();
