# Moderation: Bedrock Guardrails replaces Azure Content Safety. The app calls
# ApplyGuardrail on chat input, crawled pages, PDFs and incident photos.
#
# MEDIUM strength blocks medium- and high-confidence hits, matching the
# Azure rule (block at severity >= 4). No PROMPT_ATTACK filter: crawled
# pages and documents are full of instructions-shaped text, and Azure's
# text:analyze had no prompt shield either.
resource "aws_bedrock_guardrail" "main" {
  name                      = "${local.name_prefix}-moderation"
  description               = "Horus input moderation: harm categories at MEDIUM, text and images."
  blocked_input_messaging   = "This content was blocked by the content policy."
  blocked_outputs_messaging = "This response was blocked by the content policy."

  content_policy_config {
    dynamic "filters_config" {
      for_each = toset(["HATE", "INSULTS", "MISCONDUCT", "SEXUAL", "VIOLENCE"])

      content {
        type              = filters_config.value
        input_strength    = "MEDIUM"
        output_strength   = "MEDIUM"
        input_modalities  = ["TEXT", "IMAGE"]
        output_modalities = ["TEXT", "IMAGE"]
      }
    }
  }
}

# A numbered version so a later edit to the DRAFT can't change production
# behaviour until it's published and HORUS_BEDROCK_GUARDRAIL_VERSION moves.
resource "aws_bedrock_guardrail_version" "main" {
  guardrail_arn = aws_bedrock_guardrail.main.guardrail_arn
  description   = "Initial moderation policy"
}
