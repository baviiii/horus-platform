# Manual Webhook and Event Subscription Setup

**Complete guide to manually configure PDF upload automation**

This guide walks you through creating the webhook for your Automation Runbook and connecting it to Storage Account events.

---

## Prerequisites

- ✅ Automation Account created (`careercraft-automation`)
- ✅ Runbook created and published (`Process-SinglePDF`)
- ✅ Storage Account exists
- ✅ Azure Portal access

---

## Part 1: Create Webhook for Runbook

### Step 1: Navigate to Your Runbook

1. Open **Azure Portal**: https://portal.azure.com
2. In the search bar at the top, type: `careercraft-automation`
3. Click on your **Automation Account**: `careercraft-automation`
4. In the left menu, under **Process Automation**, click **Runbooks**
5. Click on the runbook: **Process-SinglePDF**

### Step 2: Add Webhook

1. At the top of the runbook page, click **Webhooks** (or click **Add webhook** button)
2. Click **+ Add webhook** button

### Step 3: Configure Webhook

1. **Name**: `pdf-upload-webhook`
2. **Enabled**: Yes (toggle should be ON)
3. **Expiry time**:
   - Click the calendar icon
   - Select a date **1 year from today**
   - This ensures the webhook doesn't expire soon
4. **Runbook**: Should already be set to `Process-SinglePDF`
5. **Parameters**: Leave as default (runbook will get blob name from Event Grid)

### Step 4: Create and Copy Webhook URL

1. Click **Create** button
2. **IMPORTANT**: Copy the **Webhook URL** that appears
   - It looks like: `https://xxx.webhook.azure-automation.net/xxx`
   - **Save this URL** - you'll need it in Part 2
   - **You won't be able to see it again after closing this page!**
3. Click **OK** to close

**✅ Webhook created!**

---

## Part 2: Create Event Subscription on Storage Account

### Step 1: Navigate to Your Storage Account

1. In Azure Portal, click **Home** (top left)
2. In the search bar, type: `ccdevc5takjp4zp3pw` (your storage account name)
3. Click on your **Storage Account**

### Step 2: Open Events Section

1. In the left menu, scroll down to **Data management**
2. Click **Events**

### Step 3: Create Event Subscription

1. At the top, click **+ Event Subscription** button

### Step 4: Configure Event Subscription

#### Basic Tab

1. **Name**: `pdf-upload-trigger`
2. **Event Schema**: Event Grid Schema (default)
3. Click **Next: Event Types**

#### Event Types Tab

1. Under **Event Types**, check only:
   - ✅ **Blob Created** (uncheck all others)
2. Click **Next: Filters**

#### Filters Tab

1. **Subject Begins With**:

   ```
   /blobServices/default/containers/rag-documents/
   ```

   - This filters events to only the `rag-documents` container

2. **Subject Ends With**:

   ```
   .pdf
   ```

   - This filters events to only PDF files

3. Click **Next: Endpoint**

#### Endpoint Tab

1. **Endpoint Type**: Select **Web Hook** from the dropdown
2. **Endpoint**:
   - Paste the **Webhook URL** you copied from Part 1, Step 4
   - It should look like: `https://xxx.webhook.azure-automation.net/xxx`

3. **Event Delivery Schema**: Event Grid Schema (default)

4. Click **Select an event subscription** to validate the webhook URL
   - Wait for validation to complete (should show green checkmark)

5. Click **Next: Additional Features**

#### Additional Features Tab

1. Leave defaults (no changes needed)
2. Click **Next: Summary**

#### Summary Tab

1. Review all settings:
   - Name: `pdf-upload-trigger`
   - Event Types: Blob Created
   - Filters: Subject begins with `/blobServices/default/containers/rag-documents/`
   - Filters: Subject ends with `.pdf`
   - Endpoint: Your webhook URL

2. Click **Create**

**✅ Event Subscription created!**

---

## Verification

### Test the Setup

1. **Upload a test PDF** to your storage account:
   - Go to Storage Account → **Containers** → **rag-documents**
   - Click **Upload**
   - Select a PDF file (any PDF will work)
   - Click **Upload**

