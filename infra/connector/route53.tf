// Route 53 hosted zone for nami.works. The registrar (Registro.br / GoDaddy /
// wherever) still owns the delegation. After the first apply, copy the four
// NS records from `terraform output route53_name_servers` into the registrar's
// DNS panel. Until that delegation lands, ACM validation below will block.

resource "aws_route53_zone" "main" {
  name = var.domain
  comment = "NAMI Works managed zone. Delegated from registrar."
}

data "aws_lb" "alb" {
  arn = var.alb_arn
}

resource "aws_route53_record" "mcp" {
  zone_id = aws_route53_zone.main.zone_id
  name    = var.gateway_host
  type    = "A"

  alias {
    name                   = data.aws_lb.alb.dns_name
    zone_id                = data.aws_lb.alb.zone_id
    evaluate_target_health = true
  }
}
