/**
 * The one OpenAI client, so the account settings are stated once rather than in every service
 * that happens to make a call.
 *
 * Importing this throws when OPENAI_API_KEY is unset — that is the SDK's behaviour, not ours, and
 * it is why the pure parsers (sentence-verdict.ts, word-picks.ts) are kept in files of their own:
 * they can then be tested without a key, since nothing on their import path reaches here.
 */
import OpenAI from 'openai';

/** Which project the calls are billed and logged to */
const PROJECT = 'proj_1N8GBLfBrsBL6Jg0ND2SC2ai';

export const openai = new OpenAI({ project: PROJECT });
