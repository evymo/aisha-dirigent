/**
 * Shared RabbitMQ (AMQP) client for Edge Functions.
 *
 * Manages two exchange topologies:
 * 1. `aisha.pipeline` — multi-agent pipeline execution & events
 * 2. `aisha.blockchain` — transactional outbox → Cosmos chain sync (DLQ-enabled)
 *
 * Uses deno-amqp for Deno runtime compatibility.
 *
 * Environment:
 *   - RABBITMQ_URL (e.g. amqp://user:pass@rabbitmq:5672)
 *
 * Usage:
 *   import { publishPipelineTask, publishBlockchainSync } from "../_shared/mqClient.ts";
 *   await publishPipelineTask({ run_id, task_kind, agents, ... });
 *   await publishBlockchainSync({ audit_record_id, event_type, ... });
 *
 * @module
 */

interface AmqpConnectOptions {
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  vhost?: string;
}

interface AmqpChannel {
  declareExchange: (params: Record<string, unknown>) => Promise<unknown>;
  declareQueue: (params: Record<string, unknown>) => Promise<unknown>;
  bindQueue: (params: Record<string, unknown>) => Promise<unknown>;
  publish: (
    params: Record<string, unknown>,
    props: Record<string, unknown>,
    body: Uint8Array,
  ) => Promise<unknown>;
  close: () => Promise<unknown>;
}

interface AmqpConnection {
  openChannel: () => Promise<AmqpChannel>;
  close: () => Promise<unknown>;
}

type AmqpConnect = (options?: AmqpConnectOptions) => Promise<AmqpConnection>;

let cachedAmqpConnect: AmqpConnect | null = null;

/**
 * Lazily loads the JSR AMQP module (Deno 2.x compatible fork).
 * Caches the connect function for subsequent calls.
 */
async function getAmqpConnect(): Promise<AmqpConnect> {
  if (cachedAmqpConnect) {
    return cachedAmqpConnect;
  }

  try {
    const amqpModule = await import("jsr:@nashaddams/amqp@1.1.1");
    cachedAmqpConnect = amqpModule.connect as AmqpConnect;
    return cachedAmqpConnect;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`[mqClient] AMQP module unavailable: ${reason}`);
  }
}

/**
 * Parses an AMQP URL into connect options.
 * Supports: amqp://user:pass@host:port/vhost
 */
function parseAmqpUrl(url: string): AmqpConnectOptions {
  const parsed = new URL(url);
  return {
    hostname: parsed.hostname || "127.0.0.1",
    port: parsed.port ? Number(parsed.port) : 5672,
    username: parsed.username ? decodeURIComponent(parsed.username) : "guest",
    password: parsed.password ? decodeURIComponent(parsed.password) : "guest",
    vhost: parsed.pathname && parsed.pathname !== "/"
      ? decodeURIComponent(parsed.pathname.slice(1))
      : "/",
  };
}

// ============================================
// CONSTANTS — Pipeline
// ============================================

const EXCHANGE_NAME = "aisha.pipeline";
const QUEUE_EXECUTE = "aisha.pipeline.execute";
const QUEUE_EVENTS = "aisha.pipeline.events";

// ============================================
// CONSTANTS — Blockchain Sync (DLQ-enabled)
// ============================================

const BLOCKCHAIN_EXCHANGE = "aisha.blockchain";
const BLOCKCHAIN_QUEUE = "aisha.blockchain.sync";
const BLOCKCHAIN_DLX = "aisha.blockchain.dlx";
const BLOCKCHAIN_DLQ = "aisha.blockchain.sync.dlq";

// ============================================
// TYPES
// ============================================

/** Payload published when a multi-agent pipeline needs execution. */
export interface PipelineTaskMessage {
  run_id: string;
  task_kind: string;
  agents: string[];
  risk_profile: string;
  stop_conditions: Record<string, unknown>;
  story_id?: string | null;
  context_profile?: string;
  created_at: string;
}

