import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const jsonPath = path.join(__dirname, 'data', 'showrooms_data.json');
const excelPath = path.join(__dirname, 'taplink_report.xlsx');

async function rebuild() {
    console.log('--- Регенерация отчета из JSON ---');
    
    if (!fs.existsSync(jsonPath)) {
        console.error('Ошибка: Файл data/showrooms_data.json не найден!');
        return;
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const published = data.filter(sr => sr.taplink_published === true);
    
    console.log(`Найдено успешно опубликованных шоурумов: ${published.length}`);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Отчет Taplink');

    // Настройка колонок (на русском языке, как в ТЗ)
    worksheet.columns = [
        { header: 'Название шоурума', key: 'name', width: 35 },
        { header: 'Ссылка Taplink',   key: 'url',  width: 45 },
        { header: 'Email',            key: 'email',width: 30 },
        { header: 'Пароль',           key: 'pass', width: 25 },
        { header: 'Дата',              key: 'date', width: 20 }
    ];

    // Стилизация заголовков
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    published.forEach(sr => {
        worksheet.addRow({
            name: sr.name,
            url: sr.taplink_url || 'N/A',
            email: sr.taplink_email || 'N/A',
            pass: sr.taplink_pass || 'SecureShowroom#2024',
            date: new Date().toLocaleDateString('ru-RU')
        });
    });

    try {
        await workbook.xlsx.writeFile(excelPath);
        console.log(`[ОК] Отчет успешно пересоздан! Файл: ${excelPath}`);
        console.log(`В файл записано ${published.length} строк.`);
    } catch (err) {
        if (err.code === 'EBUSY') {
            console.error('--- ОШИБКА ---');
            console.error('Файл Excel открыт в другой программе. ПОЖАЛУЙСТА, ЗАКРОЙТЕ EXCEL И ЗАПУСТИТЕ СКРИПТ СНОВА.');
        } else {
            console.error('Ошибка записи:', err);
        }
    }
}

rebuild();
