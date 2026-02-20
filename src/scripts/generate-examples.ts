import OpenAI from 'openai';
import type { Example, WordCore } from '../shared/types.js';

const openai = new OpenAI();

export interface ExampleResponse {
  hanzi: string;
  examples: Example[];
}

export const MAX_RETRIES = 10;

export async function generateExamples(words: WordCore[]): Promise<Map<string, Example[]>> {
  const wordList = words
    .map((w) => `${w.hanzi} (${w.pinyin}) [HSK ${w.hskLevel}]: ${w.english.join(', ')}`)
    .join('\n');

  const prompt = `Generate 3 example sentences for each Chinese word below. The pinyin and English meaning are provided for each word — use the pinyin to identify the correct pronunciation and meaning (many characters have multiple readings).

Each set of 3 examples should be graduated in complexity:
1. A short phrase or simple expression (3-8 characters) — does not need to be a full sentence
2. A short sentence (5-12 characters) with a subject and verb
3. A longer, more complex sentence (12-30 characters) demonstrating natural, real-world usage

The second and third examples should:
- Be proper sentences with at least a subject and verb
- Use simple vocabulary: only words at or below the same HSK level as the target word, unless a more advanced word is necessary to provide proper context
- Clearly demonstrate the meaning indicated by the provided pinyin
- Each show a different usage or context for the word

For each word, provide the examples in hanzi, pinyin (with tone marks), and English translation.

Output format - one JSON array, no other text:
[{"hanzi": "爱", "examples": [{"hanzi": "我爱你", "pinyin": "wǒ ài nǐ", "english": "I love you"}, {"hanzi": "她很爱吃苹果", "pinyin": "tā hěn ài chī píngguǒ", "english": "She really loves eating apples"}, {"hanzi": "我爱我的家人，他们让我很开心", "pinyin": "wǒ ài wǒ de jiārén, tāmen ràng wǒ hěn kāixīn", "english": "I love my family, they make me very happy"}]}, ...]

Words:
${wordList}`;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 16384,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    console.log(`LLM output:\n${content}\n`);

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = content.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const parsed: ExampleResponse[] = JSON.parse(jsonText);
      const result = new Map<string, Example[]>();
      for (const item of parsed) {
        result.set(item.hanzi, item.examples);
      }

      return result;
    } catch (error) {
      if (attempt < MAX_RETRIES) {
        console.warn(`JSON parsing failed (attempt ${attempt}/${MAX_RETRIES}), retrying...`);
      } else {
        throw new Error(`Failed to parse JSON after ${MAX_RETRIES} attempts: ${error}`);
      }
    }
  }

  // Should never reach here, but TypeScript needs this
  throw new Error('Unexpected error in generateExamples');
}
