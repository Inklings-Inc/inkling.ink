/**
 * Cloudflare Worker for inkling.ink — Option B split
 *
 * Domain plan:
 *   www.inkling.ink → marketing site (GitHub Pages, unchanged)
 *   inkling.ink     → app domain
 *                       /.well-known/apple-app-site-association  (served here)
 *                       /<anything>  → universal link / App Clip invocation
 *                       /            → fallback landing for non-iOS visitors
 *
 * The Worker's job is narrow:
 *   1. Serve the AASA file at the apex with Content-Type: application/json,
 *      which GitHub Pages will not do. Universal links tolerate the wrong
 *      type; App Clip invocation does not.
 *   2. Transparently proxy everything else to GitHub Pages so the marketing
 *      site keeps rendering unchanged at www.inkling.ink.
 *
 * Deploy target: Worker routes bound to
 *   inkling.ink/*
 *   www.inkling.ink/*
 * with Cloudflare proxying (orange cloud) the apex and www DNS records.
 */

// ---------------------------------------------------------------------------
// AASA — inlined so we serve from the edge with zero origin round-trip.
// Replace TEAMID with the real 10-char Apple Team ID before deploy.
// ---------------------------------------------------------------------------
const AASA = {
  applinks: {
    details: [
      {
        // Full app — every path on the apex opens the app if installed.
        appIDs: ["TEAMID.ink.lings.Inkling"],
        components: [
          { "/": "/*", comment: "All apex paths are universal links" }
        ]
      }
    ]
  },
  appclips: {
    // Whitelist of bundle IDs allowed to be served as App Clips from this
    // domain. Must match the App Clip target's bundle ID exactly.
    apps: ["TEAMID.ink.lings.Inkling.Clip"]
  },
  webcredentials: {
    apps: ["TEAMID.ink.lings.Inkling"]
  }
};

const AASA_BODY = JSON.stringify(AASA);

const AASA_HEADERS = {
  "content-type": "application/json",
  // Apple caches AASA at its CDN (app-site-association.cdn-apple.com)
  // aggressively; this just controls the origin TTL, not Apple's cache.
  "cache-control": "public, max-age=3600",
  "x-content-type-options": "nosniff"
};

// ---------------------------------------------------------------------------
// GitHub Pages origin. The Worker proxies all non-AASA traffic here.
// Pages routes by Host header matching a repo's custom domain, so we preserve
// the incoming hostname when forwarding.
// ---------------------------------------------------------------------------
const ORIGIN = "https://inklings-inc.github.io";

// Hosts we're authoritative for. Anything else hitting this worker is odd
// and gets proxied as-is (safe default).
const MARKETING_HOST = "www.inkling.ink";
const APP_HOST = "inkling.ink";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // AASA paths: serve the inlined JSON. Apple checks two locations; handle
    // both so a typo or legacy configuration still works.
    if (
      url.pathname === "/.well-known/apple-app-site-association" ||
      url.pathname === "/apple-app-site-association"
    ) {
      return new Response(AASA_BODY, { status: 200, headers: AASA_HEADERS });
    }

    // Everything else: proxy to GitHub Pages. We forward with the original
    // Host header intact so Pages serves from the repo matching that host.
    // Pages itself handles routing www ↔ apex based on the repo's CNAME file.
    const upstream = new URL(url.pathname + url.search, ORIGIN);
    const proxied = new Request(upstream.toString(), request);
    proxied.headers.set("host", url.hostname);

    const response = await fetch(proxied, { redirect: "manual" });

    // Strip hop-by-hop headers Cloudflare sometimes refuses to re-emit.
    const headers = new Headers(response.headers);
    headers.delete("transfer-encoding");
    headers.delete("connection");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }
};
