#!/usr/bin/env bash
# Adds AWS's Web Search Tool to the coach's AgentCore Gateway (web-search.tf).
#
# OpenTofu can't declare connector targets yet (hashicorp/terraform-provider-aws
# #48503), so this does it with the AWS CLI. Safe to re-run: it does nothing
# when the target is already there. Run from this env's directory after the
# apply that created the gateway:
#
#   ./scripts/web-search-target.sh [aws-profile]      (default profile: horus)
#
# Pinned to connector version 1.3.0: request-level domain filters (which the
# coach uses to search only discussion sites) need 1.2.0 or later.
set -euo pipefail

cd "$(dirname "$0")/.."
PROFILE="${1:-horus}"
REGION="$(tofu output -raw region)"
GATEWAY_ID="$(tofu output -raw web_search_gateway_id)"
TARGET_NAME="web-search"

existing="$(aws bedrock-agentcore-control list-gateway-targets \
  --gateway-identifier "$GATEWAY_ID" --region "$REGION" --profile "$PROFILE" \
  --query "items[?name=='${TARGET_NAME}'].targetId" --output text)"
if [ -n "$existing" ] && [ "$existing" != "None" ]; then
  echo "Web Search Tool target already on gateway $GATEWAY_ID ($existing)."
  exit 0
fi

aws bedrock-agentcore-control create-gateway-target \
  --gateway-identifier "$GATEWAY_ID" \
  --name "$TARGET_NAME" \
  --description "AWS Web Search Tool for the interview coach" \
  --target-configuration '{"mcp":{"connector":{"source":{"connectorId":"web-search","version":"1.3.0"},"configurations":[{"name":"WebSearch","parameterValues":{}}]}}}' \
  --credential-provider-configurations '[{"credentialProviderType":"GATEWAY_IAM_ROLE"}]' \
  --region "$REGION" --profile "$PROFILE"

echo "Added the Web Search Tool target to gateway $GATEWAY_ID."
