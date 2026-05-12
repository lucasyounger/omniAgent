import 'dotenv/config';

export type GatewayConfig = {
  port: number;
  omniApiBaseUrl: string;
  deliveryPollMs: number;
  pairingToken?: string;
  allowSenders: string[];
  oneBotHttpUrl?: string;
  qqbotAppId?: string;
  qqbotClientSecret?: string;
};

export function getGatewayConfig(): GatewayConfig {
  return {
    port: Number(process.env.OMNI_GATEWAY_PORT || 4120),
    omniApiBaseUrl: process.env.OMNI_API_BASE_URL || 'http://localhost:4111/api',
    deliveryPollMs: Number(process.env.OMNI_GATEWAY_DELIVERY_POLL_MS || 2_000),
    pairingToken: process.env.OMNI_GATEWAY_PAIRING_TOKEN,
    allowSenders: (process.env.OMNI_GATEWAY_ALLOW_SENDERS || '')
      .split(';')
      .map(item => item.trim())
      .filter(Boolean),
    oneBotHttpUrl: process.env.OMNI_ONEBOT_HTTP_URL,
    qqbotAppId: process.env.OMNI_QQBOT_APPID,
    qqbotClientSecret: process.env.OMNI_QQBOT_CLIENTSECRET,
  };
}
