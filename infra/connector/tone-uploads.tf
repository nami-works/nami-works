// Per-tenant manual-reference uploads for the tone-of-voice pipeline. The
// manual-reference adapter writes PDFs / DOCX / TXT / MD blobs here under
// `tenants/<slug>/tone-uploads/<sourceId>` keys; extracted text lives in
// BrandToneSource.rawText, with a pointer back via metaJson.s3Key.
//
// Single bucket, tenant-prefixed object keys (rather than per-tenant
// buckets) — same model as the existing SSM `/nami-works/tenants/*` prefix.

resource "aws_s3_bucket" "tone_uploads" {
  bucket = "nami-works-tone-uploads"
}

resource "aws_s3_bucket_versioning" "tone_uploads" {
  bucket = aws_s3_bucket.tone_uploads.id

  versioning_configuration {
    // Versioning on. Manual uploads are merchant-curated assets; if a row is
    // accidentally deleted or overwritten we want a recovery path.
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "tone_uploads" {
  bucket = aws_s3_bucket.tone_uploads.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tone_uploads" {
  bucket = aws_s3_bucket.tone_uploads.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

// Grant the application task role Get/Put/Delete on tone-uploads keys. The
// connector's manual-reference adapter signs requests with this role's
// creds when running on ECS.
resource "aws_iam_role_policy" "task_app_tone_uploads" {
  name = "tone-uploads-rw"
  role = aws_iam_role.task_app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.tone_uploads.arn}/tenants/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.tone_uploads.arn
      },
    ]
  })
}

output "tone_uploads_bucket" {
  value       = aws_s3_bucket.tone_uploads.id
  description = "S3 bucket holding tenant tone-of-voice manual-reference binaries."
}
