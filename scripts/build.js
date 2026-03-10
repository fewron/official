const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

// ==========================================
// 設定エリア
// ==========================================

// 1. 収集用APIキー（.envから読み込み / 制限なし or IP制限）
const COLLECT_KEY = process.env.GOOGLE_MAPS_API_KEY;

// 2. 表示用APIキー（HTML埋め込み用 / HTTPリファラー制限済み）
// 💡 公開用のAPIキーをここに貼り付けてください
const PUBLIC_MAP_KEY = "ここに表示用のAPIキーを書く";

const JSON_PATH = './data/places.json';
const CSV_PATH = './manage.csv';
const DOMAIN = 'https://fewron.jp';
const STRIPE_LINK = 'https://buy.stripe.com/eVq6oH4Wi4MLbjb3A93Je00';

// 🇯🇵 日本全国 47都道府県
const AREAS = [
    '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
    '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
    '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県',
    '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県',
    '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県',
    '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県',
    '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

// ターゲット業種（インスタ親和性の高いもの）
const GENRES = ['居酒屋', 'ラーメン', 'カフェ', 'イタリアン', 'フレンチ', '焼肉', '美容室'];

// 全都道府県 × 全業種のクエリを生成（47 × 7 = 329パターン）
const SEARCH_QUERIES = AREAS.flatMap(area => GENRES.map(genre => `${area} ${genre}`));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    let generatedCount = 0;
    const MAX_GENERATE = 20; // 💡 全国展開時は1回の取得件数を少し多め（20〜50）にすると効率的です

    try {
        if (!COLLECT_KEY) return console.error('❌ 収集用APIキーが設定されていません');

        const rootDir = process.cwd();
        await fs.ensureDir(path.join(rootDir, 'data'));
        await fs.ensureDir(path.join(rootDir, 'shops'));

        let savedPlaces = [];
        const absJsonPath = path.join(rootDir, JSON_PATH);
        if (await fs.pathExists(absJsonPath)) {
            savedPlaces = await fs.readJson(absJsonPath);
        }

        const currentYear = new Date().getFullYear();

        // 検索クエリをランダムにシャッフル（毎回同じ都道府県から始まらないようにするため）
        const shuffledQueries = SEARCH_QUERIES.sort(() => Math.random() - 0.5);

        for (const query of shuffledQueries) {
            if (generatedCount >= MAX_GENERATE) break;

            console.log(`🔎 検索中: ${query}`);
            const searchRes = await axios.get(`https://maps.googleapis.com/maps/api/place/textsearch/json`, {
                params: { query: query, key: COLLECT_KEY, language: 'ja' }
            });

            if (!searchRes.data.results || searchRes.data.results.length === 0) continue;

            for (const place of searchRes.data.results) {
                if (generatedCount >= MAX_GENERATE) break;

                // 重複チェック
                if (savedPlaces.some(p => p.place_id === place.place_id)) continue;

                console.log(`--- 調査中: ${place.name} ---`);
                await sleep(300);

                try {
                    const details = await axios.get(`https://maps.googleapis.com/maps/api/place/details/json`, {
                        params: {
                            place_id: place.place_id,
                            fields: 'name,formatted_address,formatted_phone_number,place_id,types,rating,user_ratings_total,website',
                            key: COLLECT_KEY,
                            language: 'ja'
                        }
                    });

                    const data = details.data.result;
                    if (!data) continue;

                    // --- インスタ必須判定 ---
                    let instaUrl = 'なし';
                    let tabelogUrl = 'なし';

                    if (data.website) {
                        const ws = data.website;
                        if (ws.includes('instagram.com')) {
                            instaUrl = ws;
                        } else if (ws.includes('tabelog.com')) {
                            tabelogUrl = ws;
                        } else {
                            console.log(`  ⏩ スキップ: 独自サイトあり (${ws})`);
                            continue;
                        }
                    }

                    if (instaUrl === 'なし') {
                        console.log(`  ❌ インスタ未設定のためスキップ`);
                        continue;
                    }

                    console.log(`  📸 インスタ発見: ${instaUrl}`);

                    // --- テンプレート判定 ---
                    let tempName = 'default.html';
                    const types = data.types || [];
                    const name = data.name || "";
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
                        .replace(/{{MAP_QUERY}}/g, encodeURIComponent(data.formatted_address || data.name))
                        .replace(/{{GOOGLE_MAPS_API_KEY}}/g, PUBLIC_MAP_KEY)
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

                    // --- 営業メッセージ作成 ---
                    const message = `${data.name}様 突然のご連絡失礼いたします。Fewronの横山恒正です。現在、${data.name}様の情報を拝見し、インターネットからの集客を最大化するための「${data.name}様専用のホームページ」を独自に作成いたしました。 ▼${data.name}様専用ページ ${targetUrl} こちらの写真等はデモ画像ですが、月4,980円のみ、初期費用、変更費用全て0円で、食べログ等では表現しきれない「お店の雰囲気」を全面に出したデザインに変更し、自動運用してまいります。 現在、地域の数店舗限定で無料提供しておりますので、ぜひ一度ご確認いただけますと幸いです。ご興味がございましたら折り返しご連絡いただけると幸いです。`;

                    const csvLine = `"${data.name}","${data.formatted_phone_number || 'N/A'}","${instaUrl}","${tabelogUrl}","${targetUrl}","${message}","${query}","未決済"\n`;
                    const absCsvPath = path.join(rootDir, CSV_PATH);
                    if (!await fs.pathExists(absCsvPath)) {
                        await fs.writeFile(absCsvPath, '店名,電話番号,インスタURL,食べログURL,発行URL,営業メッセージ,取得元エリア業種,決済ステータス\n');
                    }
                    await fs.appendFile(absCsvPath, csvLine);

                    console.log(`  ✅ 生成完了 (${tempName}): ${fileName}`);
                    generatedCount++;

                } catch (innerErr) {
                    console.error(`  ❌ 個別エラー: ${innerErr.message}`);
                }
            }
        }

        await fs.writeJson(absJsonPath, savedPlaces, { spaces: 2 });
        console.log(`--- 全国対象：合計 ${generatedCount} 件の生成が完了しました ---`);

    } catch (err) {
        console.error('致命的エラー:', err.message);
    }
}

main();