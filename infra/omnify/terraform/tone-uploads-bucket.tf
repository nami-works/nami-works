# ─────────────────────────────────────────────────────────────────────────────
# S3 bucket for Storytelling tone-source manual uploads (Phase 6 follow-up)
# ─────────────────────────────────────────────────────────────────────────────
#
# Stores the original PDF/DOCX/TXT/MD bytes that merchants upload via the
# /app/brand-settings/tone-sources page. Extracted text already lands in
# BrandToneSource.rawText (DB) — this bucket preserves the binary so the
# merchant can re-run extraction on a newer Claude model without re-uploading.
#
# Object key layout:  shops/<shop>/tone-uploads/<sourceId>
#   - shop is the Shopify shop domain (e.g. ge-beauty-cosmeticos.myshopify.com)
#   - sourceId is the BrandToneSource.sourceId column for the row
#
# Default: resources NOT created. Enable via `enable_tone_uploads_bucket = true`
# in terraform.tfvars. ECS task role gets s3:PutObject/GetObject/DeleteObject
# scoped to this bucket only.

variable "enable_tone_uploads_bucket" {
  description = "Whether to create the tone-uploads S3 bucket + IAM policy attachment."
  type        = bool
  default     = false
}

resource "aws_s3_bucket" "tone_uploads" {
  count = var.enable_tone_uploads_bucket ? 1 : 0

  bucket = "cpg-labs-tone-uploads"

  tags = {
    Name        = "cpg-labs-tone-uploads"
    Description = "Original brandbook/manifesto/etc binaries for Storytelling tone sources"
    ManagedBy   = "terraform"
  }
}

resource "aws_s3_bucket_public_access_block" "tone_uploads" {
  count = var.enable_tone_uploads_bucket ? 1 : 0

  bucket                  = aws_s3_bucket.tone_uploads[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tone_uploads" {
  count = var.enable_tone_uploads_bucket ? 1 : 0

  bucket = aws_s3_bucket.tone_uploads[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "tone_uploads" {
  count = var.enable_tone_uploads_bucket ? 1 : 0

  bucket = aws_s3_bucket.tone_uploads[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "tone_uploads" {
  count = var.enable_tone_uploads_bucket ? 1 : 0

  bucket = aws_s3_bucket.tone_uploads[0].id

  rule {
    id     = "expire-noncurrent-versions"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── Grant ECS task role read/write/delete on this bucket only ────────────────

data "aws_iam_policy_document" "tone_uploads_rw" {
  count = var.enable_tone_uploads_bucket && var.create_iam ? 1 : 0

  statement {
    sid     = "ToneUploadsObjectRW"
    effect  = "Allow"
    actions = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = [
      "${aws_s3_bucket.tone_uploads[0].arn}/*",
    ]
  }

  statement {
    sid       = "ToneUploadsBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.tone_uploads[0].arn]
  }
}

resource "aws_iam_policy" "tone_uploads_rw" {
  count = var.enable_tone_uploads_bucket && var.create_iam ? 1 : 0

  name   = "${local.name_prefix}-tone-uploads-rw"
  policy = data.aws_iam_policy_document.tone_uploads_rw[0].json
}

resource "aws_iam_role_policy_attachment" "ecs_task_tone_uploads" {
  count = var.enable_tone_uploads_bucket && var.create_iam ? 1 : 0

  role       = aws_iam_role.ecs_task[0].name
  policy_arn = aws_iam_policy.tone_uploads_rw[0].arn
}
