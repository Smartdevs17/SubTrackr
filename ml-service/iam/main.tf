terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# One IAM role per ml-service workload (IRSA). Each role trusts exactly one
# Kubernetes ServiceAccount in var.k8s_namespace and carries only the policy
# in policies/<policy_file>. Policy JSON uses ${bucket_arn} as the bucket placeholder.
locals {
  bucket_arn = "arn:aws:s3:::${var.artifact_bucket_name}"

  workloads = {
    "ml-inference" = {
      policy_file = "ml-inference.json"
    }
    "ml-service-api" = {
      policy_file = "ml-service-api.json"
    }
    "ml-model-trainer" = {
      policy_file = "ml-model-trainer.json"
    }
    "ml-feature-pipeline" = {
      policy_file = "ml-feature-pipeline.json"
    }
  }
}

data "aws_iam_policy_document" "trust" {
  for_each = local.workloads

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_host}:sub"
      values   = ["system:serviceaccount:${var.k8s_namespace}:${each.key}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${var.oidc_provider_host}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "workload" {
  for_each = local.workloads

  name                 = "${var.role_name_prefix}${each.key}"
  assume_role_policy   = data.aws_iam_policy_document.trust[each.key].json
  max_session_duration = 3600
}

resource "aws_iam_policy" "workload" {
  for_each = local.workloads

  name = "${var.role_name_prefix}${each.key}"
  policy = templatefile(
    "${path.module}/policies/${each.value.policy_file}",
    { bucket_arn = local.bucket_arn }
  )
}

resource "aws_iam_role_policy_attachment" "workload" {
  for_each = local.workloads

  role       = aws_iam_role.workload[each.key].name
  policy_arn = aws_iam_policy.workload[each.key].arn
}

output "workload_role_arns" {
  description = "IAM role ARN per workload; set as eks.amazonaws.com/role-arn on its ServiceAccount."
  value       = { for name, role in aws_iam_role.workload : name => role.arn }
}
