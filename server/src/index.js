import { loadConfig } from './config.js';
import { createStorage } from './storage.js';
import { createNotifier } from './notify.js';
import { createApp } from './app.js';

const config = loadConfig();
if (!config.botToken && !config.devAuth) {
  console.warn('[warn] BOT_TOKEN kosong dan DEV_AUTH mati: semua request akan ditolak 401.');
}
if (process.env.DEV_AUTH === '1' && config.production) {
  console.warn('[warn] DEV_AUTH=1 diabaikan karena NODE_ENV=production.');
}
const storage = createStorage(config);
const notifier = createNotifier(config);
const app = createApp({ config, storage, notifier });

const server = app.listen(config.port, config.host, () => {
  console.log(
    `GA inspection API di http://${config.host}:${config.port} | dev auth: ${config.devAuth ? 'ON' : 'off'} | notifikasi: ${config.notifyEnabled ? 'ON' : 'off'} | uploader: ${config.uploaderIds.size} | reviewer: ${config.reviewerIds.size}`,
  );
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      storage.close();
      process.exit(0);
    });
  });
}
