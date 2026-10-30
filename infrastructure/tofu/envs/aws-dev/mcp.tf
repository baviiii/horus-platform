# interview-coach-mcp on Lambda: the same Express image that ran on Azure
# Container Apps, behind a public function URL. App Runner is closed to new
# customers, and Lambda keeps the scale-to-zero cost (≈$0 idle) the Container
# App had. The image carries the Lambda Web Adapter, which runs the unchanged
# Express server inside Lambda; the server is already stateless MCP
# (sessionIdGenerator: undefined), so no per-session state is lost between
# invocations.
#
# Rollout, because Lambda needs an image to exist before the function can:
#   1. Apply with mcp_image_tag unset: creates the registry, the runtime role
#      and the GitHub deploy role, but no function yet.
#   2. Push the image. The MCP repo's CI does this on every push to main.
#   3. Set mcp_image_tag to that commit and apply again: creates the function
#      and its URL.
# From then on CI rolls new images onto the function itself; Tofu owns the
# settings, not which image is live (see ignore_changes below).

locals {
  mcp_name   = "${local.name_prefix}-interview-coach-mcp"
  mcp_deploy = var.mcp_image_tag != null

  # Lambda's arn is built by hand so the deploy role can name the function
  # before step 3 has created it.
  mcp_function_arn = "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:${local.mcp_name}"
}

# ── Image registry ──────────────────────────────────────────────────────────

# Lambda can only pull from ECR; the public ghcr.io image the Azure deploy
# used isn't reachable from Lambda.
resource "aws_ecr_repository" "mcp" {
  name = "interview-coach-mcp"
  # Tags are commit SHAs. Mutable so a re-run of the same commit can push again.
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Every push to main adds an image; old ones are billed storage nobody runs.
resource "aws_ecr_lifecycle_policy" "mcp" {
  repository = aws_ecr_repository.mcp.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the 10 most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = { type = "expire" }
    }]
  })
}

# ── Runtime identity ────────────────────────────────────────────────────────

data "aws_iam_policy_document" "mcp_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# Logs only. The server reaches Supabase and Horus over HTTPS with keys from
# its settings; it calls no AWS service itself.
resource "aws_iam_role" "mcp" {
  name               = local.mcp_name
  assume_role_policy = data.aws_iam_policy_document.mcp_assume.json
}

resource "aws_iam_role_policy_attachment" "mcp_logs" {
  role       = aws_iam_role.mcp.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Created here rather than on first invoke so retention applies from day one.
resource "aws_cloudwatch_log_group" "mcp" {
  name              = "/aws/lambda/${local.mcp_name}"
  retention_in_days = 14
}

# ── Function ────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "mcp" {
  count = local.mcp_deploy ? 1 : 0

  function_name = local.mcp_name
  role          = aws_iam_role.mcp.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.mcp.repository_url}:${var.mcp_image_tag}"
  architectures = ["x86_64"]
  memory_size   = var.mcp_memory_mb
  # Tool calls fan out to research sources and a model call (LLM_TIMEOUT_MS,
  # 60 s by default); the function must outlast that.
  timeout = var.mcp_timeout_seconds

  # Lambda encrypts these at rest. Secrets come from mcp_secrets (sensitive,
  # gitignored tfvars) and sit in local state, the same trade-off as the app
  # user's access key in iam.tf.
  environment {
    variables = merge(
      var.mcp_settings,
      var.mcp_secrets,
      {
        # Enforces the auth guard: every /mcp and /api call needs a Supabase JWT.
        NODE_ENV    = "production"
        PORT        = "8787"
        CORS_ORIGIN = var.mcp_cors_origin

        # Lambda Web Adapter: forward to the Express port, wait for /health
        # before the first request, and stream responses (MCP answers as SSE).
        AWS_LWA_PORT                 = "8787"
        AWS_LWA_READINESS_CHECK_PATH = "/health"
        AWS_LWA_INVOKE_MODE          = "response_stream"
      },
    )
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.mcp.name
  }

  # No reserved concurrency: new accounts start with a concurrency quota of 10
  # and Lambda refuses any reservation that leaves fewer than 10 unreserved.
  # The server's own rate limit (RATE_LIMIT_MAX) is the spend guard.

  # CI deploys new images with update-function-code; without this, the next
  # apply would roll the function back to mcp_image_tag.
  lifecycle {
    ignore_changes = [image_uri]
  }

  depends_on = [
    aws_iam_role_policy_attachment.mcp_logs,
    aws_cloudwatch_log_group.mcp,
  ]
}

# Public on purpose: the server checks a Supabase JWT on every /mcp and /api
# call, as it did on Azure. Creating a NONE-auth URL also adds the two
# resource-policy statements that make it reachable (InvokeFunctionUrl, and
# InvokeFunction limited to calls through the URL).
#
# CORS is left to the server (CORS_ORIGIN) rather than configured here, so
# there is one place that decides it.
resource "aws_lambda_function_url" "mcp" {
  count = local.mcp_deploy ? 1 : 0

  function_name      = aws_lambda_function.mcp[0].function_name
  authorization_type = "NONE"
  invoke_mode        = "RESPONSE_STREAM"
}

# ── Keyless deploys from GitHub Actions ─────────────────────────────────────

# Same model as the Azure deploy identity: GitHub mints a short-lived OIDC
# token and AWS trades it for this role, which only accepts the MCP repo's
# main branch. No stored keys.
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

locals {
  github_oidc_provider_arn = (
    var.create_github_oidc_provider
    ? aws_iam_openid_connect_provider.github[0].arn
    : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
  )
}

data "aws_iam_policy_document" "mcp_deploy_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Forks, pull requests and other branches can't assume this role.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.mcp_github_repo}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "mcp_deploy" {
  name               = "${local.mcp_name}-deploy"
  assume_role_policy = data.aws_iam_policy_document.mcp_deploy_assume.json
}

data "aws_iam_policy_document" "mcp_deploy" {
  # Docker login to ECR. GetAuthorizationToken has no resource-level scoping.
  statement {
    sid       = "RegistryLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = [aws_ecr_repository.mcp.arn]
  }

  # Roll the function onto the new image, wait for it, and find its URL for
  # the health check. Code only: settings stay with Tofu.
  statement {
    sid = "RollFunction"
    actions = [
      "lambda:GetFunction",
      "lambda:GetFunctionConfiguration",
      "lambda:GetFunctionUrlConfig",
      "lambda:UpdateFunctionCode",
    ]
    resources = [local.mcp_function_arn]
  }
}

resource "aws_iam_role_policy" "mcp_deploy" {
  name   = "deploy-interview-coach-mcp"
  role   = aws_iam_role.mcp_deploy.id
  policy = data.aws_iam_policy_document.mcp_deploy.json
}
