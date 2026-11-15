import { NextResponse } from "next/server";
import { headers } from "next/headers";

/**
 * Configurable geo-blocking. Set `GEO_BLOCKED_COUNTRIES` to a comma-separated
 * list of ISO-3166 alpha-2 codes (for example `US,FR,GB`). Real jurisdiction
 * blocking belongs at the edge/CDN; this endpoint makes the policy explicit and
 * gives the client a single place to enforce it.
 */
const BLOCKED = (process.env.GEO_BLOCKED_COUNTRIES ?? "")
  .split(",")
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);

export async function GET() {
  const headerBag = headers();
  const country = (
    headerBag.get("x-vercel-ip-country") ??
    headerBag.get("cf-ipcountry") ??
    headerBag.get("x-country-code") ??
    ""
  ).toUpperCase();

  return NextResponse.json({
    country: country || null,
    blocked: country !== "" && BLOCKED.includes(country),
    blockedCountries: BLOCKED,
    configured: BLOCKED.length > 0,
  });
}
