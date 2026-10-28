# Credentials come from the standard chain: `aws sso login` / a named profile
# (AWS_PROFILE) for whoever runs `tofu apply`. The app itself gets its own
# least-privilege user from iam.tf, never these credentials.
provider "aws" {
  region = var.region

  default_tags {
    tags = local.common_tags
  }
}

provider "random" {}
