import { getGatewayConfig } from './config';
import { startDeliveryWorker } from './delivery';
import { startGatewayHttpServer } from './http-server';
import { startQQBotAdapter } from './qqbot-adapter';

const config = getGatewayConfig();

startDeliveryWorker(config);
startGatewayHttpServer(config);

if (config.qqbotAppId && config.qqbotClientSecret) {
  startQQBotAdapter(config).catch(err =>
    console.error('[gateway] QQ Bot adapter failed to start:', err),
  );
} else {
  console.log('[gateway] QQ Bot adapter disabled (set OMNI_QQBOT_APPID and OMNI_QQBOT_CLIENTSECRET)');
}
