import { bot } from './bot.js';
import { config } from './config.js';
import { cleanupOrphans } from './downloader.js';
import { drainQueue } from './queue.js';

process.on('unhandledRejection', (reason) => {
  console.error('[index] unhandledRejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[index] uncaughtException:', err);
});

async function main() {
  console.log('[index] Запуск YouTube-бота…');
  console.log(`[index] tmpDir=${config.tmpDir}, concurrency=${config.queueConcurrency}`);

  await cleanupOrphans();

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[index] Получен ${signal}, завершаюсь…`);
    try {
      await bot.stop();
      await drainQueue(20000);
    } catch (e) {
      console.error('[index] Ошибка при завершении:', e.message);
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  startWatchdog();

  await bot.start({
    drop_pending_updates: true,
    onStart: (info) => console.log(`[index] Бот @${info.username} запущен.`),
  });
}

// Сторож: если у Telegram копятся непрочитанные сообщения, бот перестал их забирать
// (процесс жив, а сообщения не читаются). Три проверки подряд (15 минут) — выходим,
// pm2 поднимет заново.
function startWatchdog() {
  let strikes = 0;
  setInterval(async () => {
    try {
      const info = await bot.api.getWebhookInfo();
      strikes = info.pending_update_count > 0 ? strikes + 1 : 0;
      if (strikes >= 3) {
        console.error(`[watchdog] ${info.pending_update_count} сообщений не забраны 15 минут — перезапуск`);
        process.exit(1);
      }
    } catch (e) {
      console.error('[watchdog] проверка не удалась:', e.message);
    }
  }, 5 * 60_000);
}

main().catch((err) => {
  console.error('[index] Фатальная ошибка запуска:', err);
  process.exit(1);
});
