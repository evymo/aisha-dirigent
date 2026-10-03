/**
 * Shared types pro gate testy — vyhneme se `any` v assertions.
 */

export type N8nNode = {
  id: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number];
  onError?: string;
  credentials?: Record<string, unknown>;
  parameters?: {
    category?: string;
    functionName?: string;
    authMode?: string;
    rpcParams?: string;
    onError?: string;
    httpMethod?: string;
    path?: string;
    method?: string;
    url?: string;
    jsCode?: string;
    jsonBody?: string;
    sendBody?: boolean;
    responseMode?: string;
    options?: Record<string, unknown>;
    rules?: Record<string, unknown>;
    rule?: Record<string, unknown>;
    conditions?: Record<string, unknown>;
    fallbackOutput?: string;
    respondWith?: string;
    responseBody?: string;
  };
};

export type N8nConnectionTarget = {
  node: string;
  type: string;
  index: number;
};

export type N8nWorkflow = {
  name: string;
  nodes: N8nNode[];
  connections: Record<string, { main?: N8nConnectionTarget[][] }>;
  active?: boolean;
  settings?: Record<string, unknown>;
  tags?: string[];
  meta?: Record<string, unknown> & {
    purpose?: string;
    trigger?: string;
    event_sources?: string[];
  };
};

export type AppFromManifest = {
  name: string;
  composeFile: string;
  tags: Record<string, string | true>;
};
