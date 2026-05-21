resource "aws_lb" "app" {
  name               = "${local.name_prefix}-alb"
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids
  # Route optimization for 20+ orders can take up to ~90s because Phase 5b
  # re-quotes Lalamove for each relocation. Default 60s timeout was cutting
  # browser requests off before the backend finished. 120s gives headroom.
  idle_timeout = 90
}

resource "aws_lb_target_group" "app" {
  name        = "${local.name_prefix}-tg"
  port        = var.app_port
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "ip"

  health_check {
    path                = "/"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200-399"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# cpg-labs.io marketing website routing — RETIRED 2026-05-02 (Phase 3 of the
# marketing-admin split). The public site now serves from S3 + CloudFront via
# infra/terraform/site.tf. DNS for www.cpg-labs.io was repointed at GoDaddy
# from `omnify-alb-2060949013...` to `d1cuwnxki4q9wr.cloudfront.net`.
#
# What used to live here:
#   - aws_lb_listener_certificate.site (cert attached to ALB for cpg-labs.io)
#   - aws_lb_listener_rule.site_root (www.cpg-labs.io -> omnify target group)
#   - aws_lb_listener_rule.site_www_redirect (cpg-labs.io 301 -> www)
# All three are gone alongside the admin-side _site.* / _index/ marketing
# routes deleted in this same commit. The ACM cert itself (588d00ef-...)
# remains in ACM and is now consumed by aws_cloudfront_distribution.site.
