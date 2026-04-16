/**
 * Cloudflare Worker for inkling.ink
 *
 * Responsibility: serve Apple universal-links / App Clip metadata with the
 * exact Content-Type Apple's CDN fetcher requires, which GitHub Pages will
 * not guarantee for extensionless files under `/.well-known/`.
 *
 * Two special paths are intercepted:
 *   /.well-known/apple-app-site-association   (universal links + App Clip)
 *   /apple-app-site-association               (legacy fallback Apple also probes)
 *
 * Both are returned as `application/json` with no redirects, no HTML wrapper,
 * and no trailing-slash games. Everything else is transparently proxied to
 * the GitHub Pages origin so the static site keeps working unchanged.
 *
 * Deploy target: a Worker route bound to `inkling.ink/*` (and optionally
 * `www.inkling.ink/*`) with Cloudflare DNS proxying the apex to the Worker.
 */

// Inline the AASA JSON so it is served from the edge with zero origin round-trip.
// Keep this file in sync with the App Clip bundle identifier and team ID.
// Replace TEAMID and bundle identifiers before deploying.
const AASA = {
  applinks: {
    apps: [],
    details: [
      {
        // Full app
        appIDs: ["TEAMID.ink.lings.Inkling"],
        components: [
          {
            "/": "/inkling",
            comment: "Inkling product page → opens app if installed"
          },
          {
            "/": "/inkling/*",
            comment: "Any inkling subpath"
          }
        ]
      },
      {
        // App Clip
        appIDs: ["TEAMID.ink.lings.Inkling.Clip"],
        components: [
          {
            "/": "/",
            comment: "Root invocation URL for the App Clip"
          },
          {
            "/": "/inkling",
            comment: "Product page invocation"
          },
          {
            "/": "/inkling/*"
          }
        ]
      }
    ]
  },
  appclips: {
    // Apple consults this list to decide which bundle IDs may be served as Clips
    // from this domain. Must match the App Clip's appID exactly.
    apps: ["TEAMID.ink.lings.Inkling.Clip"]
  },
  webcredentials: {
    apps: ["TEAMID.ink.lings.Inkling"]
  }
};

const AASA_BODY = JSON.stringify(AASA);

const AASA_HEADERS = {
  "content-type": "application/json",
  // Apple's fetcher caches aggressively; a short TTL keeps rollouts sane
  // without hammering the edge. Apple itself caches for up to 24h regardless.
  "cache-control": "public, max-age=3600",
  // Defensive: block any accidental HTML sniffing.
  "x-content-type-options": "nosniff"
};

// GitHub Pages origin. Cloudflare proxy mode lets us send the request straight
// to Pages while keeping the custom hostname intact via the Host header.
const ORIGIN = "https://inklings-inc.github.io";

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Serve AASA directly from the Worker — no origin hop, no MIME surprises.
    if (
      url.pathname === "/.well-known/apple-app-site-association" ||
      url.pathname === "/apple-app-site-association"
    ) {
      return new Response(AASA_BODY, { status: 200, headers: AASA_HEADERS });
    }

    // Everything else: transparent proxy to GitHub Pages.
    // GitHub Pages routes by Host header; because the custom domain is set on
    // the Pages repo, the request must carry the custom hostname, not the
    // github.io one. Fetching the *.github.io URL with a preserved Host works
    // and is the pattern Cloudflare recommends for Pages fronting.
    const upstream = new URL(url.pathname + url.search, ORIGIN);
    const proxied = new Request(upstream.toString(), request);
    proxied.headers.set("host", url.hostname);

    const response = await fetch(proxied, { redirect: "manual" });

    // Pass the response through, but strip hop-by-hop headers Cloudflare
    // sometimes complains about when re-emitting.
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
