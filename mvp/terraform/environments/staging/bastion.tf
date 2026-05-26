# ─── Bastion EC2 for one-off DB access via SSM Session Manager ────────────────
# No SSH key, no inbound ports. Auth + transport via AWS Systems Manager.
# Use with: aws ssm start-session --target <bastion_instance_id> \
#   --document-name AWS-StartPortForwardingSessionToRemoteHost \
#   --parameters host="<rds-endpoint>",portNumber="5432",localPortNumber="5432"

resource "aws_iam_role" "bastion" {
  name = "${local.project}-${local.environment}-bastion"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy_attachment" "bastion_ssm" {
  role       = aws_iam_role.bastion.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "bastion" {
  name = "${local.project}-${local.environment}-bastion"
  role = aws_iam_role.bastion.name
}

data "aws_ami" "amzn2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
}

# Reuse the ECS task SG so the bastion can reach RDS and Redis through
# the existing isolated-subnet allowlists (no new ingress rules needed).
resource "aws_instance" "bastion" {
  ami                    = data.aws_ami.amzn2023.id
  instance_type          = "t3.micro"
  subnet_id              = module.vpc.private_subnet_ids[0]
  vpc_security_group_ids = [module.vpc.ecs_sg_id]
  iam_instance_profile   = aws_iam_instance_profile.bastion.name

  metadata_options {
    http_tokens = "required"
  }

  tags = merge(local.common_tags, {
    Name = "${local.project}-${local.environment}-bastion"
  })
}

output "bastion_instance_id" {
  description = "Instance ID for SSM port forwarding to RDS."
  value       = aws_instance.bastion.id
}
