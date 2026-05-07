const fs = require('fs');
['3_test_one.js', '3_design_only.js'].forEach(f => {
    let target = fs.readFileSync(f, 'utf8');
    const search = `const addBtn = Array.from(document.querySelectorAll('button, a, div[role="button"]'))
                        .find(b => /(добавить блок|add block)/i.test(b.innerText || ''));
                    if (addBtn) addBtn.click();`;
    
    const replacement = `let addBtn = document.querySelector('.btn-add-block, [class*="add-block"]');
                    if (!addBtn) {
                        addBtn = Array.from(document.querySelectorAll('div, span, button, a'))
                            .find(b => b.innerText && b.innerText.trim().toLowerCase() === 'добавить блок');
                    }
                    if (addBtn) {
                        addBtn.click();
                        setTimeout(() => addBtn.click(), 500);
                        setTimeout(() => addBtn.click(), 1000);
                    }`;
    
    let res = target.split(search).join(replacement);
    fs.writeFileSync(f, res);
    console.log(f + " обновлен");
});
