# inkling.ink edge worker

Cloudflare Worker that fronts both `inkling.ink` and `www.inkling.ink` to
solve one narrow problem: **GitHub Pages will not serve
`/.well-known/apple-app-site-association` with `Content-Type: application/json`**,
which Apple's App Clip invocation pipeline requires.

Confirmed empirically: Pages serves the file with
`content-type: application/octet-stream`. Universal links tolerate this,
App Clips do not.

The worker intercepts the AASA path at the apex and returns inlined JSON.
Every other path is proxied to GitHub Pages unchanged.

## Domain plan (Option B split)

```
www.inkling.ink → marketing site (GitHub Pages)
inkling.ink     → app domain
   /.well-known/apple-app-site-association   served by this worker
   /ink/<anything>                            Ink universal links
   /<anything>                                Otto / legacy Inkling universal links
   /                                          non-iOS fallback landing
```

Ink shareable deep links take the shape `inkling.ink/ink/<route>`.

## Files

- `worker.js` — the worker. AASA is inlined at the top.
- `wrangler.toml` — deploy config + route bindings.

## One-time setup

### 1. GitHub Pages repo (`Inklings-Inc/inkling.ink`)

- Change the Pages custom domain to `www.inkling.ink` (currently `inkling.ink`).
- Update the repo's `CNAME` file to `www.inkling.ink`.
- Leave HTTPS enabled.
- Keep `.nojekyll` in place — the worker serves AASA, but having the file
  reachable as a fallback is harmless and useful for debugging.

### 2. Cloudflare DNS

All records **proxied** (orange cloud). Any email records (MX, SPF TXT,
DKIM CNAME) must stay **DNS only** (grey cloud).

| Type  | Name            | Content                         | Proxy |
|-------|-----------------|---------------------------------|-------|
| A     | inkling.ink     | 185.199.108.153                 | 🟠    |
| A     | inkling.ink     | 185.199.109.153                 | 🟠    |
| A     | inkling.ink     | 185.199.110.153                 | 🟠    |
| A     | inkling.ink     | 185.199.111.153                 | 🟠    |
| CNAME | www             | inklings-inc.github.io          | 🟠    |

### 3. Fill in your Apple Team ID

Open `worker.js`, replace every `TEAMID` with the 10-character ID from
developer.apple.com → Membership → Team ID.

### 4. App Store Connect (apps)

- Ink associated domains entitlement: `applinks:inkling.ink`.
- Otto associated domains entitlement: `applinks:inkling.ink` and
  `appclips:inkling.ink`.
- App Clip target: bundle ID `ink.lings.Otto.Clip`.
- App Clip default invocation URL: `https://inkling.ink/`.
- Optional Advanced App Clip Experiences: add specific URL patterns under
  `https://inkling.ink/` if you want dedicated Clip cards for certain
  content types.

### 5. Smart App Banner (on `www.inkling.ink` marketing page)

Add to the marketing `<head>`:

```html
<meta name="apple-itunes-app"
      content="app-id=YOUR_APP_ID, app-clip-bundle-id=ink.lings.Otto.Clip">
```

This is what makes the App Clip card appear at the top of Safari when iOS
users visit the marketing page.

## Deploy

```sh
cd cloudflare
npm install -g wrangler           # first time only
wrangler login                    # first time only
wrangler deploy
```

## Verify

```sh
# Content-Type is correct
curl -sI https://inkling.ink/.well-known/apple-app-site-association | grep -i content-type
# → content-type: application/json

# AASA body is valid JSON
curl -s https://inkling.ink/.well-known/apple-app-site-association | jq .

# Marketing site still renders at www
curl -sI https://www.inkling.ink/ | head -3
# → HTTP/2 200
```

Apple's CDN validator (populated after your app is published with Associated
Domains enabled):
`https://app-site-association.cdn-apple.com/a/v1/inkling.ink`

## Why a worker

- GitHub Pages serves `/.well-known/apple-app-site-association` as
  `application/octet-stream`. Apple's App Clip service rejects this silently.
- Pages has no per-path `_headers` support. This is the minimal fix.
- Everything else (marketing site, repo, workflow) stays on GitHub Pages.

## Future simplification

If we ever migrate off GitHub Pages to Cloudflare Pages or similar, this
worker can be replaced by a `_headers` file:

```
/.well-known/apple-app-site-association
  Content-Type: application/json
```

Until then the proxy worker is the least-disruptive path.
