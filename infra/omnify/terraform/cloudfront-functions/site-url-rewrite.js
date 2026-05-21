// CloudFront Function — viewer-request URL rewriter for the public site.
//
// Astro builds with `build.format: "file"` produce flat `.html` files
// (`/about.html`, `/pricing.html`, etc.) but the site links use clean
// extension-less URLs (`/about`, `/pricing`). CloudFront's S3 origin does
// not auto-resolve `/about` -> `/about.html`, so without this function
// every clean URL returns 404 from the bucket.
//
// This function runs on every viewer request and rewrites the URI:
//   /            -> /index.html              (untouched if already that)
//   /about       -> /about.html
//   /about/      -> /about/index.html        (future-proof if format flips)
//   /_astro/x.js -> /_astro/x.js             (untouched, has extension)
//   /favicon.ico -> /favicon.ico             (untouched, has extension)
//   /screencast.mp4 -> /screencast.mp4       (untouched, has extension)
//
// Standard AWS recipe — see:
//   https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/example-function-add-index.html
//
// Deployed via aws_cloudfront_function.site_url_rewrite in site.tf, attached
// to the distribution's default_cache_behavior on event_type=viewer-request.

// eslint-disable-next-line no-unused-vars -- entry point invoked by the CloudFront runtime, not local code
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // Trailing slash -> append index.html (handles future "directory" format)
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
    return request;
  }

  // No file extension on the last segment -> append .html
  // We split on `/`, take the last piece, and check for a dot.
  // (Crude but matches every static-site URL we serve.)
  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.length > 0 && !lastSegment.includes('.')) {
    request.uri = uri + '.html';
  }

  return request;
}
