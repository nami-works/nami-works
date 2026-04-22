// Target group + host-based listener rule on the shared omnify-alb. Traffic
// for mcp.nami.works routes here; other hosts continue hitting CPG Labs'
// existing rules.

resource "aws_lb_target_group" "gateway" {
  name        = "nami-works-gw"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    path                = "/health"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 15
    matcher             = "200"
  }

  deregistration_delay = 20 // quick drain; the gateway is stateless
}

resource "aws_lb_listener_rule" "gateway" {
  listener_arn = var.alb_https_listener_arn
  priority     = var.alb_listener_rule_priority

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.gateway.arn
  }

  condition {
    host_header {
      values = [var.gateway_host]
    }
  }
}

// Attach the wildcard cert to the existing listener so TLS terminates for
// *.nami.works alongside whatever CPG Labs already has.
resource "aws_lb_listener_certificate" "gateway" {
  listener_arn    = var.alb_https_listener_arn
  certificate_arn = aws_acm_certificate_validation.wildcard.certificate_arn
}
