import {
  ANTE_TIMEOUT_MS,
  MAX_STAKE_BASE_UNITS,
  MIN_STAKE_BASE_UNITS,
  PLATFORM_FEE_PER_PLAYER_BASE_UNITS,
  STAKE_PRESETS_BASE_UNITS,
  TURN_TIMEOUT_MS,
  USDC_MINT_MAINNET,
} from "@20down/shared";
import { isAllowedOrigin, isGeoBlocked, jsonResponse, requestCountry, wageringEnabled } from "./config.js";
import type { Env } from "./types.js";

export { LobbyDurableObject } from "./do/lobby.js";
export { TableDurableObject } from "./do/table.js";

const MAX_BODY_BYTES = 16 * 1024;

export default {
  async fetch(request: Request<unknown, IncomingRequestCfProperties>, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isGeoBlocked(requestCountry(request), env)) {
      return jsonResponse({ error: "20 Down is not available in your region." }, request, env, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsPreflightHeaders(request, env) });
    }

    if ((url.pathname === "/ws" || url.pathname === "/ws/lobby") && isUpgrade(request)) {
      if (!isAllowedOrigin(request.headers.get("Origin"), env)) {
        return new Response("Forbidden origin", { status: 403 });
      }
      return env.LOBBY_DO.getByName("global").fetch(request);
    }

    const tableMatch = url.pathname.match(/^\/ws\/table\/([^/]+)$/);
    if (tableMatch && isUpgrade(request)) {
      if (!isAllowedOrigin(request.headers.get("Origin"), env)) {
        return new Response("Forbidden origin", { status: 403 });
      }
      const target = new URL(request.url);
      target.searchParams.set("tableId", decodeURIComponent(tableMatch[1] ?? ""));
      return env.TABLE_DO.getByName(decodeURIComponent(tableMatch[1] ?? "")).fetch(
        new Request(target, request),
      );
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return jsonResponse(
        {
          ok: true,
          service: "20down-backend",
          cluster: env.CLUSTER || "mainnet-beta",
          chainEnabled: wageringEnabled(env),
          programId: env.PROGRAM_ID || null,
          now: Date.now(),
        },
        request,
        env,
      );
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return jsonResponse(
        {
          cluster: env.CLUSTER || "mainnet-beta",
          programId: env.PROGRAM_ID || "",
          usdcMint: env.USDC_MINT || USDC_MINT_MAINNET,
          treasury: "",
          feePerPlayer: PLATFORM_FEE_PER_PLAYER_BASE_UNITS.toString(),
          minStake: MIN_STAKE_BASE_UNITS.toString(),
          maxStake: MAX_STAKE_BASE_UNITS.toString(),
          stakePresets: STAKE_PRESETS_BASE_UNITS.map((value) => value.toString()),
          turnTimeoutMs: TURN_TIMEOUT_MS,
          anteTimeoutMs: ANTE_TIMEOUT_MS,
          chainEnabled: wageringEnabled(env),
          wsPath: "/ws",
        },
        request,
        env,
      );
    }

    if (request.method === "GET" && url.pathname === "/api/lobby") {
      const tables = await env.LOBBY_DO.getByName("global").listTables();
      return jsonResponse({ tables }, request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/verify") {
      const roomId = (url.searchParams.get("room") ?? "").trim();
      if (!roomId) return jsonResponse({ error: "Room is required" }, request, env, 400);
      const all = await env.TABLE_DO.getByName(roomId).allRecords();
      if (!all) return jsonResponse({ error: "Room not found" }, request, env, 404);
      const requested = Number(url.searchParams.get("round") ?? all.round);
      const round = Number.isFinite(requested) ? requested : all.round;
      const record = all.records.find((entry) => entry.round === round);
      if (!record) {
        return jsonResponse({ error: "No published round with that number yet" }, request, env, 404);
      }
      return jsonResponse(
        {
          room: roomId,
          cluster: env.CLUSTER || "mainnet-beta",
          programId: env.PROGRAM_ID || "",
          record,
        },
        request,
        env,
      );
    }

    if (request.method === "POST" && url.pathname === "/api/tx") {
      const guard = wageringGuard(env);
      if (guard) return guard(request, env);
      let body: Record<string, unknown>;
      try {
        body = await readJson(request);
      } catch (cause) {
        return badRequest(cause, request, env);
      }
      return jsonResponse(
        { error: "Mainnet chain adapter is not configured", kind: body.kind ?? null },
        request,
        env,
        501,
      );
    }

    if (request.method === "POST" && url.pathname === "/api/tx/submit") {
      const guard = wageringGuard(env);
      if (guard) return guard(request, env);
      try {
        await readJson(request);
      } catch (cause) {
        return badRequest(cause, request, env);
      }
      return jsonResponse({ error: "Mainnet chain adapter is not configured" }, request, env, 501);
    }

    return jsonResponse({ error: "Not found" }, request, env, 404);
  },
} satisfies ExportedHandler<Env>;

function badRequest(cause: unknown, request: Request, env: Env): Response {
  return jsonResponse(
    { error: cause instanceof Error ? cause.message : "Invalid request" },
    request,
    env,
    400,
  );
}

function corsPreflightHeaders(request: Request, env: Env): HeadersInit {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && isAllowedOrigin(origin, env)) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function isUpgrade(request: Request): boolean {
  return request.headers.get("Upgrade")?.toLowerCase() === "websocket";
}

function wageringGuard(env: Env): ((request: Request, env: Env) => Response) | null {
  if (!wageringEnabled(env)) {
    return (request, env) =>
      jsonResponse(
        { error: "USDC wagering is paused until the independent audit and legal sign-off are complete." },
        request,
        env,
        503,
      );
  }
  return null;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new Error("Request body is too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Request body is too large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Malformed JSON body");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

