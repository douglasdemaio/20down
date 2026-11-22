import type { Env } from "./types.js";

const DEFAULT_ORIGINS = [
  "https://douglasdemaio.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
];

export function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function allowedOrigins(env: Pick<Env, "ALLOWED_ORIGINS">): string[] {
  const configured = parseCsv(env.ALLOWED_ORIGINS);
  return configured.length > 0 ? configured : DEFAULT_ORIGINS;
}

export function isAllowedOrigin(origin: string | null, env: Pick<Env, "ALLOWED_ORIGINS">): boolean {
  if (!origin) return false;
  return allowedOrigins(env).includes(origin);
}

export function corsHeaders(request: Request, env: Pick<Env, "ALLOWED_ORIGINS">): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && isAllowedOrigin(origin, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

export function withCors(response: Response, request: Request, env: Pick<Env, "ALLOWED_ORIGINS">): Response {
  corsHeaders(request, env).forEach((value, name) => {
    response.headers.set(name, value);
  });
  return response;
}

export function jsonResponse(
  body: unknown,
  request: Request,
  env: Pick<Env, "ALLOWED_ORIGINS">,
  status = 200,
): Response {
  return withCors(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
    request,
    env,
  );
}

export function blockedCountries(env: Pick<Env, "GEO_BLOCKLIST">): string[] {
  return parseCsv(env.GEO_BLOCKLIST).map((country) => country.toUpperCase());
}

export function isGeoBlocked(country: string | null | undefined, env: Pick<Env, "GEO_BLOCKLIST">): boolean {
  if (!country) return false;
  return blockedCountries(env).includes(country.toUpperCase());
}

export function requestCountry(request: Request<unknown, IncomingRequestCfProperties>): string | null {
  return request.cf?.country ?? null;
}

export function wageringEnabled(env: Pick<Env, "WAGERING_ENABLED">): boolean {
  return env.WAGERING_ENABLED === "true";
}
