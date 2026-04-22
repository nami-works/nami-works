// Optional one-off operator ingress. Controlled by
// var.enable_operator_db_access; defaults off.
//
// Use case: running prisma migrate deploy or scripts/provision-tenant.ts
// against the prod RDS from the operator's laptop. RDS is private by default
// (no public IP), so this temporarily flips publicly_accessible=true on the
// DB instance (see rds.tf) AND opens 5432 ingress from the operator's IP.
//
// Usage:
//   1. Find your public IP:
//        (Invoke-WebRequest https://checkip.amazonaws.com).Content.Trim()
//   2. terraform apply `
//        '-var=enable_operator_db_access=true' `
//        '-var=operator_ip_cidr=1.2.3.4/32'
//      (expect ~5 min while RDS reconfigures)
//   3. Run migrations / provisioning from your laptop.
//   4. terraform apply        (defaults flip everything back to private)
//      (another ~5 min)

resource "aws_security_group_rule" "rds_from_operator" {
  count = var.enable_operator_db_access ? 1 : 0

  type              = "ingress"
  from_port         = 5432
  to_port           = 5432
  protocol          = "tcp"
  cidr_blocks       = [var.operator_ip_cidr]
  security_group_id = aws_security_group.rds.id
  description       = "TEMPORARY operator access for DB bootstrap. Remove when done."
}
