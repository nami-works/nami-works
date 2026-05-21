// Dedicated Postgres for NAMI Works. ~$15/mo. Independent backups from CPG
// Labs per the approved plan.

resource "aws_security_group" "ecs_task" {
  name        = "nami-works-ecs-task"
  description = "NAMI Works gateway task SG. Ingress: ALB on 3000. Egress: all."
  vpc_id      = var.vpc_id

  egress {
    from_port        = 0
    to_port          = 0
    protocol         = "-1"
    cidr_blocks      = ["0.0.0.0/0"]
    ipv6_cidr_blocks = ["::/0"]
    description      = "All outbound (Shopify, Omie, SSM, ECR, CloudWatch)."
  }

  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
    description     = "From the shared ALB only."
  }
}

resource "aws_security_group" "rds" {
  name        = "nami-works-rds"
  description = "Postgres SG. Ingress only from the NAMI Works ECS task SG."
  vpc_id      = var.vpc_id
}

// Split the ingress rule into a standalone resource so we can reference the
// ecs_task SG without a circular SG->SG dependency in a single block.
resource "aws_security_group_rule" "rds_from_ecs_task" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_task.id
  security_group_id        = aws_security_group.rds.id
  description              = "Postgres from the NAMI Works task."
}

resource "aws_db_subnet_group" "nami_works" {
  name        = "nami-works"
  subnet_ids  = var.rds_subnet_ids
  description = "Three-AZ subnet group for the NAMI Works Postgres instance."
}

resource "random_password" "rds" {
  length  = 40
  special = false // avoid characters that escape poorly in a DSN
}

resource "aws_db_instance" "nami_works" {
  identifier              = "nami-works"
  engine                  = "postgres"
  engine_version          = "16.4"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_type            = "gp3"
  storage_encrypted       = true
  db_name                 = "nami_works"
  username                = "nami_works_app"
  password                = random_password.rds.result
  db_subnet_group_name    = aws_db_subnet_group.nami_works.name
  vpc_security_group_ids  = [aws_security_group.rds.id]
  publicly_accessible     = var.enable_operator_db_access
  backup_retention_period = 7
  deletion_protection     = true
  skip_final_snapshot     = false
  // Static final-snapshot name so tf plan is stable across runs. Operator
  // can delete the snapshot manually if the instance is torn down.
  final_snapshot_identifier = "nami-works-final"

  lifecycle {
    // Avoid an accidental password churn replacing the DB.
    ignore_changes = [password]
  }
}

// The task needs the full connection string. Store it as a SecureString in
// SSM and surface it through the task definition's `secrets`.
resource "aws_ssm_parameter" "database_url" {
  name  = "/nami-works/app/database_url"
  type  = "SecureString"
  value = "postgresql://${aws_db_instance.nami_works.username}:${random_password.rds.result}@${aws_db_instance.nami_works.endpoint}/${aws_db_instance.nami_works.db_name}?sslmode=require&schema=public"
}
