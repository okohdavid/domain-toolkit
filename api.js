// ============================================================
// Domain Toolkit — live data layer
// DNS records: queried directly from the browser via public
// DNS-over-HTTPS (DoH) APIs — no backend needed.
// WHOIS: needs a backend (raw WHOIS is a TCP protocol, not HTTP,
// so browsers can't speak it) — calls a small Netlify function.
// ============================================================

const DT = (function () {
  const TYPE_MAP = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28 };
  const TYPE_NAME = Object.fromEntries(Object.entries(TYPE_MAP).map(([k, v]) => [v, k]));

  const RESOLVERS = [
    { id: 'google', label: 'Google Public DNS (8.8.8.8)' },
    { id: 'cloudflare', label: 'Cloudflare DNS (1.1.1.1)' }
  ];

  function normalizeDomain(input) {
    return (input || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
  }

  async function dohQuery(name, type, provider) {
    let url, headers = {};
    if (provider === 'cloudflare') {
      url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
      headers = { Accept: 'application/dns-json' };
    } else {
      url = `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`DNS query failed (${res.status})`);
    return res.json();
  }

  // IMPORTANT: only trust the Answer section. The Authority section on an
  // NXDOMAIN or NODATA response contains the *parent* zone's SOA record
  // (e.g. root/TLD servers) for negative-caching purposes — it does NOT
  // belong to the domain being queried, and must never be shown as if
  // it were one of the domain's own records.
  function parseAnswers(json) {
    const rows = json.Answer || [];
    return rows.map((r) => ({
      name: r.name.replace(/\.$/, ''),
      type: TYPE_NAME[r.type] || String(r.type),
      ttl: r.TTL,
      data: String(r.data).replace(/^"|"$/g, '')
    }));
  }

  // DNS response codes (RFC 1035 / RFC 2136):
  // 0 = NOERROR, 2 = SERVFAIL, 3 = NXDOMAIN, 5 = REFUSED
  const RCODE = { NOERROR: 0, SERVFAIL: 2, NXDOMAIN: 3, REFUSED: 5 };

  // A single DNS answer (even an empty one) does NOT prove a domain
  // exists — only the response Status code does. NXDOMAIN on every
  // query type means the name genuinely does not exist in DNS.
  // Returns: 'exists' | 'not-found' | 'unknown' (resolver error/timeout).
  async function checkDomainStatus(domain) {
    try {
      const json = await dohQuery(domain, 'NS', 'google');
      if (json.Status === RCODE.NXDOMAIN) return 'not-found';
      if (json.Status === RCODE.NOERROR) return 'exists';
      return 'unknown'; // SERVFAIL, REFUSED, etc. — genuinely couldn't verify
    } catch (e) {
      return 'unknown';
    }
  }

  // Fetch every common record type for a domain from Google DoH.
  // Only returns records that actually belong to the domain (see
  // parseAnswers above) — never parent-zone/root-server metadata.
  async function getAllRecords(domain) {
    const types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA'];
    const results = await Promise.allSettled(
      types.map((t) => dohQuery(domain, t, 'google').then(parseAnswers))
    );
    const records = [];
    results.forEach((r) => {
      if (r.status === 'fulfilled') {
        // Keep each record's own real type (from the response), never
        // the type we happened to query for.
        r.value.forEach((row) => records.push(row));
      }
    });
    return records;
  }

  // Query the same record across multiple public resolvers — this
  // shows whether a change has propagated to major public resolvers.
  // It is NOT geographic (a free static site can't run probes in
  // multiple physical regions), so we label it by resolver, not city.
  async function checkPropagation(domain, type) {
    const out = [];
    for (const resolver of RESOLVERS) {
      const start = performance.now();
      try {
        const json = await dohQuery(domain, type, resolver.id);
        const ms = Math.round(performance.now() - start);
        const answers = parseAnswers(json);
        out.push({
          label: resolver.label,
          status: answers.length ? 'resolved' : 'not-resolved',
          value: answers.length ? answers.map((a) => a.data).join(', ') : '—',
          ms
        });
      } catch (e) {
        out.push({ label: resolver.label, status: 'error', value: e.message, ms: null });
      }
    }
    return out;
  }

  // Best-effort HTTPS/SSL reachability check. A browser fetch() will
  // throw if the TLS handshake fails (expired/invalid cert, no HTTPS,
  // etc.), so a successful no-cors fetch is a reasonable live signal —
  // though it can't read the actual response, only whether the
  // connection succeeded.
  async function checkHttps(domain) {
    try {
      await fetch(`https://${domain}/`, { mode: 'no-cors', cache: 'no-store' });
      return true;
    } catch (e) {
      return false;
    }
  }

  // WHOIS needs a backend (raw WHOIS is a TCP socket protocol on
  // port 43 — browsers cannot open raw sockets). This calls a small
  // Netlify Function included in /netlify/functions/whois.js.
  async function fetchWhois(domain) {
    const res = await fetch(`/.netlify/functions/whois?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `WHOIS lookup failed (${res.status})`);
    }
    return res.json(); // { domain, raw }
  }

  // Very forgiving line-based parser for common WHOIS field labels.
  // Formats vary a lot between registries, so any field can come back empty.
  function parseWhoisFields(raw) {
    const grab = (re) => {
      const m = raw.match(re);
      return m ? m[1].trim() : '';
    };
    const nameservers = [...raw.matchAll(/Name Server:\s*(\S+)/gi)].map((m) => m[1].toLowerCase());

    // Registries signal "not registered" in very different ways —
    // this covers the common phrasings rather than assuming any
    // WHOIS response means the domain exists.
    const notFoundPattern = /No match for|NOT FOUND|No Data Found|Domain not found|No entries found|Status:\s*(free|available)|No whois server is known/i;
    const hasCoreFields = /(Domain Name:|Creation Date:|Registrar:)/i.test(raw);
    const registered = hasCoreFields && !notFoundPattern.test(raw);

    return {
      registered,
      registrar: grab(/Registrar:\s*(.+)/i),
      status: grab(/Domain Status:\s*(\S+)/i),
      created: grab(/Creation Date:\s*(.+)/i),
      updated: grab(/Updated Date:\s*(.+)/i),
      expires: grab(/Registry Expiry Date:\s*(.+)/i) || grab(/Expiry Date:\s*(.+)/i),
      whoisServer: grab(/Whois Server:\s*(\S+)/i),
      nameservers: [...new Set(nameservers)]
    };
  }

  // Simple state shared across pages via localStorage so the domain
  // you searched on one page carries over to the others.
  const STORE_KEY = 'dt-domain';
  function getCurrentDomain() {
    const params = new URLSearchParams(location.search);
    const q = params.get('domain');
    if (q) {
      const clean = normalizeDomain(q);
      localStorage.setItem(STORE_KEY, clean);
      return clean;
    }
    return localStorage.getItem(STORE_KEY) || 'example.com';
  }
  function setCurrentDomain(d) {
    localStorage.setItem(STORE_KEY, normalizeDomain(d));
  }

  function initDomainForm(renderFn) {
    document.addEventListener('DOMContentLoaded', () => {
      const domain = getCurrentDomain();
      document.querySelectorAll('[data-domain-input]').forEach((el) => (el.value = domain));
      renderFn(domain);

      document.querySelectorAll('[data-domain-form]').forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const input = form.querySelector('[data-domain-input]');
          const val = normalizeDomain(input.value);
          if (!val) return;
          setCurrentDomain(val);
          document.querySelectorAll('[data-domain-input]').forEach((el) => (el.value = val));
          renderFn(val);
        });
      });
    });
  }

  // Query any single name/type pair directly (e.g. _dmarc.example.com TXT).
  async function queryRecord(name, type) {
    const json = await dohQuery(name, type, 'google');
    return parseAnswers(json);
  }

  return {
    normalizeDomain, getAllRecords, checkPropagation, checkHttps, queryRecord,
    checkDomainStatus, fetchWhois, parseWhoisFields, getCurrentDomain, setCurrentDomain, initDomainForm
  };
})();
