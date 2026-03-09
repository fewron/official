const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const JSON_PATH = './data/places.json';
const CSV_PATH = './manage.csv';
const DOMAIN = 'https://fewron.jp';
const STRIPE_LINK = 'https://buy.stripe.com/eVq6oH4Wi4MLbjb3A93Je00'; // Stripeリンク

// エリアと業種（既存の設定を維持）
const AREAS = ['吹田', '江坂', '摂津', '岡山市', '石川', '熊本'];
const GENRES = ['居酒屋', '和食', 'ラーメン', '食堂', 'カフェ'];
const SEARCH_QUERIES = AREAS.flatMap(area => GENRES.map(genre => `${area} ${genre}`));

async function main() {
    try {
        if (!API_KEY) return console.error('❌ APIキーが設定されていません');
        await fs.ensureDir('./data');
        await fs.ensureDir('./shops');

        let savedPlaces = [];
        if (await fs.pathExists(JSON_PATH)) {
            savedPlaces = await fs.readJson(JSON_PATH);
        }

        const currentYear = new Date().getFullYear();

        // 既存のチェーン店除外リスト
        const chainBlacklist = [
            'マクドナルド', 'サイゼリヤ', 'ガスト', '吉野家', 'すき家', '松屋',
            'くら寿司', 'スシロー', 'はま寿司', '丸亀製麺', 'ミスタードーナツ',
            'スターバックス', 'ドトール', 'コメダ珈琲', '餃子の王将', '天下一品',
            '鳥貴族', '王将', 'モスバーガー', 'ケンタッキー', 'CoCo壱番屋', '大戸屋', 'やよい軒',
            'JR', '牛角', 'ココス', 'ローソン', 'セブンイレブン', 'ファミリーマート', 'コスモス'
        ];

        for (const query of SEARCH_QUERIES) {
            console.log(`🔎 検索中: ${query}`);
            const searchRes = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json`, {
                params: { query: query, key: API_KEY, language: 'ja' }
            });
            if (!searchRes.data.results) continue;

            for (const place of searchRes.data.results) {
                const placeName = place.name || "";

                // 重複・サイトあり・チェーン店のスキップ
                if (savedPlaces.some(p => p.place_id === place.place_id)) continue;
                if (place.website) continue;
                if (chainBlacklist.some(keyword => placeName.includes(keyword))) continue;

                // 支店・〇〇店の除外ロジック（既存維持）
                if (placeName.endsWith('店') || placeName.includes('支店') || placeName.includes('直営')) {
                    const exceptions = ['酒店', '商店', '工務店', '精肉店', '鮮魚店'];
                    if (!exceptions.some(ex => placeName.endsWith(ex))) continue;
                }

                // 詳細情報の取得（評価・クチコミ数を追加取得）
                const details = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json`, {
                    params: {
                        place_id: place.place_id,
                        fields: 'name,formatted_address,formatted_phone_number,place_id,types,rating,user_ratings_total',
                        key: API_KEY,
                        language: 'ja'
                    }
                });

                const data = details.data.result;
                if (!data) continue;

                // テンプレート選択ロジック
                let tempName = 'default.html';
                const types = data.types || [];
                const finalName = data.name || "";

                if (types.includes('ramen_restaurant') || /ラーメン|らーめん|中華そば|麺/.test(finalName)) {
                    tempName = 'ramen.html';
                } else if (types.includes('cafe') || /カフェ|Cafe|喫茶/.test(finalName)) {
                    tempName = 'cafe.html';
                } else if (types.includes('bar') || /居酒屋|バル|酒場/.test(finalName)) {
                    tempName = 'izakaya.html';
                } else if (finalName.includes('和食') || finalName.includes('寿司')) {
                    tempName = 'wahoku.html';
                } else if (finalName.includes('食堂')) {
                    tempName = 'shokudo.html';
                }

                if (!await fs.pathExists(path.join('template', tempName))) tempName = 'default.html';
                const template = await fs.readFile(path.join('template', tempName), 'utf-8');

                // Stripe連携URL（place_idを付与）
                const paymentUrl = `${STRIPE_LINK}?client_reference_id=${data.place_id}`;

                // HTML置換処理
                const html = template
                    .replace(/{{NAME}}/g, data.name)
                    .replace(/{{ADDRESS}}/g, data.formatted_address)
                    .replace(/{{PHONE}}/g, data.formatted_phone_number || '情報なし')
                    .replace(/{{RATING}}/g, data.rating || 'ー')
                    .replace(/{{REVIEWS}}/g, data.user_ratings_total || '0')
                    .replace(/{{PAYMENT_URL}}/g, paymentUrl)
                    .replace(/{{IS_PAID}}/g, "false") // デフォルトは文字列の"false"
                    .replace(/{{YEAR}}/g, currentYear);

                const shortId = data.place_id.substring(0, 8);
                const fileName = `${shortId}.html`;
                await fs.writeFile(`./shops/${fileName}`, html);

                // 管理用データの保存
                savedPlaces.push({
                    place_id: data.place_id,
                    name: data.name,
                    fileName: fileName
                });

                // CSV保存（決済ステータス列を追加）
                const targetUrl = `${DOMAIN}/shops/${fileName}`;
                const csvLine = `"${data.name}","${data.formatted_phone_number || 'N/A'}","${targetUrl}","${query}","未決済"\n`;

                if (!await fs.pathExists(CSV_PATH)) {
                    await fs.writeFile(CSV_PATH, '店名,電話番号,発行URL,取得元エリア業種,決済ステータス\n');
                }
                await fs.appendFile(CSV_PATH, csvLine);

                console.log(`✅ 新規生成: ${data.name} (${query})`);
            }
        }

        await fs.writeJson(JSON_PATH, savedPlaces, { spaces: 2 });
        console.log('--- 全ての生成工程が完了しました ---');

    } catch (err) {
        console.error('致命的エラー:', err.message);
        process.exit(1);
    }
}

main();