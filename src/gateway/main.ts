import { startConfiguredGatewayAdapters } from './adapter-registry';
import { getGatewayConfig } from './config';
import { startDeliveryWorker } from './delivery';
import { startGatewayHttpServer } from './http-server';

const config = getGatewayConfig();

startDeliveryWorker(config);
startGatewayHttpServer(config);
void startConfiguredGatewayAdapters(config, { exclude: ['http'] });
