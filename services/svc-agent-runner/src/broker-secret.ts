import { config } from './config.js';

const MIN_SECRET_BYTES = 32;

export function getBrokerSecretBytes(): Uint8Array {
  const secret = config.brokerTokenSecret;
  if (!secret) {
    throw new Error('BROKER_TOKEN_SECRET is required for plugin sandbox broker tokens');
  }
  if (secret.length < MIN_SECRET_BYTES) {
    throw new Error(`BROKER_TOKEN_SECRET must be at least ${MIN_SECRET_BYTES} characters`);
  }
  return new TextEncoder().encode(secret);
}

export function assertBrokerSecretConfigured(): void {
  void getBrokerSecretBytes();
}