/** Payload published for pipeline lifecycle events. */
export interface PipelineEventMessage {
  event_type: "completed" | "failed" | "blocked" | "awaiting_approval" | "step_completed";
  run_id: string;
  agent_slug?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/** Payload published when a blockchain_audit_record needs Cosmos chain sync. */
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

// ============================================
// CONNECTION MANAGEMENT
// ============================================

/**
 * Opens an AMQP connection + channel.
 * @throws If RABBITMQ_URL is not set or connection fails.
 */
async function openConnection() {
  const url = Deno.env.get("RABBITMQ_URL");
  if (!url) {
    throw new Error("[mqClient] RABBITMQ_URL environment variable is not set");
  }

  const options = parseAmqpUrl(url);
  const connect = await getAmqpConnect();
  const connection = await connect(options);
  const channel = await connection.openChannel();
  return { channel, connection };
}

/**
 * Opens channel + declares pipeline exchange and queues.
 * Returns both so the caller can publish and then close.
 */
async function getPipelineChannel() {
  const { channel, connection } = await openConnection();

  // Declare topic exchange (idempotent)
  await channel.declareExchange({ exchange: EXCHANGE_NAME, type: "topic", durable: true });

  // Declare queues (idempotent)
  await channel.declareQueue({ queue: QUEUE_EXECUTE, durable: true });
  await channel.declareQueue({ queue: QUEUE_EVENTS, durable: true });

  // Bind queues to exchange
  await channel.bindQueue({
    queue: QUEUE_EXECUTE,
    exchange: EXCHANGE_NAME,
    routingKey: "pipeline.execute.*",
  });
  await channel.bindQueue({
    queue: QUEUE_EVENTS,
    exchange: EXCHANGE_NAME,
    routingKey: "pipeline.event.*",
  });

  return { channel, connection };
}

/**
 * Opens channel + declares blockchain sync exchange, queue, and DLQ topology.
 *
 * Topology:
 *   aisha.blockchain (topic) → aisha.blockchain.sync (durable, DLQ-enabled)
 *   aisha.blockchain.dlx (fanout) → aisha.blockchain.sync.dlq (durable)
 *
 * Messages that exceed max retries or are rejected are routed to DLQ.
 */
async function getBlockchainChannel() {
  const { channel, connection } = await openConnection();

  // Dead letter exchange + queue (declare first so main queue can reference it)
  await channel.declareExchange({ exchange: BLOCKCHAIN_DLX, type: "fanout", durable: true });
  await channel.declareQueue({ queue: BLOCKCHAIN_DLQ, durable: true });
  await channel.bindQueue({
    queue: BLOCKCHAIN_DLQ,
    exchange: BLOCKCHAIN_DLX,
    routingKey: "",
  });

  // Main blockchain exchange + queue with DLQ routing
  await channel.declareExchange({ exchange: BLOCKCHAIN_EXCHANGE, type: "topic", durable: true });
  await channel.declareQueue({
    queue: BLOCKCHAIN_QUEUE,
    durable: true,
    arguments: {
      "x-dead-letter-exchange": BLOCKCHAIN_DLX,
      "x-message-ttl": 86_400_000, // 24h max age
    },
  });
  await channel.bindQueue({
    queue: BLOCKCHAIN_QUEUE,
    exchange: BLOCKCHAIN_EXCHANGE,
    routingKey: "blockchain.sync.#",
  });

  return { channel, connection };
}

// ============================================
// PUBLISH HELPERS
// ============================================

/**
 * Publishes a pipeline execution task to RabbitMQ.
 *
 * Called after route_task() returns a multi-agent pipeline.
 * Pipeline Executor (n8n WF_PIPELINE_EXECUTOR) consumes from this queue.
 *
 * @param message - Pipeline task payload with run_id, agents, etc.
 * @returns true if published successfully, false on failure (non-throwing).
 */
export async function publishPipelineTask(message: PipelineTaskMessage): Promise<boolean> {
  try {
    const { channel, connection } = await getPipelineChannel();

    const routingKey = `pipeline.execute.${message.task_kind}`;
    const body = new TextEncoder().encode(JSON.stringify(message));

    await channel.publish(
      { exchange: EXCHANGE_NAME, routingKey },
      { contentType: "application/json", deliveryMode: 2 },
      body,
    );

    await channel.close();
    await connection.close();

    return true;
  } catch (err) {
    console.error(
      "[mqClient] Failed to publish pipeline task:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Publishes a pipeline lifecycle event to RabbitMQ.
 *
 * Used by Pipeline Executor to signal completion, failure, or human approval needed.
 *
 * @param message - Event payload with event_type, run_id, etc.
 * @returns true if published successfully, false on failure (non-throwing).
 */
export async function publishPipelineEvent(message: PipelineEventMessage): Promise<boolean> {
  try {
    const { channel, connection } = await getPipelineChannel();

    const routingKey = `pipeline.event.${message.event_type}`;
    const body = new TextEncoder().encode(JSON.stringify(message));

    await channel.publish(
      { exchange: EXCHANGE_NAME, routingKey },
      { contentType: "application/json", deliveryMode: 2 },
      body,
    );

    await channel.close();
    await connection.close();

    return true;
  } catch (err) {
    console.error(
      "[mqClient] Failed to publish pipeline event:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Publishes a blockchain sync message to RabbitMQ.
 *
 * Called by blockchain-dispatch EF after picking queued outbox records.
 * WF_BLOCKCHAIN_SYNC (n8n) consumes from aisha.blockchain.sync queue.
 *
 * @param message - Blockchain audit record to sync to Cosmos chain.
 * @returns true if published successfully, false on failure (non-throwing).
 */
export async function publishBlockchainSync(message: BlockchainSyncMessage): Promise<boolean> {
  try {
    const { channel, connection } = await getBlockchainChannel();

    const routingKey = `blockchain.sync.${message.event_type}`;
    const body = new TextEncoder().encode(JSON.stringify(message));

    await channel.publish(
      { exchange: BLOCKCHAIN_EXCHANGE, routingKey },
      { contentType: "application/json", deliveryMode: 2 },
      body,
    );

    await channel.close();
    await connection.close();

    return true;
  } catch (err) {
    console.error(
      "[mqClient] Failed to publish blockchain sync:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}
