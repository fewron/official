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

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    let generatedCount = 0; // 💡 生成件数カウンター
    const MAX_GENERATE = 10; // 💡 最大10件

    try {
        if (!API_KEY) return console.error('❌ APIキーが設定されていません');

        const rootDir = process.cwd();
        await fs.ensureDir(path.join(rootDir, 'data'));
        await fs.ensureDir(path.join(rootDir, 'shops'));

        let savedPlaces = [];
        const absJsonPath = path.join(rootDir, JSON_PATH);
        if (await fs.pathExists(absJsonPath)) {
            savedPlaces = await fs.readJson(absJsonPath);
        }

        const currentYear = new Date().getFullYear();

        for (const query of SEARCH_QUERIES) {
            if (generatedCount >= MAX_GENERATE) break; // 💡 10件超えたら検索ループを抜ける

            console.log(`🔎 検索中: ${query}`);
            const searchRes = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json`, {
                params: { query: query, key: API_KEY, language: 'ja' }
            });

            if (!searchRes.data.results || searchRes.data.results.length === 0) continue;

            for (const place of searchRes.data.results) {
                if (generatedCount >= MAX_GENERATE) break; // 💡 10件超えたら店舗ループを抜ける
                if (savedPlaces.some(p => p.place_id === place.place_id)) continue;

                console.log(`--- 調査中: ${place.name} ---`);
                await sleep(300);

                try {
                    const details = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json`, {
                        params: {
                            place_id: place.place_id,
                            fields: 'name,formatted_address,formatted_phone_number,place_id,types,rating,user_ratings_total,website',
                            key: API_KEY,
                            language: 'ja'
                        }
                    });

                    const data = details.data.result;
                    if (!data) continue;

                    // 💡 Instagram判定ロジックの追加
                    if (data.website) {
                        const isInstagram = data.website.includes('instagram.com');
                        if (isInstagram) {
                            console.log(`  📸 インスタ発見！(サイトなしと判定して続行)`);
                        } else {
                            console.log(`  ⏩ スキップ: 公式サイトあり (${data.website})`);
                            continue;
                        }
                    }

                    // --- テンプレート自動判定 ---
                    // --- 強化版：テンプレート自動判定ロジック ---
                    let tempName = 'default.html';
                    const types = data.types || [];
                    const name = data.name || "";

                    // 判定用ヘルパー
                    const hasType = (t) => types.includes(t);
                    const hasName = (re) => re.test(name);

                    if (hasType('ramen_restaurant') || hasName(/ラーメン|らーめん|中華そば|担々麺|つけ麺|麺屋|拉麺/)) {
                        tempName = 'ramen.html';
                    } else if (hasType('cafe') || hasType('bakery') || hasName(/カフェ|喫茶|スイーツ|デザート|パンケーキ|珈琲|コーヒー|焙煎/)) {
                        tempName = 'cafe.html';
                    } else if (hasType('bar') || hasType('night_club') || hasName(/居酒屋|酒場|バル|飲み処|串カツ|焼鳥|個室居酒屋|ダイニング/)) {
                        tempName = 'izakaya.html';
                    } else if (hasType('sushi_restaurant') || hasName(/和食|寿司|すし|割烹|日本料理|懐石|そば|蕎麦|うどん|天ぷら/)) {
                        tempName = 'wahoku.html';
                    } else if (hasName(/食堂|定食|めし|キッチン|亭|ごはん/)) {
                        tempName = 'shokudo.html';
                    }

                    // テンプレートファイルの存在確認
                    const templatePath = path.join(rootDir, 'template', tempName);
                    let finalPath = templatePath;
                    if (!await fs.pathExists(templatePath)) {
                        finalPath = path.join(rootDir, 'template', 'default.html');
                    }

                    const templateHtml = await fs.readFile(finalPath, 'utf-8');
                    const paymentUrl = `${STRIPE_LINK}?client_reference_id=${data.place_id}`;
                    const html = templateHtml
                        .replace(/{{NAME}}/g, data.name || '')
                        .replace(/{{ADDRESS}}/g, data.formatted_address || '')
                        // 💡 ここに下の1行を追加！
                        .replace(/{{MAP_QUERY}}/g, encodeURIComponent(data.formatted_address || data.name))
                        .replace(/{{PHONE}}/g, data.formatted_phone_number || '情報なし')
                        .replace(/{{RATING}}/g, data.rating || 'ー')
                        .replace(/{{REVIEWS}}/g, data.user_ratings_total || '0')
                        .replace(/{{PAYMENT_URL}}/g, paymentUrl)
                        .replace(/{{IS_PAID}}/g, "false")
                        .replace(/{{YEAR}}/g, currentYear);

                    const shortId = data.place_id.substring(0, 8);
                    const fileName = `${shortId}.html`;
                    await fs.writeFile(path.join(rootDir, 'shops', fileName), html);

                    savedPlaces.push({ place_id: data.place_id, name: data.name, fileName: fileName });

                    const targetUrl = `${DOMAIN}/shops/${fileName}`;
                    const csvLine = `"${data.name}","${data.formatted_phone_number || 'N/A'}","${targetUrl}","${query}","未決済"\n`;
                    const absCsvPath = path.join(rootDir, CSV_PATH);
                    if (!await fs.pathExists(absCsvPath)) {
                        await fs.writeFile(absCsvPath, '店名,電話番号,発行URL,取得元エリア業種,決済ステータス\n');
                    }
                    await fs.appendFile(absCsvPath, csvLine);

                    console.log(`  ✅ 生成完了 (${tempName}): ${fileName}`);
                    generatedCount++; // 💡 生成に成功したらカウントアップ

                } catch (innerErr) {
                    console.error(`  ❌ 個別エラー: ${innerErr.message}`);
                }
            }
        }

        await fs.writeJson(absJsonPath, savedPlaces, { spaces: 2 });
        console.log(`--- 合計 ${generatedCount} 件の生成が完了しました ---`);

    } catch (err) {
        console.error('致命的エラー:', err.message);
    }
}

main();