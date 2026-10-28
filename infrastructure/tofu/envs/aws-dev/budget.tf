# Two budgets, because the Azure stack failed in the gap between them:
# credits ran out, the subscription quietly became pay-as-you-go, and the
# first sign was the bill.

# 1. Gross usage before credits — how fast the credits are burning.
resource "aws_budgets_budget" "usage" {
  name         = "${local.name_prefix}-usage-before-credits"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_usage_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = false
    include_refund = false
  }

  dynamic "notification" {
    for_each = [50, 80, 100]

    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = "ACTUAL"
      subscriber_email_addresses = [var.alert_email]
    }
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# 2. Net cost after credits — real money on the card. Fires at $1.
resource "aws_budgets_budget" "out_of_pocket" {
  name         = "${local.name_prefix}-out-of-pocket"
  budget_type  = "COST"
  limit_amount = tostring(var.out_of_pocket_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_types {
    include_credit = true
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 1
    threshold_type             = "ABSOLUTE_VALUE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}
