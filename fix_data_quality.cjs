const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, 'data', 'showrooms_data.json');

// ФИЛЬТР ДЛЯ ОЧИСТКИ ОТ КИРИЛЛИЦЫ
function cleanText(text) {
    if (!text) return '';
    // Удаляем все русские буквы и кракозябры, оставляя латиницу, цифры и знаки препинания
    return text.replace(/[а-яА-ЯёЁ]/g, '').replace(/[^\x00-\x7F]/g, '').replace(/\n\s*\n/g, '\n').trim();
}

// УЛУЧШЕННЫЙ ГЕНЕРАТОР "ОБЪЕМНЫХ" АНГЛИЙСКИХ BIO
function generateEnglishBio(name, keywords = '') {
    const isRental = keywords.toLowerCase().includes('rent');
    const isLuxury = keywords.toLowerCase().includes('luxury') || keywords.toLowerCase().includes('premium');

    const templates = [
        `Welcome to ${name}, your destination for excellence in the Dubai automotive market. We take pride in offering a curated collection of high-quality vehicles, each passing a rigorous multi-stage technical inspection. Our team of experts is dedicated to providing a seamless purchasing experience, ensuring that every client finds their perfect match in our extensive inventory.`,
        `Experience the pinnacle of automotive service with ${name}. Specialized in premium vehicles from the UAE, we offer our international clientele exclusive access to limited-edition models and top-tier inventory. Reliability, transparency, and a commitment to quality are at the core of everything we do, making us your trusted partner in the world of luxury mobility.`,
        `At ${name}, we redefine the car buying experience in Dubai through our dedication to professional service and technical perfection. We manage everything from expert selection and comprehensive mechanical checks to worldwide shipping and logistics. Discover a diverse range of exceptional vehicles in our showroom, all prepared to the highest international standards of safety and performance.`,
        `Located in the heart of the Dubai automotive hub, ${name} stands as a leader in premium vehicle exports and local sales. We offer a sophisticated selection of cars, catering to the most discerning enthusiasts who value both performance and luxury. Our mission is to bridge the gap between world-class inventory and global demand through unparalleled service and technical expertise.`,
        `${name} is dedicated to bringing you the finest selection of vehicles in the Middle East, combine competitive market pricing with uncompromising quality. Every vehicle in our showroom is handpicked and verified by senior technical specialists to ensure complete customer peace of mind. Join our growing community of satisfied clients and experience automotive excellence like never before.`
    ];

    if (isRental) {
        return `${name} is a premier car rental destination in Dubai, offering an elite fleet of luxury, exotic, and high-performance vehicles for discerning travelers. We specialize in providing a first-class driving experience, combined with flexible terms and impeccable maintenance standards across our entire inventory. Whether for business or pleasure, we ensure your journey across the UAE is defined by style, comfort, and reliability.`;
    }
    
    if (isLuxury) {
        return `Discover the ultimate selection of luxury and high-performance automobiles at ${name}. We curate only the most exclusive models in Dubai, ensuring that every vehicle represents the height of automotive engineering and aesthetic elegance. Our specialists provide bespoke service tailored to those who demand the best, making us the preferred destination for luxury car collectors and enthusiasts worldwide.`;
    }

    return templates[Math.floor(Math.random() * templates.length)];
}

// УМНОЕ ВОССТАНОВЛЕНИЕ ИМЕНИ
function formatName(safeName) {
    if (!safeName) return 'Premium Showroom';
    const commonWords = ['motors', 'cars', 'auto', 'rental', 'luxury', 'premium', 'showroom', 'dubai', 'uae', 'group', 'collection', 'trading', 'fze', 'llc'];
    let result = safeName;
    commonWords.forEach(word => {
        const regex = new RegExp(`([^\\s])(${word})`, 'gi');
        result = result.replace(regex, '$1 $2');
    });
    return result.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function run() {
    if (!fs.existsSync(dataPath)) {
        console.error('База данных не найдена!');
        return;
    }

    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    let count = 0;

    data.forEach(sr => {
        // 1. Имя
        if (!sr.name || sr.name === 'Unknown' || sr.name === 'undefined') {
            sr.name = formatName(sr.safe_name);
        }

        // 2. БИО (ВСЕГДА ПЕРЕЗАПИСЫВАЕМ НА НОВОЕ ОБЪЕМНОЕ)
        sr.bio = generateEnglishBio(sr.name, sr.keywords || '');

        // 3. АДРЕС (ЧИСТИМ ОТ РУССКОГО)
        if (sr.address) {
            sr.address = cleanText(sr.address);
        }

        count++;
    });

    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));

    console.log(`--- ✅ BIO REGENERATION COMPLETE ---`);
    console.log(`📊 Всего объектов обновлено: ${count}`);
    console.log(`📂 Данные сохранены в: ${dataPath}`);
}

run();
