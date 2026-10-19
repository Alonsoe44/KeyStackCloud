import { configFromEnv } from './config.js';
import { buildApp } from './app.js';

const config = configFromEnv();
const { app } = await buildApp(config);

const close = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
};

process.once('SIGINT', () => {
  void close('SIGINT').then(() => process.exit(0)).catch(() => process.exit(1));
});
process.once('SIGTERM', () => {
  void close('SIGTERM').then(() => process.exit(0)).catch(() => process.exit(1));
});

await app.listen({ host: config.host, port: config.port });
