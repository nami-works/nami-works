import cf from 'cloudfront';

// CloudFront Function — viewer-request handler for b2b.gebeauty.com.br.
// Full design notes: infra/terraform/README.md "Per-client access". Short version:
// - Per-client MAGIC LINKS: each client gets a unique unguessable token
//   (?k=<token>) instead of a username/password to type in. Credentials in
//   a CloudFront KVS (see site.tf), managed via _b2b_manage_client_access.py
//   -- {"company":"..."} keyed by the token itself.
// - Replaces an earlier username+password login screen that turned out to
//   be broken in real browsers: it worked by having the login page's JS
//   navigate to https://user:pass@host/path, but modern Chromium silently
//   refuses JS navigation to URLs with embedded credentials (confirmed via
//   direct browser testing -- no request even fires, no error, nothing).
//   A plain ?k=token query param has none of that baggage.
// - _co=<company> tracking redirect for the two deck roots lands in the
//   real CloudFront access logs (used by access-notify/-digest). A token
//   stored as {"silent": true} (no "company") skips this entirely -- no
//   redirect, no _co in the query, no log line an email could be built
//   from, no notify/digest email. For links Lucas wants to hand out with
//   zero traceability.
// - Clean-URL rewrite: "/comercial" -> "/comercial/index.html".
var OG_HEAD =
  '<title>GE Beauty: no seu tempo do seu jeito | Catálogo B2B</title>' +
  '<meta property="og:title" content="GE Beauty: no seu tempo do seu jeito | Catálogo B2B">' +
  '<meta property="og:type" content="website">' +
  '<meta property="og:site_name" content="GE Beauty">' +
  '<meta property="og:description" content=" ">' +
  '<meta property="og:image" content="https://b2b.gebeauty.com.br/og-image.jpg">' +
  '<meta property="og:image:width" content="1200">' +
  '<meta property="og:image:height" content="615">' +
  '<meta property="og:image:type" content="image/jpeg">';
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- entry point invoked by the CloudFront runtime, not local code
async function handler(event) {
  var request = event.request;
  var uri = request.uri;
  var qs = request.querystring || {};

  // /og-image.jpg: the one public, unauthenticated path -- crawlers fetch
  // og:image separately with no credentials, so it must bypass the gate.
  if (uri === '/og-image.jpg') {
    return request;
  }

  var isDeckRoot = uri === '/comercial' || uri === '/comercial/' || uri === '/parceiros' || uri === '/parceiros/';

  if (isDeckRoot) {
    var token = qs.k && qs.k.value;
    if (!token) return deniedPageResponse();

    var kvsHandle = cf.kvs();
    var record;
    try {
      var raw = await kvsHandle.get(token);
      record = JSON.parse(raw);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- CloudFront's JS engine doesn't support the ES2019 optional-catch-binding syntax (`catch {}`), so the binding is required even though it's unused
    } catch (e) {
      return deniedPageResponse(); // unknown token, or a malformed KVS entry
    }
    if (!record || (!record.company && !record.silent)) return deniedPageResponse();

    // Tracking redirect, once per deck root per link click. Preserves the
    // token so a second visit with the same bookmarked/shared link re-tracks.
    // Skipped entirely for a silent token -- no redirect, no _co, no trace.
    if (record.company && !qs._co) {
      var base = uri.endsWith('/') ? uri : uri + '/';
      return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: {
          location: {
            value: base + '?k=' + encodeURIComponent(token) + '&_co=' + encodeURIComponent(record.company),
          },
        },
      };
    }
  }

  // ── Clean-URL rewrite + root redirect ────────────────────────────────────
  if (uri === '/') {
    var rootToken = qs.k && qs.k.value;
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: {
        location: { value: '/comercial/' + (rootToken ? '?k=' + encodeURIComponent(rootToken) : '') },
      },
    };
  }

  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.length > 0 && !lastSegment.includes('.')) {
    request.uri = uri + '/index.html';
  }

  return request;
}

function deniedPageResponse() {
  return {
    statusCode: 403,
    statusDescription: 'Forbidden',
    headers: { 'content-type': { value: 'text/html; charset=utf-8' } },
    body: { encoding: 'text', data: deniedHTML() },
  };
}

function deniedHTML() {
  return (
    '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    OG_HEAD +
    '<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#f5f2ee;display:flex;' +
    'min-height:100vh;align-items:center;justify-content:center;margin:0}' +
    '.card{background:#fff;padding:36px 32px;border-radius:14px;max-width:360px;width:90%;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center}' +
    'h1{font-size:19px;margin:0 0 6px;color:#161616}p{color:#6b6b6b;font-size:14px;margin:0}' +
    '</style></head><body><div class="card">' +
    '<h1>Link inválido ou expirado</h1>' +
    '<p>Entre em contato com a GE Beauty para receber um novo acesso ao portfólio B2B.</p>' +
    '</div></body></html>'
  );
}
