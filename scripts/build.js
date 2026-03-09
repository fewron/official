const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const JSON_PATH = './data/places.json';
const CSV_PATH = './manage.csv';
const DOMAIN = 'https://fewron.jp';
const STRIPE_LINK = 'https://buy.stripe.com/eVq6oH4Wi4MLbjb3A93Je00';

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

        for (const query of SEARCH_QUERIES) {
            console.log(`🔎 検索中: ${query}`);
            const searchRes = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json`, {
                params: { query: query, key: API_KEY, language: 'ja' }
            });

            if (!searchRes.data.results || searchRes.data.results.length === 0) {
                console.log(`  └ 検索結果0件でした`);
                continue;
            }

            for (const place of searchRes.data.results) {
                console.log(`--- 調査中: ${place.name} ---`);

                // 1. 重複チェック
                if (savedPlaces.some(p => p.place_id === place.place_id)) {
                    console.log(`  ⏩ スキップ: 既に生成済みです`);
                    continue;
                }

                // 2. 詳細情報の取得
                const details = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json`, {
                    params: {
                        place_id: place.place_id,
                        fields: 'name,formatted_address,formatted_phone_number,place_id,types,rating,user_ratings_total,website',
                        key: API_KEY,
                        language: 'ja'
                    }
                });

                const data = details.data.result;
                if (!data) {
                    console.log(`  ❌ 詳細データ取得失敗`);
                    continue;
                }

                // 3. Webサイトありチェック（テストのためにログだけ出して続行する場合はここをコメントアウト）
                if (data.website) {
                    console.log(`  ⏩ スキップ: サイトあり (${data.website})`);
                    continue;
                }

                // 4. テンプレート選択（ファイルがない場合は cafe.html を使う安全策）
                let tempName = 'cafe.html';
                // フォルダ構成に合わせて path.join の引数を調整してください
                // もし直下に cafe.html があるなら './cafe.html'
                const templatePath = path.join(__dirname, '../cafe.html');

                if (!await fs.pathExists(templatePath)) {
                    console.error(`  ❌ テンプレートファイルが見つかりません: ${templatePath}`);
                    continue;
                }

                const templateHtml = await fs.readFile(templatePath, 'utf-8');

                // 5. HTML生成
                const paymentUrl = `${STRIPE_LINK}?client_reference_id=${data.place_id}`;
                const html = templateHtml
                    .replace(/{{NAME}}/g, data.name || '')
                    .replace(/{{ADDRESS}}/g, data.formatted_address || '')
                    .replace(/{{PHONE}}/g, data.formatted_phone_number || '情報なし')
                    .replace(/{{RATING}}/g, data.rating || 'ー')
                    .replace(/{{REVIEWS}}/g, data.user_ratings_total || '0')
                    .replace(/{{PAYMENT_URL}}/g, paymentUrl)
                    .replace(/{{IS_PAID}}/g, "false")
                    .replace(/{{YEAR}}/g, currentYear);

                const shortId = data.place_id.substring(0, 8);
                const fileName = `${shortId}.html`;
                await fs.writeFile(`./shops/${fileName}`, html);

                // 6. データの保存
                savedPlaces.push({
                    place_id: data.place_id,
                    name: data.name,
                    fileName: fileName
                });

                const targetUrl = `${DOMAIN}/shops/${fileName}`;
                const csvLine = `"${data.name}","${data.formatted_phone_number || 'N/A'}","${targetUrl}","${query}","未決済"\n`;

                if (!await fs.pathExists(CSV_PATH)) {
                    await fs.writeFile(CSV_PATH, '店名,電話番号,発行URL,取得元エリア業種,決済ステータス\n');
                }
                await fs.appendFile(CSV_PATH, csvLine);

                console.log(`  ✅ 新規生成完了! -> ${fileName}`);
            }
        }

        await fs.writeJson(JSON_PATH, savedPlaces, { spaces: 2 });
        console.log('--- 全ての工程が完了しました ---');

    } catch (err) {
        console.error('致命的エラー:', err.message);
    }
}

main();