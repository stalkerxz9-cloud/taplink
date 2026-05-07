import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const outputPath = path.join(process.cwd(), 'taplink_report.xlsx');

async function generateReport() {
    if (!fs.existsSync(dataPath)) {
        console.error('Ошибка: Файл showrooms_data.json не найден. Сбор данных еще не начинался.');
        return;
    }

    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Отчет Taplink');

    // Настройка заголовков
    worksheet.columns = [
        { header: 'Название шоурума', key: 'name', width: 30 },
        { header: 'Ссылка на страницу Taplink', key: 'taplink_url', width: 45 },
        { header: 'Ссылка на шоурум (auto.ae)', key: 'profile_url', width: 45 },
        { header: 'Доступ (Email)', key: 'email', width: 35 },
        { header: 'Доступ (Пароль)', key: 'pass', width: 20 },
        { header: 'Статус', key: 'status', width: 25 },
        { header: 'Примечание', key: 'note', width: 50 },
    ];

    // Оформление заголовка
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F81BD' } };
    
    // Заполнение данных
    showrooms.forEach(sr => {
        let status = 'В ожидании';
        if (sr.taplink_created === true) status = 'Успешно создано';
        else if (sr.taplink_created === false) status = 'Ошибка создания';

        let notes = [];
        if (!sr.logo_url) notes.push('Нет логотопа');
        if (!sr.background_url) notes.push('Нет фона');
        if (!sr.images_local || sr.images_local.length < 5) notes.push('Мало фото авто');
        
        worksheet.addRow({
            name: sr.name,
            taplink_url: sr.taplink_created ? sr.taplink_url : '-',
            profile_url: sr.profile_url,
            email: sr.taplink_email || '-',
            pass: sr.taplink_pass || '-',
            status: status,
            note: notes.length > 0 ? notes.join(', ') : 'ОК'
        });
    });

    // Оформление ячеек
    worksheet.eachRow((row, n) => {
        if (n > 1) {
            row.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            
            // Если статус 'Успешно' - красим зеленым
            const statusCell = row.getCell('status');
            if (statusCell.value === 'Успешно создано') {
                statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
                statusCell.font = { color: { argb: 'FF006100' } };
            } else if (statusCell.value === 'Ошибка создания') {
                statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
                statusCell.font = { color: { argb: 'FF9C0006' } };
            }
            
            // Ссылки кликабельными
            const tplCell = row.getCell('taplink_url');
            if (tplCell.value && String(tplCell.value).startsWith('http')) {
                tplCell.font = { color: { argb: 'FF0563C1' }, underline: true };
            }
            const autoCell = row.getCell('profile_url');
            if (autoCell.value && String(autoCell.value).startsWith('http')) {
                autoCell.font = { color: { argb: 'FF0563C1' }, underline: true };
            }
        }
    });

    await workbook.xlsx.writeFile(outputPath);
    console.log(`\nОтчет успешно сформирован: ${outputPath}`);
}

generateReport().catch(console.error);
