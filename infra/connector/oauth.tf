// HMAC-SHA256 signing key for OAuth-issued JWTs (access tokens + client_ids).
// Generated once on first apply, then ignored. Rotation = manual: `aws ssm
// put-parameter --overwrite` and the gateway picks up the new value within
// SSM TTL (~5 min). Old tokens become invalid on rotation.

resource "random_password" "oauth_signing_key" {
  length  = 64
  special = false // base64-style; HMAC accepts any bytes but we want shell-safe
}

resource "aws_ssm_parameter" "oauth_signing_key" {
  name  = "/nami-works/app/oauth_signing_key"
  type  = "SecureString"
  value = random_password.oauth_signing_key.result

  lifecycle {
    ignore_changes = [value] // never auto-rotate; manual only
  }
}
