import amqplib from 'amqplib';
import { config } from '../config.js';

export interface BlockchainSyncMessage {
  audit_record_id: string;
  correlation_id: string;
  event_type: string;
  reference_table: string;
  reference_id: string;
  token_transaction_id: string | null;
  retry_count: number;
  dispatched_at: string;
}

const QUEUE_NAME = 'aisha.blockchain.sync';

let _connection: amqplib.ChannelModel | null = null;
let _channel: amqplib.Channel | null = null;

async function getChannel(): Promise<amqplib.Channel> {
  if (_channel) return _channel;
  _connection = await amqplib.connect(config.rabbitmqUrl);
  _channel = await _connection.createChannel();
  await _channel.assertQueue(QUEUE_NAME, { durable: true });

  _connection.on('close', () => { _connection = null; _channel = null; });
  _connection.on('error', () => { _connection = null; _channel = null; });

  return _channel;
}

/** Publish a blockchain sync message to RabbitMQ. */
export async function publishBlockchainSync(message: BlockchainSyncMessage): Promise<boolean> {
  try {
    const ch = await getChannel();
    return ch.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), {
      persistent: true,
      correlationId: message.correlation_id,
    });
  } catch {
    // Reset connection on failure
    _channel = null;
    _connection = null;
    return false;
  }
}
