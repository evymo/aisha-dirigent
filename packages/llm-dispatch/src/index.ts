/**
 * @aisha/llm-dispatch — multi-provider LLM dispatch.
 *
 * BackendRegistry + per-provider InferenceBackend implementations, shared so any
 * service that resolves a backend via aisha_resolve_clow_backend dispatches to the
 * NATIVE provider protocol (OpenAI Responses, Gemini generateContent, Anthropic
 * /v1/messages, vLLM/Ollama/Docker OpenAI-compat, llm-gateway, maestro) with one
 * import — instead of blindly POSTing /chat/completions (which 404s for Gemini/Anthropic).
 *
 * Extracted from svc-ai-chat/src/lib so svc-mcp-knowledge (RAG completions) reuses
 * the exact same dispatch rather than reimplementing per-provider branching.
 *
 * @module
 */
export * from "./providers/index.js";
export * from "./providers/streaming.js";
// createXAIBackend is not in the providers barrel — re-export it explicitly.
export { createXAIBackend } from "./providers/openai-compat.js";
export * from "./backendRegistry.js";
export * from "./executionMode.js";
