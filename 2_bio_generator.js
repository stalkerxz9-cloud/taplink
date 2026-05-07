import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'data', 'showrooms_data.json');
const configPath = path.join(process.cwd(), 'config.json');

const BIO_TEMPLATES = [
    (name) => `${name} is your premier destination for luxury and performance vehicles in the UAE. We offer an exclusive selection of premium cars for sale and rent, backed by expert advice and exceptional service. Browse our catalog and find your perfect car today.`,
    (name) => `Welcome to ${name} — one of the UAE's most trusted automotive showrooms. Discover a handpicked collection of luxury, sports, and exotic vehicles available for sale and daily rental. Our team is ready to help you at every step.`,
    (name) => `${name} specializes in premium automobiles sourced directly from the UAE market. Whether you're looking to buy, rent, or explore exclusive number plates, we deliver quality and trust you can count on. Contact us via WhatsApp for a personal consultation.`,
    (name) => `At ${name}, we bring you the finest automobiles the UAE has to offer — luxury sedans, SUVs, sports cars, and more. Every vehicle is verified for quality and legal compliance. Start your journey with us today.`,
    (name) => `${name} is a leading showroom for premium cars in the UAE. We offer competitive pricing, a wide selection of makes and models, and seamless purchase or rental experience. Reach out to our experts and drive your dream car.`,
];

function generateFallbackBio(showroom) {
    const idx = Math.abs(showroom.safe_name?.charCodeAt(0) || 0) % BIO_TEMPLATES.length;
    return BIO_TEMPLATES[idx](showroom.name);
}

async function run() {
    if (!fs.existsSync(dataPath)) {
        console.error('Ошибка: Файл showrooms_data.json не найден. Сначала запустите 1_parser.js!');
        return;
    }

    const showrooms = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    let config = {};
    if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }

    const openaiKey = config.ai_bio?.openaiApiKey;
    let usingAI = false;
    let OpenAI = null;

    if (openaiKey && openaiKey !== 'ВАШ_КЛЮЧ_ОТ_OPENAI') {
        try {
            // Динамический импорт openai (если установлен, нужно добавить в package.json если будут юзать ИИ)
            // Но пока используем простую заглушку для fetch API если нет библиотеки, либо можем сделать fetch
            console.log('Найден API-ключ OpenAI, генерация через ИИ...');
            usingAI = true;
        } catch (e) {
            console.log('ИИ API выбран, но нет библиотеки. Переключаемся на шаблоны.');
        }
    } else {
        console.log('Ключ OpenAI не найден. Использую генерацию базовых шаблонов.');
    }

    for (let i = 0; i < showrooms.length; i++) {
        const sr = showrooms[i];
        if (sr.bio && sr.bio.length > 10) continue; // УЖЕ сгенерировано

        if (usingAI) {
            try {
                // Прямой HTTP запрос к OpenAI API
                const resp = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
                    body: JSON.stringify({
                        model: "gpt-3.5-turbo",
                        messages: [{
                            role: "user", 
                            content: `Write a short, compelling Bio (profile description) in English for a Taplink page of a UAE car showroom called "${sr.name}". 2-3 sentences. Mention luxury car sales and rentals in the UAE.`
                        }]
                    })
                });
                const data = await resp.json();
                if (data.choices && data.choices[0]) {
                    sr.bio = data.choices[0].message.content.trim();
                } else {
                    sr.bio = generateFallbackBio(sr);
                }
            } catch (err) {
                console.error(`Ошибка AI для ${sr.name}:`, err);
                sr.bio = generateFallbackBio(sr);
            }
        } else {
            sr.bio = generateFallbackBio(sr);
        }
        console.log(`[${i+1}/${showrooms.length}] Сгенерировано Bio для: ${sr.name}`);
    }

    fs.writeFileSync(dataPath, JSON.stringify(showrooms, null, 2), 'utf-8');
    console.log('\n[Готово] Описания (Bio) добавлены в showrooms_data.json!');
}

run();
