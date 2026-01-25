import { initDb, insertWords, getWordCount } from '../src/server/db.js';
import { toNumberedPinyin } from '../src/server/services/pinyin.js';
function decodeHtmlEntities(text) {
    return text
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
async function fetchHskLevel(level) {
    const url = `https://mandarinbean.com/new-hsk-${level}-word-list/`;
    console.log(`Fetching HSK ${level} from ${url}...`);
    const response = await fetch(url);
    const html = await response.text();
    return parseWordTable(html);
}
function parseWordTable(html) {
    const words = [];
    // Match table rows with 4 columns: number, hanzi, pinyin, english
    // Pattern: <td>1</td><td>汉字</td><td>pīnyīn</td><td>English</td>
    const rowRegex = /<tr[^>]*>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<td[^>]*>([^<]*)<\/td>\s*<\/tr>/gi;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
        const [, num, col2, col3, col4] = match;
        // Skip header rows (check if first column is not a number)
        if (!/^\d+$/.test(num.trim())) {
            continue;
        }
        // Clean up the extracted text and decode HTML entities
        const hanzi = decodeHtmlEntities(col2.trim());
        const pinyin = decodeHtmlEntities(col3.trim());
        const englishText = decodeHtmlEntities(col4.trim());
        // Skip if hanzi doesn't look like Chinese characters
        if (!/[\u4e00-\u9fff]/.test(hanzi)) {
            continue;
        }
        // Parse English translations (split by semicolon)
        const english = englishText
            .split(/[;]/)
            .map(s => s.trim())
            .filter(s => s.length > 0);
        if (english.length === 0) {
            continue;
        }
        words.push({ hanzi, pinyin, english });
    }
    return words;
}
async function importAllLevels() {
    // Initialize database first
    await initDb();
    const existingCount = getWordCount();
    if (existingCount > 0) {
        console.log(`Database already has ${existingCount} words. Skipping import.`);
        console.log('Delete data/memchin.db to reimport.');
        return;
    }
    let globalRank = 1;
    for (let level = 1; level <= 6; level++) {
        try {
            const rawWords = await fetchHskLevel(level);
            console.log(`Found ${rawWords.length} words for HSK ${level}`);
            const words = rawWords.map((raw, index) => ({
                hanzi: raw.hanzi,
                pinyin: raw.pinyin,
                pinyinNumbered: toNumberedPinyin(raw.pinyin),
                english: raw.english,
                hskLevel: level,
                frequencyRank: globalRank++,
            }));
            insertWords(words);
            console.log(`Imported ${words.length} words for HSK ${level}`);
        }
        catch (error) {
            console.error(`Failed to import HSK ${level}:`, error);
        }
    }
    const totalCount = getWordCount();
    console.log(`\nTotal words in database: ${totalCount}`);
}
// Run the import
importAllLevels().catch(console.error);
