import { loadHubConfig } from './config';
import { startAdminServer } from './admin-server';
import { HubClient } from './hub/client';
import { logger } from './logger';
import { loadState } from './state';

async function main(): Promise<void> {
  const hub = new HubClient({ hub: loadHubConfig() });
  const state = loadState();

  await startAdminServer({
    hub,
    state,
    onRestartService: () => {
      logger.info('Admin: restart requested, exiting process');
      process.exit(0);
    },
  });
}

main().catch(error => {
  logger.error(`Failed to start account admin: ${error}`);
  process.exit(1);
});
