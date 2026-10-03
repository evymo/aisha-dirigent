/**
 * ai-task — Async AI task management edge function.
 *
 * Provides REST endpoints for creating, polling, and cancelling
 * long-running AI tasks (e.g. batch analysis, report generation).
 *
 * Endpoints:
 * - `POST /ai-task` — Create a new task
 * - `GET  /ai-task?task_id=X` — Get task status
 * - `GET  /ai-task?status=running&limit=10` — List own tasks
 * - `DELETE /ai-task?task_id=X` — Cancel a task
 *
 * All operations go through audited RPC functions.
 * The actual task processing is delegated to background workers
 * (e.g. n8n, cron, or direct invocation).
 *
 * @module
 */

import { serve, createClient } from "../_shared/deps.ts";
import { createTracer } from "../_shared/tracer.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateTaskBody {
  /** Task type (e.g. "batch_analysis", "report_generation") */
  task_type: string;
  /** Task input payload */
  input?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function authenticateUser(
  req: Request,
): Promise<{ userId: string; token: string } | Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");

  const anonClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user },
    error: authError,
  } = await anonClient.auth.getUser();

  if (authError || !user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  return { userId: user.id, token };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * POST /ai-task — Create a new async task.
 */
async function handleCreateTask(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
  body: CreateTaskBody,
): Promise<Response> {
  if (!body.task_type || typeof body.task_type !== "string") {
    return jsonResponse({ error: "task_type is required" }, 400);
  }

  const allowedTypes = [
    "batch_analysis",
    "report_generation",
    "data_export",
    "knowledge_sync",
    "evaluation_run",
  ];

  if (!allowedTypes.includes(body.task_type)) {
    return jsonResponse(
      {
        error: `Invalid task_type. Allowed: ${allowedTypes.join(", ")}`,
      },
      400,
    );
  }

  // Use service client with user context for RPC
  const { data, error } = await serviceClient.rpc("create_ai_task", {
    p_input: body.input ?? {},
  
    p_task_type: body.task_type,});

  if (error) {
    console.error("[ai-task] create error:", error.message);
    return jsonResponse({ error: "Failed to create task" }, 500);
  }

  return jsonResponse(data, 201);
}

/**
 * GET /ai-task?task_id=X — Get status of a specific task.
 */
async function handleGetTaskStatus(
  serviceClient: ReturnType<typeof createClient>,
  _userId: string,
  taskId: string,
): Promise<Response> {
  const { data, error } = await serviceClient.rpc("get_ai_task_status", {
    p_task_id: taskId,
  });

  if (error) {
    if (error.message.includes("not found")) {
      return jsonResponse({ error: "Task not found" }, 404);
    }
    console.error("[ai-task] status error:", error.message);
    return jsonResponse({ error: "Failed to get task status" }, 500);
  }

  return jsonResponse(data);
}

/**
 * GET /ai-task?status=X&limit=N — List own tasks.
 */
async function handleListTasks(
  serviceClient: ReturnType<typeof createClient>,
  _userId: string,
  status: string | null,
  limit: number,
): Promise<Response> {
  const params: Record<string, unknown> = { p_limit: limit };
  if (status) {
    params.p_status = status;
  }

  const { data, error } = await serviceClient.rpc("get_my_ai_tasks", params);

  if (error) {
    console.error("[ai-task] list error:", error.message);
    return jsonResponse({ error: "Failed to list tasks" }, 500);
  }

  return jsonResponse({ tasks: data ?? [] });
}

/**
 * DELETE /ai-task?task_id=X — Cancel a queued or running task.
 */
async function handleCancelTask(
  serviceClient: ReturnType<typeof createClient>,
  _userId: string,
  taskId: string,
): Promise<Response> {
  const { data, error } = await serviceClient.rpc("cancel_ai_task", {
    p_task_id: taskId,
  });

  if (error) {
    console.error("[ai-task] cancel error:", error.message);
    return jsonResponse({ error: "Failed to cancel task" }, 500);
  }

  return jsonResponse({ cancelled: data === true });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Authenticate
  const authResult = await authenticateUser(req);
  if (authResult instanceof Response) {
    return authResult;
  }
  const { userId, token } = authResult;

  // Create service client with user context for auth.uid() in RPCs
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const serviceClient = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Initialize tracer for this request
  const tracer = createTracer(serviceClient, "ai-task", userId);

  const url = new URL(req.url);
  const taskId = url.searchParams.get("task_id");
  const status = url.searchParams.get("status");
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10) || 20),
    100,
  );

  try {
    let response: Response;

    switch (req.method) {
      case "POST": {
        const body: CreateTaskBody = await req.json();
        tracer.event("task_checkpoint", {
          action: "create_task",
          task_type: body.task_type,
        });
        response = await handleCreateTask(serviceClient, userId, body);
        break;
      }

      case "GET": {
        if (taskId) {
          tracer.event("task_checkpoint", {
            action: "get_task_status",
            task_id: taskId,
          });
          response = await handleGetTaskStatus(
            serviceClient,
            userId,
            taskId,
          );
        } else {
          tracer.event("task_checkpoint", {
            action: "list_tasks",
            status_filter: status,
            limit,
          });
          response = await handleListTasks(
            serviceClient,
            userId,
            status,
            limit,
          );
        }
        break;
      }

      case "DELETE": {
        if (!taskId) {
          response = jsonResponse(
            { error: "task_id query parameter is required" },
            400,
          );
        } else {
          tracer.event("task_checkpoint", {
            action: "cancel_task",
            task_id: taskId,
          });
          response = await handleCancelTask(
            serviceClient,
            userId,
            taskId,
          );
        }
        break;
      }

      default:
        response = jsonResponse({ error: "Method not allowed" }, 405);
    }

    await tracer.finish("succeeded", {
      method: req.method,
      task_id: taskId,
      response_status: response.status,
    });

    return response;
  } catch (error) {
    console.error("[ai-task] Error:", error);

    await tracer.finish("failed", {
      method: req.method,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      500,
    );
  }
});
