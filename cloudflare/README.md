# inkling.ink edge worker

Cloudflare Worker that fronts `inkling.ink` to solve one narrow problem:
**GitHub Pages will not reliably serve `/.well-known/apple-app-site-association`
with `Content-Type: application/json`**, which Apple's CDN fetcher requires
for universal links and App Clips.

The worker intercepts the AASA paths and returns inlined JSON from the edge.
Every other path is proxied through to the GitHub Pages origin unchanged.

## Files

- `worker.js` — the worker itself. AASA is inlined at the top.
- `wrangler.toml` — deploy config + route bindings.

## One-time setup

1. **Add `inkling.ink` to Cloudflare** as a zone (full setup: update nameservers
   at your registrar to Cloudflare's).
2. **DNS**: point the apex `inkling.ink` at GitHub Pages (A/AAAA records or
   a flattened CNAME to `inklings-inc.github.io`). Set the records to
   **proxied** (orange cloud) so the worker can intercept.
3. **GitHub Pages repo** (`Inklings-Inc/inkling.ink`): confirm `inkling.ink`
   is set as the custom domain and HTTPS is enabled. The CNAME file in the
   repo root should contain `inkling.ink`.
4. **Edit `worker.js`**: replace `TEAMID` and bundle IDs with the real values
   from the Inkling app + App Clip targets.

## Deploy

```sh
cd cloudflare
npm install -g wrangler           # first time only
wrangler login                    # first time only
wrangler deploy
```

## Verify

```sh
curl -sI https://inkling.ink/.well-known/apple-app-site-association | grep -i content-type
# → content-type: application/json

curl -s https://inkling.ink/.well-known/apple-app-site-association | jq .
# → full AASA JSON
```

Apple's validator: https://app-site-association.cdn-apple.com/a/v1/inkling.ink
(Apple fetches through its own CDN; first crawl can take up to a few hours.)

## Why a worker and not just GitHub Pages

- GitHub Pages serves extensionless files as `application/octet-stream` or
  `text/plain` depending on path. Apple requires `application/json` and will
  silently reject universal links if the type is wrong.
- Adding a `.json` extension doesn't help — Apple fetches the exact path
  `/.well-known/apple-app-site-association` with no extension.
- GitHub Pages has no `_headers` / `_redirects` support the way Netlify or
  Cloudflare Pages does. A worker is the smallest reliable fix that keeps
  the current Pages hosting in place.

## Future: move hosting entirely to Cloudflare Pages

If we ever want to drop GitHub Pages, this worker can be replaced by
Cloudflare Pages with a `_headers` file:

```
/.well-known/apple-app-site-association
  Content-Type: application/json
```

Until then the proxy worker is the path of least disruption.
