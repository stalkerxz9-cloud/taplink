import fs from 'fs';

let src = fs.readFileSync('marathon_bot.js', 'utf-8');
const lines = src.split('\n');

// Находим строки начала и конца ШАГ 1
let startLine = -1, endLine = -1;
for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('// ШАГ 1: АВАТАР')) startLine = i;
    if (startLine > 0 && lines[i].includes('Логотип не найден') && endLine === -1) {
        // Следующая строка: закрывающая скобка
        endLine = i + 2;
        break;
    }
}
console.log(`Нашёл ШАГ 1: строки ${startLine+1}–${endLine+1}`);

const NEW_BLOCK = `
    // ─────────────────────────────────────────────────────────────────────────
    // ШАГ 1: АВАТАР — лого в поле "Аватар" + Бурж Халифа в поле "Обложка"
    // Taplink создаёт блок автоматически — кликаем по существующему блоку
    // ─────────────────────────────────────────────────────────────────────────
    const srDir = path.resolve(process.cwd(), 'data', sr.safe_name);
    const logoPath = path.join(srDir, 'logo.jpg');

    if (fs.existsSync(logoPath)) {
        log('1. Аватар...');

        // Открываем диалог — кликаем по существующему блоку аватара
        const clicked = await page.evaluate(() => {
            const block = document.querySelector(
                '.block-avatar, .block-type-avatar, [data-block-type="avatar"], .is-avatar-block'
            );
            if (block) {
                const btn = block.querySelector('.block-edit, .is-edit, button');
                if (btn) { btn.click(); return true; }
                block.click(); return true;
            }
            return false;
        });
        if (!clicked) {
            log('   Блок не найден — добавляем...');
            await page.click('button.is-new-block').catch(() => {});
            await sleep(2000);
            await page.evaluate(() =>
                Array.from(document.querySelectorAll('button.is-block-button'))
                    .find(b => b.innerText?.includes('Аватар'))?.click()
            );
        }
        await sleep(4000);

        // ── A: Загружаем ЛОГОТИП (поле "Аватар" в диалоге) ───────────────────
        log('   A. Загружаем логотип шоурума...');
        // Кнопка "Загрузить" рядом с полем Аватар — кликаем
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('.modal-card-body button'));
            const up = btns.find(b => /загрузить|upload/i.test(b.innerText || ''));
            if (up) up.click();
        });
        await sleep(1000);

        const [fc] = await Promise.all([
            page.waitForFileChooser({ timeout: 6000 }),
            page.evaluate(() => document.querySelector('input[type="file"]')?.click())
        ]).catch(() => [null]);

        if (fc) {
            await fc.accept([logoPath]);
            log('   [OK] Логотип загружен');
            await sleep(6000);
        } else {
            const inp = await page.$('input[type="file"]');
            if (inp) { await inp.uploadFile(logoPath); await sleep(6000); }
        }

        // ── Б: Бурж Халифа — выбираем обложку из галереи ─────────────────────
        log('   Б. Открываем галерею для Обложки...');
        // Ищем строку Обложка и кликаем иконку-галерею в ней
        const gallOpened = await page.evaluate(() => {
            const all = Array.from(document.querySelectorAll('.modal-card-body *'));
            for (const el of all) {
                if (el.children.length === 0 && el.innerText?.trim() === 'Обложка') {
                    const row = el.closest('tr, .field, div[class]') || el.parentElement?.parentElement;
                    if (!row) continue;
                    // Первая кнопка с иконкой = галерея
                    const iconBtns = Array.from(row.querySelectorAll('button, a'))
                        .filter(b => b.querySelector('svg, i, img, [class*="icon"]') && b.offsetWidth > 0);
                    if (iconBtns[0]) { iconBtns[0].click(); return true; }
                    // Кнопка по title
                    const byTitle = row.querySelector('[title*="галер"], [title*="gallery"]');
                    if (byTitle) { byTitle.click(); return true; }
                }
            }
            return false;
        });

        if (!gallOpened) {
            log('   DOM: кнопка Обложки не найдена — координаты (634, 424)');
            await page.mouse.click(634, 424);
        }
        await sleep(3500);

        // Галерея открылась → прокрутка к началу → клик Бурж Халифа
        log('   Выбираем Бурж Халифа из галереи...');
        await page.evaluate(() => {
            const modal = document.querySelector('.modal-card-body');
            if (modal) modal.scrollTop = 0;
        });
        await sleep(800);

        // DOM-клик по первому элементу галереи
        const imgClicked = await page.evaluate(() => {
            const sel = [
                '.picture-gallery-item', '.gallery-item', '.pictures-gallery-item',
                '[class*="gallery-item"]', '[class*="picture-item"]', '[class*="thumb"]'
            ].join(', ');
            const items = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetWidth > 0);
            if (items.length) { items[0].click(); return 'dom-click'; }
            // Ищем img внутри галереи
            const imgs = Array.from(document.querySelectorAll('.modal-card-body img'))
                .filter(img => img.offsetWidth > 50);
            if (imgs.length) {
                const parent = imgs[0].closest('button, a, div[class]') || imgs[0];
                parent.click();
                return 'img-click';
            }
            return null;
        });

        if (imgClicked) {
            log(\`   [OK] Галерея: \${imgClicked}\`);
        } else {
            log('   Координаты: (341, 150) — первое фото');
            await page.mouse.click(341, 150);
        }
        await sleep(4000);
        await ensureSaved(page);

    } else {
        log(\`   [!] Логотип не найден: \${logoPath}\`);
    }
`;

const before = lines.slice(0, startLine - 1).join('\n');
const after  = lines.slice(endLine).join('\n');
const result = before + '\n' + NEW_BLOCK + '\n' + after;

fs.writeFileSync('marathon_bot.js', result, 'utf-8');
console.log(`✅ Патч применён. Итого строк: ${result.split('\n').length}`);
