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
// Team ID MJ367HY999 is the legacy Inklings Inc. team; swap in the new team
// ID once the account migration lands and re-sign the app to match.
// ---------------------------------------------------------------------------
const TEAM_ID = "MJ367HY999";

const AASA = {
  applinks: {
    details: [
      {
        // Ink app — coloring page routes live under /ink/.
        appIDs: [`${TEAM_ID}.ink.lings.Ink`],
        components: [
          { "/": "/ink/*", comment: "Ink coloring page routes" }
        ]
      },
      {
        // Otto is the current Inkling app bundle; keep the legacy Inkling
        // bundle associated too so already-installed builds still resolve.
        appIDs: [
          `${TEAM_ID}.ink.lings.Otto`,
          `${TEAM_ID}.ink.lings.Inkling`
        ],
        components: [
          { "/": "/ink/*", exclude: true, comment: "Ink owns coloring page routes" },
          { "/": "/*", comment: "All other apex paths are universal links" }
        ]
      }
    ]
  },
  appclips: {
    // Whitelist of bundle IDs allowed to be served as App Clips from this
    // domain. Must match the App Clip target's bundle ID exactly.
    apps: [
      `${TEAM_ID}.ink.lings.Otto.Clip`,
      `${TEAM_ID}.ink.lings.Inkling.Clip`
    ]
  },
  webcredentials: {
    apps: [
      `${TEAM_ID}.ink.lings.Otto`,
      `${TEAM_ID}.ink.lings.Inkling`
    ]
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
// GitHub Pages origin. The Worker proxies all non-AASA traffic here via
// cf.resolveOverride — the Host header stays inkling.ink so Pages routes
// to the correct repo by its CNAME, but DNS resolves to Pages' IPs.
// ---------------------------------------------------------------------------
const ORIGIN_HOST = "inklings-inc.github.io";

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

    // Everything else: proxy to GitHub Pages. Pages routes by Host header,
    // so we keep the original inkling.ink / www.inkling.ink in the URL and
    // use cf.resolveOverride to tell Cloudflare's DNS to hit Pages' IPs.
    // NOTE: setting the Host header manually on a Worker fetch() is silently
    // ignored by the Cloudflare runtime — resolveOverride is the only way
    // to proxy under a different hostname while Pages still sees the real
    // Host. Without this, Pages returns its generic "Site not found" page.
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
      cf: { resolveOverride: ORIGIN_HOST }
    });

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