2. **Check Runbook Execution**:
   - Go to Automation Account → **Process-SinglePDF** → **Jobs** (in left menu)
   - You should see a new job created within 1-2 minutes
   - The job should show status **Running** or **Completed**

3. **If job appears**:
   - ✅ **Setup is working!** PDF processing is automated
   - Click on the job to see execution details and logs

4. **If no job appears after 2-3 minutes**:
   - Check Event Subscription status (Storage Account → Events → `pdf-upload-trigger`)
   - Check for delivery failures
   - Verify webhook URL is correct

---

## Troubleshooting

### Webhook Not Created

**Problem**: Can't find "Add webhook" button

**Solution**:

- Make sure the runbook is **Published** (not in Draft state)
- Refresh the page
- Try using the **Webhooks** menu item instead

---

### Event Subscription Validation Fails

**Problem**: Webhook URL validation fails

**Solution**:

- Verify webhook URL is correct (no extra spaces)
- Make sure webhook is **Enabled** in Part 1
- Try creating the event subscription again

---

### Jobs Not Triggering

**Problem**: PDF uploaded but no runbook job created

**Checklist**:

1. ✅ Event Subscription exists and is enabled
2. ✅ PDF is uploaded to `rag-documents` container
3. ✅ File extension is `.pdf` (case-sensitive)
4. ✅ Webhook is enabled (Part 1, Step 3)
5. ✅ Check Event Subscription delivery status (Storage Account → Events → `pdf-upload-trigger` → Metrics)

---

### Runbook Job Fails

**Problem**: Job is created but fails

**Solution**:

- Click on the failed job in Automation Account → Jobs
- Check the error message in job output
- Common issues:
  - Missing Automation Variables (should have been set by setup script)
  - Storage connection string incorrect
  - Document Intelligence endpoint/key incorrect

---

## Alternative: Using Azure CLI

If you prefer command line, you can create the event subscription via Azure CLI:

### Step 1: Get Webhook URL

Create webhook via Portal (Part 1 above) or use Azure CLI:

```powershell
# This is complex via CLI, so Portal method (Part 1) is recommended
# But if you have the webhook URL, continue to Step 2
```

### Step 2: Create Event Subscription

After you have the webhook URL from Part 1:

```powershell
# Replace <WEBHOOK_URL> with the actual webhook URL from Part 1
$webhookUrl = "<WEBHOOK_URL>"

# Get storage account ID
$storageAccountId = az storage account show `
    --name ccdevc5takjp4zp3pw `
    --resource-group rg-careercraft-dev `
    --query id -o tsv

# Create event subscription
az eventgrid event-subscription create `
    --source-resource-id $storageAccountId `
    --name pdf-upload-trigger `
    --endpoint-type webhook `
    --endpoint $webhookUrl `
    --included-event-types Microsoft.Storage.BlobCreated `
    --subject-begins-with "/blobServices/default/containers/rag-documents/" `
    --subject-ends-with ".pdf"
```

**Note**: Creating webhooks via Azure CLI is complex, so using Portal (Part 1) is recommended.

---

## Summary

**What You Created:**

1. ✅ **Webhook** (`pdf-upload-webhook`)
   - Links Event Grid to your Automation Runbook
   - Location: Automation Account → Runbooks → Process-SinglePDF → Webhooks

2. ✅ **Event Subscription** (`pdf-upload-trigger`)
   - Triggers on PDF uploads to `rag-documents` container
   - Location: Storage Account → Events

**How It Works:**

```
PDF Uploaded to Storage (rag-documents container)
        ↓
Event Grid Detects (filters: .pdf files)
        ↓
Sends HTTP POST to Webhook URL
        ↓
Automation Account Receives Webhook
        ↓
Starts Runbook: Process-SinglePDF
        ↓
Runbook Processes PDF
        ↓
PDF Indexed to Azure Search
```

**✅ Setup Complete!** Your PDF processing is now automated.

---

**Last Updated:** 2026-01-11
