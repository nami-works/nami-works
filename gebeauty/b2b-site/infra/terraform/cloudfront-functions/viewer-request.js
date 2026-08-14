import cf from 'cloudfront';

// CloudFront Function — viewer-request handler for b2b.gebeauty.com.br.
//
// Per-client HTTP Basic Auth (replaces the single shared credential): each
// client gets their own username/password, looked up from a CloudFront
// KeyValueStore (kvsHandle below -- associated via key_value_store_associations
// on the aws_cloudfront_function resource, see site.tf) instead of being
// baked into this function's code. That's the whole point of using KVS
// here -- Lucas can add/remove/rotate a client's credential with
// gebeauty/scripts/_b2b_manage_client_access.py, no `terraform apply`, no
// function redeploy, no propagation wait.
//
// KVS value shape per key (key = username, hyphen-slugified from the company
// name by the management script's slugify() -- e.g. "BIM Distribuidora" ->
// "bim-distribuidora"):
//   {"password": "...", "company": "<Company Name, as typed>"}
//
// Four jobs, in order:
//   1. HTTP Basic Auth gate against the KVS. Still "light" per the original
//      migration decision -- these are unlisted sell-in decks, not secrets --
//      just per-client instead of shared.
//   2. Name-capture interstitial: for the two deck ROOTS (/comercial,
//      /parceiros -- NOT arbitrary paths like /favicon.ico, which browsers
//      request automatically and would otherwise trigger this), if the
//      request has no `_n` query param yet, serve a small self-contained
//      HTML page asking "quem está acessando?" instead of the deck itself.
//      Its form submits (or Skip link) to the SAME url + `?_co=<company>
//      &_n=<name-or-empty>`. That follow-up IS a real second viewer request,
//      so it lands in CloudFront's standard S3 access logs (cs-uri-query)
//      with a timestamp + IP -- that's how the access-notify Lambda (and
//      Lucas, reading the raw logs) knows who opened which deck and when,
//      without extra infra (Lambda@Edge, a webhook, etc). The name is a
//      free-text field filled by the visitor themselves at access time --
//      NOT something Lucas pre-sets when creating the credential (Basic
//      Auth is shared per company, not per person, so there's no other way
//      to learn who specifically is looking).
//   3. Clean-URL rewrite + root redirect (unchanged from earlier versions):
//      "/comercial" -> "/comercial/index.html", "/" -> "/comercial/".
//
// A cache behavior only accepts one function per event type, so all jobs
// live here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- entry point invoked by the CloudFront runtime, not local code
async function handler(event) {
  var request = event.request;
  var headers = request.headers;

  // ── 1. Basic Auth gate against the KeyValueStore ────────────────────────
  var authHeader = headers.authorization && headers.authorization.value;
  var challenge = {
    statusCode: 401,
    statusDescription: 'Unauthorized',
    headers: {
      'www-authenticate': { value: 'Basic realm="GE Beauty B2B", charset="UTF-8"' },
    },
  };

  if (!authHeader || authHeader.indexOf('Basic ') !== 0) {
    return challenge;
  }

  var decoded;
  try {
    // eslint-disable-next-line no-undef -- atob is a CloudFront Functions runtime global, not a browser/Node API
    decoded = atob(authHeader.slice(6));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- CloudFront's JS engine doesn't support the ES2019 optional-catch-binding syntax (`catch {}`), so the binding is required even though it's unused
  } catch (e) {
    return challenge;
  }
  var sep = decoded.indexOf(':');
  if (sep < 0) return challenge;
  var user = decoded.slice(0, sep);
  var pass = decoded.slice(sep + 1);

  var kvsHandle = cf.kvs();
  var record;
  try {
    var raw = await kvsHandle.get(user);
    record = JSON.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- CloudFront's JS engine doesn't support the ES2019 optional-catch-binding syntax (`catch {}`), so the binding is required even though it's unused
  } catch (e) {
    return challenge; // unknown username, or a malformed KVS entry
  }
  if (!record || record.password !== pass) {
    return challenge;
  }
  var company = record.company || user;
  var uri = request.uri;
  var qs = request.querystring || {};

  // ── 2. Name-capture interstitial (once per deck root, per auth) ─────────
  var isDeckRoot = uri === '/comercial' || uri === '/comercial/' || uri === '/parceiros' || uri === '/parceiros/';
  if (isDeckRoot && !qs._n) {
    var base = uri.endsWith('/') ? uri : uri + '/';
    return {
      statusCode: 200,
      statusDescription: 'OK',
      headers: { 'content-type': { value: 'text/html; charset=utf-8' } },
      body: { encoding: 'text', data: nameGateHTML(company, base) },
    };
  }

  // ── 3. Clean-URL rewrite ─────────────────────────────────────────────────
  if (uri === '/') {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: '/comercial/' } },
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

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function nameGateHTML(company, targetPath) {
  var safeCompany = escapeHTML(company);
  return (
    '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>GE Beauty · Portfólio B2B</title>' +
    '<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#f5f2ee;display:flex;' +
    'min-height:100vh;align-items:center;justify-content:center;margin:0}' +
    '.card{background:#fff;padding:36px 32px;border-radius:14px;max-width:360px;width:90%;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center}' +
    'h1{font-size:19px;margin:0 0 6px;color:#161616}p{color:#6b6b6b;font-size:14px;margin:0 0 22px}' +
    'input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #e7e2da;border-radius:8px;' +
    'font-size:15px;margin-bottom:14px}' +
    'button{width:100%;padding:12px;border:none;border-radius:8px;background:#DF3630;color:#fff;' +
    'font-size:15px;font-weight:600;cursor:pointer}' +
    'a.skip{display:block;margin-top:14px;color:#6b6b6b;font-size:13px;text-decoration:underline;cursor:pointer}' +
    '</style></head><body><div class="card">' +
    '<h1>Bem-vindo(a), ' + safeCompany + '</h1>' +
    '<p>Como podemos te chamar?</p>' +
    '<input id="nm" maxlength="60" placeholder="Seu nome" autofocus>' +
    '<button onclick="go()">Continuar</button>' +
    '<a class="skip" onclick="go()">Pular</a>' +
    '</div><script>function go(){' +
    'var n=document.getElementById("nm").value.trim();' +
    'location.href="' + targetPath + '?_co=' + encodeURIComponent(company) + '&_n="+encodeURIComponent(n);' +
    '}document.getElementById("nm").addEventListener("keydown",function(e){if(e.key==="Enter")go();});' +
    '</script></body></html>'
  );
}
