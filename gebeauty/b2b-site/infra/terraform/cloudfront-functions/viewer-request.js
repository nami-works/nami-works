import cf from 'cloudfront';

// CloudFront Function — viewer-request handler for b2b.gebeauty.com.br.
// Full design notes: infra/terraform/README.md "Per-client access". Short version:
// - Per-client creds in a CloudFront KVS (see site.tf), managed via
//   _b2b_manage_client_access.py -- {"password":"...", "company":"..."}.
// - ONE custom login screen (user+pass+name), not the browser's native Basic
//   Auth popup: on missing/bad auth we return 200 HTML (never 401 +
//   WWW-Authenticate, which is what triggers the native prompt). The form's
//   JS navigates to https://user:pass@host/path?_n=name -- embedding
//   credentials in the URL makes the BROWSER attach a real Authorization
//   header (and cache it after), so the wire protocol is unchanged.
// - _co=<company>/_n=<name> tracking redirects for the two deck roots land
//   in the real CloudFront access logs (used by access-notify/-digest).
// - Clean-URL rewrite: "/comercial" -> "/comercial/index.html".
//
// OG_HEAD: an unauthenticated hit (including WhatsApp/Facebook/etc.'s link-
// preview crawlers, which never have credentials) always lands on the login
// page below, NOT the real deck HTML in S3 -- so the link-preview tags have
// to live here, not just in the deck's own <head>.
var OG_HEAD =
  '<title>GE Beauty: no seu tempo do seu jeito | Catálogo B2B</title>' +
  '<meta property="og:title" content="GE Beauty: no seu tempo do seu jeito | Catálogo B2B">' +
  '<meta property="og:type" content="website">' +
  '<meta property="og:site_name" content="GE Beauty">' +
  '<meta property="og:description" content=" ">';
// One function per event type per cache behavior, so all jobs live here.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- entry point invoked by the CloudFront runtime, not local code
async function handler(event) {
  var request = event.request;
  var headers = request.headers;
  var uri = request.uri;
  var qs = request.querystring || {};

  // ── 1. Auth gate against the KeyValueStore ──────────────────────────────
  var authHeader = headers.authorization && headers.authorization.value;
  if (!authHeader || authHeader.indexOf('Basic ') !== 0) {
    return loginPageResponse(uri, false);
  }

  var decoded;
  try {
    // eslint-disable-next-line no-undef -- atob is a CloudFront Functions runtime global, not a browser/Node API
    decoded = atob(authHeader.slice(6));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- CloudFront's JS engine doesn't support the ES2019 optional-catch-binding syntax (`catch {}`), so the binding is required even though it's unused
  } catch (e) {
    return loginPageResponse(uri, true);
  }
  var sep = decoded.indexOf(':');
  if (sep < 0) return loginPageResponse(uri, true);
  var user = decoded.slice(0, sep);
  var pass = decoded.slice(sep + 1);

  var kvsHandle = cf.kvs();
  var record;
  try {
    var raw = await kvsHandle.get(user);
    record = JSON.parse(raw);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- CloudFront's JS engine doesn't support the ES2019 optional-catch-binding syntax (`catch {}`), so the binding is required even though it's unused
  } catch (e) {
    return loginPageResponse(uri, true); // unknown username, or a malformed KVS entry
  }
  if (!record || record.password !== pass) {
    return loginPageResponse(uri, true);
  }
  var company = record.company || user;
  var nameParam = qs._n ? '&_n=' + qs._n.value : '';

  // ── 2. Root redirect, tracked in one hop ────────────────────────────────
  if (uri === '/') {
    return {
      statusCode: 302,
      statusDescription: 'Found',
      headers: { location: { value: '/comercial/?_co=' + encodeURIComponent(company) + nameParam } },
    };
  }

  // ── 3. Tracking redirect / name-capture fallback for the two deck roots ─
  var isDeckRoot = uri === '/comercial' || uri === '/comercial/' || uri === '/parceiros' || uri === '/parceiros/';
  if (isDeckRoot) {
    var base = uri.endsWith('/') ? uri : uri + '/';
    if (!qs._co) {
      return {
        statusCode: 302,
        statusDescription: 'Found',
        headers: { location: { value: base + '?_co=' + encodeURIComponent(company) + nameParam } },
      };
    }
    if (!qs._n) {
      return {
        statusCode: 200,
        statusDescription: 'OK',
        headers: { 'content-type': { value: 'text/html; charset=utf-8' } },
        body: { encoding: 'text', data: nameGateHTML(company, base) },
      };
    }
  }

  // ── 4. Clean-URL rewrite ─────────────────────────────────────────────────
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

function loginPageResponse(targetPath, showError) {
  return {
    statusCode: 200,
    statusDescription: 'OK',
    headers: { 'content-type': { value: 'text/html; charset=utf-8' } },
    body: { encoding: 'text', data: loginHTML(targetPath, showError) },
  };
}

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function loginHTML(targetPath, showError) {
  var errorHTML = showError
    ? '<p class="err">Usuário ou senha incorretos.</p>'
    : '';
  return (
    '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    OG_HEAD +
    '<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#f5f2ee;display:flex;' +
    'min-height:100vh;align-items:center;justify-content:center;margin:0}' +
    '.card{background:#fff;padding:36px 32px;border-radius:14px;max-width:360px;width:90%;' +
    'box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center}' +
    'h1{font-size:19px;margin:0 0 6px;color:#161616}p{color:#6b6b6b;font-size:14px;margin:0 0 22px}' +
    '.err{color:#DF3630;font-weight:600}' +
    'input{width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid #e7e2da;border-radius:8px;' +
    'font-size:15px;margin-bottom:14px}' +
    'button{width:100%;padding:12px;border:none;border-radius:8px;background:#DF3630;color:#fff;' +
    'font-size:15px;font-weight:600;cursor:pointer}' +
    '</style></head><body><div class="card">' +
    '<h1>Portfólio B2B GE Beauty</h1><p>Acesso reservado a parceiros convidados.</p>' +
    errorHTML +
    '<input id="u" placeholder="Usuário" autofocus>' +
    '<input id="p" type="password" placeholder="Senha">' +
    '<input id="nm" maxlength="60" placeholder="Seu nome">' +
    '<button onclick="go()">Entrar</button>' +
    '</div><script>function go(){' +
    'var u=document.getElementById("u").value.trim();' +
    'var p=document.getElementById("p").value;' +
    'var n=document.getElementById("nm").value.trim();' +
    'if(!u||!p)return;' +
    'location.href="https://"+encodeURIComponent(u)+":"+encodeURIComponent(p)+"@b2b.gebeauty.com.br' +
    targetPath +
    '?_n="+encodeURIComponent(n);' +
    '}[["u",false],["p",false],["nm",true]].forEach(function(f){' +
    'document.getElementById(f[0]).addEventListener("keydown",function(e){if(e.key==="Enter")go();});});' +
    '</script></body></html>'
  );
}

function nameGateHTML(company, targetPath) {
  var safeCompany = escapeHTML(company);
  return (
    '<!doctype html><html lang="pt-br"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    OG_HEAD +
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
