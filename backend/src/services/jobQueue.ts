import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

// Redis connection config (falls back to in-memory if no Redis)
const redisConfig = config.redis.url
  ? { connection: { url: config.redis.url } }
  : undefined;

// Scan queue
export const scanQueue = redisConfig
  ? new Queue('scan', redisConfig)
  : null;

// Alert queue
export const alertQueue = redisConfig
  ? new Queue('alert', redisConfig)
  : null;

let scanWorker: Worker | null = null;
let alertWorker: Worker | null = null;

export interface ScanJobData {
  exchanges: string[];
  userId?: string;
  requestedAt: number;
}

export interface AlertJobData {
  type: 'evaluate' | 'send-notification';
  alertId?: string;
  userId?: string;
  data?: any;
}

export function initJobQueues(): void {
  if (!redisConfig) {
    logger.warn('Redis not configured — job queues disabled (using inline execution)');
    return;
  }

  // Scan worker
  scanWorker = new Worker(
    'scan',
    async (job: Job<ScanJobData>) => {
      logger.info({ jobId: job.id, exchanges: job.data.exchanges }, 'Processing scan job');
      const { runScan } = await import('./scanService.js');
      const { wsManager } = await import('./websocket.js');

      const startTime = Date.now();
      const result = await runScan(job.data.exchanges);
      const duration = Date.now() - startTime;

      // Broadcast via WebSocket
      wsManager.broadcast('scan', {
        exchanges: job.data.exchanges,
        scanned: result.scanned,
        highYieldCount: result.highYield.length,
        mediumYieldCount: result.mediumYield.length,
        duration,
      });

      return { scanned: result.scanned, duration };
    },
    {
      connection: redisConfig.connection,
      concurrency: 2,
      limiter: {
        max: 10,
        duration: 60_000,
      },
    }
  );

  scanWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, result: job.returnvalue }, 'Scan job completed');
  });

  scanWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'Scan job failed');
  });

  // Alert worker
  alertWorker = new Worker(
    'alert',
    async (job: Job<AlertJobData>) => {
      logger.info({ jobId: job.id, type: job.data.type }, 'Processing alert job');

      if (job.data.type === 'evaluate') {
        // Trigger alert evaluation by importing and running the evaluator
        const evaluator = await import('./alertEvaluator.js');
        // The evaluator runs on a timer, so we just log the trigger
        logger.info('Alert evaluation triggered via job queue');
      } else if (job.data.type === 'send-notification' && job.data.userId && job.data.data) {
        const { sendAlertNotification } = await import('./telegramNotify.js');
        const chatId = parseInt(job.data.userId.replace('tg_', ''), 10);
        if (chatId && !isNaN(chatId)) {
          await sendAlertNotification(chatId, job.data.data.alertType, job.data.data);
        }
      }

      return { success: true };
    },
    {
      connection: redisConfig.connection,
      concurrency: 5,
    }
  );

  alertWorker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'Alert job completed');
  });

  alertWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'Alert job failed');
  });

  logger.info('Job queues initialized (BullMQ + Redis)');
}

export async function addScanJob(exchanges: string[], userId?: string): Promise<string | null> {
  if (!scanQueue) return null;

  const job = await scanQueue.add(
    'scan',
    { exchanges, userId, requestedAt: Date.now() },
    {
      priority: userId ? 1 : 2, // User-initiated scans have higher priority
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  logger.info({ jobId: job.id, exchanges }, 'Scan job queued');
  return job.id ?? null;
}

export async function addAlertEvaluationJob(): Promise<string | null> {
  if (!alertQueue) return null;

  const job = await alertQueue.add(
    'evaluate',
    { type: 'evaluate' as const },
    {
      priority: 3,
      attempts: 1,
      removeOnComplete: { count: 50 },
    }
  );

  return job.id ?? null;
}

export async function getJobStats(): Promise<{
  scan: { waiting: number; active: number; completed: number; failed: number };
  alert: { waiting: number; active: number; completed: number; failed: number };
} | null> {
  if (!scanQueue || !alertQueue) return null;

  const [scanWaiting, scanActive, scanCompleted, scanFailed] = await Promise.all([
    scanQueue.getWaitingCount(),
    scanQueue.getActiveCount(),
    scanQueue.getCompletedCount(),
    scanQueue.getFailedCount(),
  ]);

  const [alertWaiting, alertActive, alertCompleted, alertFailed] = await Promise.all([
    alertQueue.getWaitingCount(),
    alertQueue.getActiveCount(),
    alertQueue.getCompletedCount(),
    alertQueue.getFailedCount(),
  ]);

  return {
    scan: { waiting: scanWaiting, active: scanActive, completed: scanCompleted, failed: scanFailed },
    alert: { waiting: alertWaiting, active: alertActive, completed: alertCompleted, failed: alertFailed },
  };
}

export async function shutdownJobQueues(): Promise<void> {
  if (scanWorker) await scanWorker.close();
  if (alertWorker) await alertWorker.close();
  if (scanQueue) await scanQueue.close();
  if (alertQueue) await alertQueue.close();
  logger.info('Job queues shut down');
}
