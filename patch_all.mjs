import fs from 'fs';

let src = fs.readFileSync('marathon_bot.js', 'utf-8');

// ─── ПАТЧ 1: Клик по СУЩЕСТВУЮЩЕМУ блоку аватара (hover → edit) ──────────────
const OLD_AVATAR_CLICK = `        // Удаляем авто-созданный пустой блок аватара (он сдвигает координаты)
        await page.evaluate(() => {
            const blocks = Array.from(document.querySelectorAll(
                '.block-avatar, .block-type-avatar, [data-block-type="avatar"], .is-avatar-block, ' +
                '[class*="block"][class*="avatar"], .page-block:first-child'
            ));
            blocks.forEach(b => {
                // Удаляем только если в блоке нет реального изображения (пустышка)
                const img = b.querySelector('img[src*="avatar"], img:not([src*="default"])');
                if (!img) b.remove();
            });
        }).catch(() => {});
        await sleep(1000);

        // ── GOLDEN-подход: добавляем новый блок Аватар через меню ─────────────
        log('   Добавляем блок Аватар (Golden-метод)...');
        const addBtnEl = await page.waitForSelector('button.is-new-block', { timeout: 15000 }).catch(() => null);
        if (!addBtnEl) {
            log('   [!] Кнопка добавления блока не найдена');
        } else {
            await addBtnEl.click();
            await sleep(2500);
            await page.evaluate(() =>
                Array.from(document.querySelectorAll('button.is-block-button, button'))
                    .find(el => el.innerText?.includes('Аватар') || el.innerText?.includes('Avatar'))?.click()
            );
            await sleep(4500); // Ждём открытия диалога "Аватар"`;

const NEW_AVATAR_CLICK = `        // ── Открываем диалог аватара — кликаем на СУЩЕСТВУЮЩИЙ блок ────────────
        // Taplink создаёт блок аватара автоматически. Нужно просто кликнуть на него.
        log('   Открываем блок аватара...');

        // Стратегия 1: Hover → ждём кнопку редактирования
        await page.mouse.move(640, 250);
        await sleep(800);
        const editBtnAppeared = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a, [class*="edit"], [class*="pencil"], [class*="settings"]'));
            const edit = btns.find(b =>
                b.offsetWidth > 0 &&
                (b.innerText?.includes('Редактировать') || b.innerText?.includes('Edit') ||
                 (b.className || '').includes('edit') || (b.title || '').includes('редак'))
            );
            if (edit) { edit.click(); return true; }
            return false;
        });
        if (!editBtnAppeared) {
            // Клик напрямую по блоку аватара
            await page.mouse.click(640, 250);
        }
        await sleep(3500);

        // Проверяем: открылся ли диалог Аватар?
        let avatarDialogOpen = await page.evaluate(() =>
            (document.body.innerText.includes('Аватар') || document.body.innerText.includes('Avatar')) &&
            !!document.querySelector('.modal.is-active, .modal-card')
        );

        if (!avatarDialogOpen) {
            // Fallback: добавляем новый блок через меню
            log('   Диалог не открылся — добавляем новый блок (fallback)...');
            const addBtnEl = await page.waitForSelector('button.is-new-block', { timeout: 10000 }).catch(() => null);
            if (addBtnEl) {
                await addBtnEl.click();
                await sleep(2000);
                await page.evaluate(() =>
                    Array.from(document.querySelectorAll('button.is-block-button, button'))
                        .find(el => el.innerText?.includes('Аватар'))?.click()
                );
                await sleep(4000);
                avatarDialogOpen = true;
            }
        } else {
            log('   [OK] Диалог аватара открыт (клик по существующему блоку)');
        }

        if (avatarDialogOpen) {`;

if (src.includes(OLD_AVATAR_CLICK)) {
    src = src.replace(OLD_AVATAR_CLICK, NEW_AVATAR_CLICK);
    console.log('✅ Патч 1 (avatar click) применён');
} else {
    console.log('❌ Патч 1: строка не найдена');
    // Показываем контекст для отладки
    const idx = src.indexOf('Удаляем авто-созданный');
    console.log('Контекст:', src.substring(Math.max(0, idx-50), idx+100));
}

// ─── ПАТЧ 2: Выбор изображения ТОЛЬКО из галерейного модала ─────────────────
const OLD_GALLERY_IMG = `                // DOM-клик на первый элемент галереи
                const firstPicClicked = await page.evaluate(() => {
                    const sels = [
                        '.picture-gallery-item', '.gallery-item', '.pictures-gallery-item',
                        '[class*="gallery-item"]', '[class*="picture-item"]',
                        '[class*="thumb"]', '.media-item', '.stock-item'
                    ];
                    for (const sel of sels) {
                        const items = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetWidth > 0);
                        if (items.length) { items[0].click(); return sel; }
                    }
                    // Ищем картинки в модалке
                    const imgs = Array.from(document.querySelectorAll('.modal-card-body img'))
                        .filter(img => img.offsetWidth > 50);
                    if (imgs.length) {
                        (imgs[0].closest('button, a, li, div[class]') || imgs[0]).click();
                        return 'img';
                    }
                    return null;
                });`;

const NEW_GALLERY_IMG = `                // DOM-клик ТОЛЬКО внутри галерейного модала (не аватар-модала!)
                // КРИТИЧНО: .modal-card-body есть и в аватар-диалоге и в галерее.
                // Первый img в аватар-модале = логотип! Нужно искать в галерее.
                const firstPicClicked = await page.evaluate(() => {
                    // Находим модал ГАЛЕРЕИ по содержимому "Галерея" (не аватар-диалог)
                    const allModals = Array.from(document.querySelectorAll(
                        '.modal.is-active .modal-card-body, .modal-content, .modal-card-body'
                    ));
                    const galleryModal = allModals.find(m =>
                        m.offsetHeight > 0 &&
                        (m.innerText?.includes('Галерея') || (m.className || '').includes('gallery'))
                    );
                    const searchRoot = galleryModal || document; // Fallback: весь документ

                    // Ищем кликабельные элементы галереи
                    const sels = [
                        '.picture-gallery-item', '.gallery-item', '.pictures-gallery-item',
                        '[class*="gallery-item"]', '[class*="picture-item"]',
                        '[class*="thumb"]', '.media-item', '.stock-item'
                    ];
                    for (const sel of sels) {
                        const items = Array.from(searchRoot.querySelectorAll(sel)).filter(el => el.offsetWidth > 0);
                        if (items.length) { items[0].click(); return sel; }
                    }
                    // Ищем img ТОЛЬКО внутри галерейного модала
                    if (galleryModal) {
                        const gallImgs = Array.from(galleryModal.querySelectorAll('img'))
                            .filter(img => img.offsetWidth > 50 && img.src);
                        if (gallImgs.length) {
                            (gallImgs[0].closest('button, a, li, div[class]') || gallImgs[0]).click();
                            return 'gallery-img';
                        }
                    }
                    return null;
                });`;

if (src.includes(OLD_GALLERY_IMG)) {
    src = src.replace(OLD_GALLERY_IMG, NEW_GALLERY_IMG);
    console.log('✅ Патч 2 (gallery modal) применён');
} else {
    console.log('❌ Патч 2: строка не найдена');
}

fs.writeFileSync('marathon_bot.js', src, 'utf-8');
console.log(`\n✅ Готово. Строк: ${src.split('\n').length}`);
