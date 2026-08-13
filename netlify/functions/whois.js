// Netlify Function: WHOIS lookup
// WHOIS (RFC 3912) is a raw TCP protocol on port 43 — browsers cannot
// open TCP sockets directly, so this small serverless function does
// the lookup server-side and hands the raw text back as JSON.
// No external npm dependency: uses Node's built-in `net` module only.

const net = require('net');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const IANA_WHOIS = 'whois.iana.org';

function queryWhois(server, query, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(43, server);
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timed out querying ${server}`));
    }, timeoutMs);

    socket.on('connect', () => socket.write(query + '\r\n'));
    socket.on('data', (chunk) => (data += chunk.toString('utf8')));
    socket.on('end', () => { clearTimeout(timer); resolve(data); });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

async function whoisLookup(domain) {
  // Step 1: ask IANA which registry is authoritative for this TLD.
  const ianaResult = await queryWhois(IANA_WHOIS, domain);
  let raw = ianaResult;

  const referMatch = ianaResult.match(/refer:\s*(\S+)/i);
  if (referMatch) {
    // Step 2: ask the registry (e.g. Verisign for .com) for the domain.
    const registryResult = await queryWhois(referMatch[1], domain);
    raw += '\n\n' + registryResult;

    // Step 3: some registries point to the registrar's own WHOIS server
    // for full contact detail — follow that one extra hop if present.
    const whoisServerMatch =
      registryResult.match(/Whois Server:\s*(\S+)/i) ||
      registryResult.match(/Registrar WHOIS Server:\s*(\S+)/i);
    if (whoisServerMatch) {
      try {
        const registrarResult = await queryWhois(whoisServerMatch[1], domain);
        raw += '\n\n' + registrarResult;
      } catch (e) {
        // Registrar server unreachable/rate-limited — not fatal,
        // we still have the registry-level data.
      }
    }
  }
  return raw;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const domain = ((event.queryStringParameters || {}).domain || '').trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Enter a valid domain name.' }) };
  }

  try {
    const raw = await whoisLookup(domain);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ domain, raw }) };
  } catch (err) {
    return { statusCode: 502, headers: CORS, body: JSON.stringify({ error: err.message || 'WHOIS lookup failed.' }) };
  }
};
