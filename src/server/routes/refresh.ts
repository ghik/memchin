import { Router } from 'express';
import {
  DEFAULT_REFRESH_OPTIONS,
  getRefreshStatus,
  selectWords,
  startRefresh,
  stopRefresh,
} from '../services/word-refresh.js';
import type { RefreshOptions } from '../services/word-refresh.js';
import type { PracticeMode } from '../../shared/types.js';

const PRACTICE_MODES: PracticeMode[] = ['hanzi2pinyin', 'english2pinyin', 'english2hanzi'];

function parseOptions(body: Record<string, unknown>): RefreshOptions {
  const options = { ...DEFAULT_REFRESH_OPTIONS };
  if (body.mode !== undefined) {
    if (!PRACTICE_MODES.includes(body.mode as PracticeMode)) {
      throw new Error(`mode must be one of: ${PRACTICE_MODES.join(', ')}`);
    }
    options.mode = body.mode as PracticeMode;
  }
  if (body.characterMode !== undefined) {
    options.characterMode = Boolean(body.characterMode);
  }
  if (body.limit !== undefined && body.limit !== null) {
    const limit = Number(body.limit);
    if (!Number.isFinite(limit) || limit < 1) {
      throw new Error('limit must be a positive number');
    }
    options.limit = limit;
  }
  if (body.concurrency !== undefined) {
    const concurrency = Number(body.concurrency);
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be a positive number');
    }
    options.concurrency = concurrency;
  }
  options.force = Boolean(body.force);
  options.skipInfer = Boolean(body.skipInfer);
  options.skipExamples = Boolean(body.skipExamples);
  return options;
}

const router = Router();

router.post('/start', (req, res) => {
  try {
    res.json(startRefresh(parseOptions(req.body ?? {})));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to start' });
  }
});

// What a job with these options would work through, without starting one
router.post('/preview', (req, res) => {
  try {
    const options = parseOptions(req.body ?? {});
    const { queue, pending } = selectWords(options);
    res.json({ options, queueSize: queue.length, hanzi: pending.map((word) => word.hanzi) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to preview' });
  }
});

router.get('/status', (req, res) => {
  res.json(getRefreshStatus(Number(req.query.since) || 0));
});

router.post('/stop', (_req, res) => {
  res.json(stopRefresh());
});

export default router;
