const fs = require('fs');

const clickAddBlockFn = `async function clickAddBlockNative(page) {
    try {
        await page.keyboard.press('Escape').catch(()=>{}); // убить окно
        await new Promise(r => setTimeout(r, 500));
        
        const bounds = await page.evaluate(() => {
            const btn = Array.from(document.querySelectorAll('div, span, button, a'))
                .find(b => b.innerText && b.innerText.trim().toLowerCase() === 'добавить блок');
            if (btn) {
                const rect = btn.getBoundingClientRect();
                // Найдём все тултипы и скроем их
                document.querySelectorAll('div').forEach(el => {
                    const z = window.getComputedStyle(el).zIndex;
                    if (z !== 'auto' && parseInt(z) >= 50 && el.offsetHeight > window.innerHeight * 0.5) {
                        el.style.opacity = '0';
                        el.style.pointerEvents = 'none';
                    }
                });
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
            }
            return null;
        });
        
        if (bounds) {
            await page.mouse.click(bounds.x, bounds.y);
            await new Promise(r => setTimeout(r, 500));
            // И ещё раз на всякий случай
            await page.mouse.click(bounds.x, bounds.y);
        } else {
            // Фолбэк на программный клик
            await page.evaluate(() => {
                let btn = document.querySelector('.btn-add-block, [class*="add-block"]');
                if (!btn) btn = Array.from(document.querySelectorAll('div, span, button, a')).find(b => b.innerText && b.innerText.trim().toLowerCase() === 'добавить блок');
                if (btn) { btn.click(); setTimeout(() => btn.click(), 500); }
            });
        }
    } catch(e) {}
}
`;

const files = ['3_test_one.js', '3_design_only.js'];
files.forEach(f => {
    let content = fs.readFileSync(f, 'utf8');
    
    // Вставляем функцию-хелпер, если её нет
    if (!content.includes('clickAddBlockNative')) {
        content = content.replace('function sleep(ms)', clickAddBlockFn + '\nfunction sleep(ms)');
    }

    // Заменяем блок с добавлением
    const badCode = `await page.evaluate(() => {
                    let addBtn = document.querySelector('.btn-add-block, [class*="add-block"]');
                    if (!addBtn) {
                        addBtn = Array.from(document.querySelectorAll('div, span, button, a'))
                            .find(b => b.innerText && b.innerText.trim().toLowerCase() === 'добавить блок');
                    }
                    if (addBtn) {
                        addBtn.click();
                        setTimeout(() => addBtn.click(), 500);
                        setTimeout(() => addBtn.click(), 1000);
                    }
                });`;
                
    content = content.split(badCode).join('await clickAddBlockNative(page);');
    
    fs.writeFileSync(f, content);
    console.log("Updated " + f);
});
