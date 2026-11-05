# Web search for the interview coach's Study page: an Amazon Bedrock
# AgentCore Gateway carrying AWS's Web Search Tool. Amazon runs the index,
# queries stay inside AWS, and it's billed to this account (US$7 per 1,000
# searches), so AWS credits pay for it.
#
# The coach authenticates with its own Lambda role (AWS_IAM inbound auth,
# SigV4-signed requests), so there is no key to store. The gateway's own
# service role is what may run web searches.
#
# The Web Search Tool *target* (a "connector") can't be declared with the AWS
# provider yet (hashicorp/terraform-provider-aws#48503), so after the first
# apply run scripts/web-search-target.sh once to add it. Until then the coach
# falls back to Tavily (or shows nothing), never an error.

locals {
  web_search_name = "${local.name_prefix}-web-search"
}

data "aws_iam_policy_document" "web_search_gateway_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock-agentcore.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "web_search_gateway" {
  name               = local.web_search_name
  assume_role_policy = data.aws_iam_policy_document.web_search_gateway_assume.json
}

# What the AgentCore docs ask of a Web Search Tool gateway's service role:
# invoke the gateway, and run searches against the AWS-owned web search tool.
data "aws_iam_policy_document" "web_search_gateway" {
  statement {
    sid       = "InvokeGateway"
    actions   = ["bedrock-agentcore:InvokeGateway"]
    resources = ["arn:aws:bedrock-agentcore:${var.region}:${data.aws_caller_identity.current.account_id}:gateway/*"]
  }
  statement {
    sid       = "InvokeWebSearch"
    actions   = ["bedrock-agentcore:InvokeWebSearch"]
    resources = ["arn:aws:bedrock-agentcore:${var.region}:aws:tool/web-search.v1"]
  }
}

resource "aws_iam_role_policy" "web_search_gateway" {
  name   = "web-search"
  role   = aws_iam_role.web_search_gateway.id
  policy = data.aws_iam_policy_document.web_search_gateway.json
}

resource "aws_bedrockagentcore_gateway" "web_search" {
  name            = local.web_search_name
  description     = "Web search for the interview coach (Study: discussions, courses and guides)."
  role_arn        = aws_iam_role.web_search_gateway.arn
  authorizer_type = "AWS_IAM"
  protocol_type   = "MCP"
}

# The coach may call this gateway — and nothing else in AgentCore.
data "aws_iam_policy_document" "mcp_web_search" {
  statement {
    actions   = ["bedrock-agentcore:InvokeGateway"]
    resources = [aws_bedrockagentcore_gateway.web_search.gateway_arn]
  }
}

resource "aws_iam_role_policy" "mcp_web_search" {
  name   = "invoke-web-search-gateway"
  role   = aws_iam_role.mcp.id
  policy = data.aws_iam_policy_document.mcp_web_search.json
}

output "web_search_gateway_id" {
  value = aws_bedrockagentcore_gateway.web_search.gateway_id
}

output "web_search_gateway_url" {
  value = aws_bedrockagentcore_gateway.web_search.gateway_url
}
