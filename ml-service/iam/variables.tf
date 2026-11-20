variable "artifact_bucket_name" {
  description = "S3 bucket holding ml-service artifacts (models/onnx/, models/registry/, features/daily/)."
  type        = string
}

variable "oidc_provider_arn" {
  description = "ARN of the cluster's IAM OIDC provider used for IRSA."
  type        = string
}

variable "oidc_provider_host" {
  description = "OIDC issuer host without scheme, e.g. oidc.eks.us-east-1.amazonaws.com/id/EXAMPLE."
  type        = string
}

variable "k8s_namespace" {
  description = "Namespace the ml-service ServiceAccounts live in."
  type        = string
  default     = "subtrackr"
}

variable "role_name_prefix" {
  description = "Prefix for IAM role and policy names."
  type        = string
  default     = "subtrackr-"
}
