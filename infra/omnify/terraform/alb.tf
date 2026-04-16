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

# ── cpg-labs.io marketing website routing ──

# Additional SSL cert for apex domain (only if provided)
resource "aws_lb_listener_certificate" "site" {
  count           = var.site_certificate_arn != "" ? 1 : 0
  listener_arn    = aws_lb_listener.https.arn
  certificate_arn = var.site_certificate_arn
}

# Route www.cpg-labs.io → omnify target group (same app serves public routes)
resource "aws_lb_listener_rule" "site_root" {
  count        = var.site_certificate_arn != "" ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 3

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }

  condition {
    host_header {
      values = ["www.cpg-labs.io"]
    }
  }
}

# Redirect cpg-labs.io → www.cpg-labs.io (301)
resource "aws_lb_listener_rule" "site_www_redirect" {
  count        = var.site_certificate_arn != "" ? 1 : 0
  listener_arn = aws_lb_listener.https.arn
  priority     = 2

  action {
    type = "redirect"
    redirect {
      host        = "www.cpg-labs.io"
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  condition {
    host_header {
      values = ["cpg-labs.io"]
    }
  }
}
