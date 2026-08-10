# Domain Toolkit

A DNS & domain analysis web app — landing page + live dashboard, fully responsive, with a light/dark theme toggle.

**Everything here is real, live data.** There is no hardcoded sample domain anymore.

## How the data works

| Page | Data source | Needs a backend? |
|---|---|---|
| DNS Records | Google DNS-over-HTTPS (queried directly from the browser) | No |
| Domain Analysis | Same DNS lookups + a live HTTPS reachability check + WHOIS | WHOIS part only |
| DNS Propagation | Google + Cloudflare DNS-over-HTTPS, compared live | No |
| Domain Health | Live DNS/HTTPS/SPF/DMARC checks | No |
| Domain Details (WHOIS) | Raw WHOIS protocol via a Netlify Function | **Yes** |

**Why WHOIS needs a backend:** WHOIS (RFC 3912) is a raw TCP protocol on port 43 — it's not HTTP, so a browser cannot speak it directly, full stop. That's a limit of the WHOIS protocol itself, not a shortcut I took. The included `netlify/functions/whois.js` does that TCP lookup server-side (using only Node's built-in `net` module — no paid API, no npm dependency) and hands the result back as JSON.

Everything else (DNS records, propagation, health checks) genuinely runs with zero backend, straight from the browser, using public DNS-over-HTTPS APIs from Google and Cloudflare.

## Deploying (free, no VPS)

This needs **Netlify** specifically (not GitHub Pages) because GitHub Pages can't run the WHOIS function — it only serves static files.

1. Create a free account at netlify.com.
2. Unzip this folder.
3. Drag the whole `domain-toolkit` folder onto the Netlify "Deploys" drop zone in your site dashboard (or connect it to a GitHub repo for automatic deploys — either works, no build command needed).
4. Netlify will detect `netlify.toml` and automatically deploy `netlify/functions/whois.js` as a serverless function. No extra setup.
5. Your site goes live at `https://<your-site-name>.netlify.app`. WHOIS lookups will work automatically at `/.netlify/functions/whois`.

## Running it locally

```bash
npm install -g netlify-cli   # only needed once
cd domain-toolkit
netlify dev
```

`netlify dev` serves the static files **and** runs the WHOIS function locally, so everything — DNS records, propagation, health, WHOIS — works exactly as it will in production.

(If you just open `index.html` directly in a browser or use `python3 -m http.server`, everything works **except** the WHOIS page, since that needs the Netlify Function running.)

## Known honesty notes (read before you rely on this)

- **Propagation checker** compares two real public resolvers (Google, Cloudflare) — it does **not** simulate different geographic regions, because a free static site has no way to run network probes from multiple physical locations. The UI labels results by resolver, not by fake city names.
- **SSL Certificate check** is inferred from whether an HTTPS connection succeeds from the browser — it's a real signal (an invalid/expired cert makes the browser's `fetch()` fail) but it isn't a full certificate-chain audit.
- **DKIM** and **Blacklist** checks are marked "Manual check" rather than faked — DKIM lives at a provider-specific selector that can't be guessed, and blacklist checking needs a paid API. Better to say "not checked" than to show a fake "Good."
- **Domain score / health scores** are a simple heuristic (based on which core record types and checks pass), not a scoring model from a real paid product like MXToolbox.

## Structure

- `index.html`, `analysis.html`, `dns-records.html`, `health.html`, `propagation.html`, `domain-details.html`, `docs.html`
- `css/` — design tokens, layout, shared components, landing-only styles
- `js/app.js` — theme toggle + mobile sidebar
- `js/api.js` — all live data logic (DNS-over-HTTPS, WHOIS fetch, HTTPS check, shared cross-page domain state)
- `netlify/functions/whois.js` — the one piece of server-side code, for raw WHOIS only
- `netlify.toml` — tells Netlify where the function lives
