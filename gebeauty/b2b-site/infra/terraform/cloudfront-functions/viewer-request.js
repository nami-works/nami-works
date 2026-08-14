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
// KVS value shape per key (key = username, e.g. "bimdistribuidora" -- always
// derived from the company name by the management script, see its slugify()):
//   {"password": "...", "company": "<Company Name, as typed>", "name": "<Contact Name, TitleCase, optional>"}
//
// Three jobs, in order:
//   1. HTTP Basic Auth gate against the KVS. Still "light" per the original
//      migration decision -- these are unlisted sell-in decks, not secrets --
//      just per-client instead of shared.
//   2. Tracking redirect: on FIRST successful auth for one of the two deck
//      ROOTS (/comercial, /parceiros -- NOT arbitrary paths like /favicon.ico,
//      which browsers request automatically and would otherwise show up as
//      false "accesses"), 302-redirect to the same URL + `?_co=<company>` (+
//      `&_n=<name>` if set). This is a REAL second viewer request, so it
//      lands in CloudFront's standard S3 access logs (cs-uri-query) with a
//      timestamp + IP -- that's how the access-notify Lambda (and Lucas,
//      reading the raw logs) sees which client opened which deck and when,
//      without extra infra (Lambda@Edge, a webhook, etc). An internal URI
//      rewrite would NOT do this: standard logs reflect the viewer-facing
//      request, not whatever a function rewrites en route to the origin.
//   3. Clean-URL rewrite + root redirect (unchanged from the single-credential
//      version): "/comercial" -> "/comercial/index.html", "/" -> "/comercial/".
//
// A cache behavior only accepts one function per event type, so all three
// jobs live here.
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
  var personName = record.name || '';
  var uri = request.uri;
  var qs = request.querystring || {};

  // ── 2a. Root redirect, tracked in one hop ───────────────────────────────
  if (uri === '/') {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: '/comercial/' + trackingQuery(company, personName) } },
    };
  }

  // ── 2b. Tracking redirect (once per deck root, per auth) ────────────────
  var isDeckRoot = uri === '/comercial' || uri === '/comercial/' || uri === '/parceiros' || uri === '/parceiros/';
  if (isDeckRoot && !qs._co) {
    var base = uri.endsWith('/') ? uri : uri + '/';
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: base + trackingQuery(company, personName) } },
    };
  }

  // ── 3. Clean-URL rewrite ─────────────────────────────────────────────────
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

function trackingQuery(company, personName) {
  var q = '?_co=' + encodeURIComponent(company);
  if (personName) q += '&_n=' + encodeURIComponent(personName);
  return q;
}
