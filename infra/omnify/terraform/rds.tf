resource "aws_db_subnet_group" "app" {
  count      = var.create_rds ? 1 : 0
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = data.aws_subnets.default.ids
}

resource "aws_security_group" "rds" {
  count       = var.create_rds ? 1 : 0
  name        = "${local.name_prefix}-rds-sg"
  description = "Allow Postgres from ECS"
  vpc_id      = data.aws_vpc.default.id
}

resource "aws_security_group_rule" "rds_ingress" {
  count                    = var.create_rds ? 1 : 0
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.rds[0].id
  source_security_group_id = aws_security_group.ecs.id
}

resource "aws_db_instance" "app" {
  count                       = var.create_rds ? 1 : 0
  identifier                  = "${local.name_prefix}-postgres"
  engine                      = "postgres"
  engine_version              = "16.3"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  db_name                     = var.db_name
  username                    = var.db_username
  password                    = var.db_password
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${local.name_prefix}-postgres-final-snapshot"
  deletion_protection         = true
  publicly_accessible         = false
  db_subnet_group_name        = aws_db_subnet_group.app[0].name
  vpc_security_group_ids      = [aws_security_group.rds[0].id]

  lifecycle {
    prevent_destroy = true
  }
}
