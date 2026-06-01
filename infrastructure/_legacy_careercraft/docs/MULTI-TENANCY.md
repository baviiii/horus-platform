# Multi-Tenancy Architecture

## Overview

CareerCraft's infrastructure supports multi-tenancy, allowing you to serve multiple organizations (tenants) from a single Azure deployment. This enables SaaS scalability while maintaining data isolation and cost efficiency.

## Tenant Isolation Strategy

### Shared Resources (Cost-Optimized)

The following Azure resources are shared across all tenants to minimize costs:

- **Azure Storage Account**: Single storage account with tenant-specific containers
- **Azure AI Search Service**: Single search service with tenant-specific indexes
- **Azure Document Intelligence**: Shared across tenants
- **Azure OpenAI** (if enabled): Shared across tenants
- **Azure Functions App**: Single functions app handling all tenants
- **Cosmos DB Account**: Single account with tenant-specific databases/graphs

### Tenant-Specific Resources

Each tenant gets their own isolated:

1. **Storage Container**: `{tenant-id}-documents` (e.g., `acme-corp-documents`)
2. **Search Index**: `{tenant-id}-documents` (e.g., `acme-corp-documents`)
3. **Cosmos DB Graph**: `{tenant-id}-graph` in `{tenant-id}-graphdb` database
4. **Graph Database**: `{tenant-id}-graphdb` (e.g., `acme-corp-graphdb`)

## Cost Analysis

### Initial Deployment (Single Tenant)

- Azure AI Search (Basic): ~$200/month
- Document Intelligence (S0): ~$50-100/month
- Blob Storage (Standard LRS): ~$5-10/month
- Azure OpenAI (if enabled): ~$20-50/month
- Azure Functions: ~$10-30/month (consumption-based)
- Cosmos DB (Serverless): ~$25-75/month (usage-based)
- **Total: ~$310-465/month**

### Additional Tenants

Each additional tenant adds:

- Storage Container: ~$2-5/month (minimal)
- Search Index: ~$5-10/month (data-dependent)
- Cosmos Graph: ~$5-20/month (usage-based)
- **Total per additional tenant: ~$12-35/month**

### Break-Even Analysis

- Multi-tenant architecture is cost-effective for 2+ tenants
- Dedicated infrastructure per tenant would cost $310-465/month each
- Savings: ~90% per tenant after the 2nd tenant

## Deployment

### Deploy Infrastructure for First Tenant

```powershell
# Deploy all resources with multi-tenancy enabled
.\infrastructure\scripts\deploy-all.ps1 `
    -ResourceGroupName "rg-careercraft-prod" `
    -Environment "prod" `
    -EnableOpenAI `
    -EnableMultiTenancy `
    -TenantId "acme-corp" `
    -DeployCosmosGraph `
    -DeployAzureFunctions
```

### Add Additional Tenants

```powershell
# Deploy tenant-specific resources only (reuses shared infrastructure)
.\infrastructure\scripts\deploy-all.ps1 `
    -ResourceGroupName "rg-careercraft-prod" `
    -Environment "prod" `
    -EnableMultiTenancy `
    -TenantId "globex-inc" `
    -DeployCosmosGraph:$false `
    -DeployAzureFunctions:$false `
    -SkipWebScraping
```

**Note**: Set `-DeployCosmosGraph:$false` and `-DeployAzureFunctions:$false` for additional tenants since these resources are already deployed.

### Deploy Only Tenant Graph Database

```powershell
# Deploy just the Cosmos DB graph for a new tenant
.\infrastructure\scripts\deploy-graph.ps1 `
    -ResourceGroup "rg-careercraft-prod" `
    -AccountName "careercraft-graph-prod" `
    -TenantId "globex-inc" `
    -EnableMultiTenancy
```

## Application Configuration

### Environment Variables (Per Tenant)

Add these tenant-specific variables to your application:

```env
# Tenant Identification
VITE_TENANT_ID=acme-corp

# Tenant-Specific Resources
VITE_SEARCH_INDEX=acme-corp-documents
VITE_STORAGE_CONTAINER=acme-corp-documents

# Shared Resources (same for all tenants)
VITE_AZURE_STORAGE_ACCOUNT=ccprod{uniquestring}
VITE_AZURE_STORAGE_KEY={storage-key}
VITE_AZURE_SEARCH_ENDPOINT=https://careercraft-search-prod.search.windows.net
VITE_AZURE_SEARCH_KEY={search-key}
VITE_AZURE_DOC_INTEL_ENDPOINT=https://careercraft-docintel-prod.cognitiveservices.azure.com/
VITE_AZURE_DOC_INTEL_KEY={doc-intel-key}
VITE_AZURE_FUNCTIONS_URL=https://careercraft-functions-prod.azurewebsites.net
VITE_AZURE_FUNCTIONS_KEY={functions-key}

# Cosmos DB (Tenant-specific database/graph)
COSMOS_GREMLIN_ENDPOINT=wss://careercraft-graph-prod.gremlin.cosmos.azure.com:443/
COSMOS_PRIMARY_KEY={cosmos-key}
COSMOS_DATABASE=acme-corp-graphdb
COSMOS_GRAPH=acme-corp-graph
```

### Azure Functions Configuration

Update Azure Functions app settings to handle multiple tenants:

```powershell
az functionapp config appsettings set `
    --name careercraft-functions-prod `
    --resource-group rg-careercraft-prod `
    --settings `
        "ENABLE_MULTI_TENANCY=true" `
        "DEFAULT_TENANT_ID=default"
```

## Data Isolation

### Storage Isolation

- Each tenant has a dedicated blob container
- Container-level access control via SAS tokens
- No cross-tenant data access possible

### Search Isolation

- Each tenant has a dedicated search index
- Index-level security ensures tenant data separation
- Query filtering by index name prevents data leakage

### Graph Isolation

- Each tenant has a dedicated Cosmos DB database
- Graph-level isolation ensures complete data separation
- Partition key: `/entity_type` for efficient queries within tenant graphs

## Tenant Management

### List All Tenants

```powershell
# List all search indexes (one per tenant)
az search index list `
    --resource-group rg-careercraft-prod `
    --service-name careercraft-search-prod `
    --query "[].name" -o table

# List all storage containers (one per tenant)
az storage container list `
    --account-name {storage-account-name} `
    --auth-mode login `
    --query "[].name" -o table

# List all Cosmos DB databases (one per tenant)
az cosmosdb gremlin database list `
    --account-name careercraft-graph-prod `
    --resource-group rg-careercraft-prod `
    --query "[].name" -o table
```

### Delete Tenant Data

```powershell
# Delete tenant search index
az search index delete `
    --name "{tenant-id}-documents" `
    --service-name careercraft-search-prod `
    --resource-group rg-careercraft-prod

# Delete tenant storage container
az storage container delete `
    --name "{tenant-id}-documents" `
    --account-name {storage-account-name} `
    --auth-mode login

# Delete tenant Cosmos DB database
az cosmosdb gremlin database delete `
    --account-name careercraft-graph-prod `
    --resource-group rg-careercraft-prod `
    --name "{tenant-id}-graphdb" `
    --yes
```

## Security Considerations

### Tenant Context in Application

Implement tenant context resolution in your application:

1. **URL-based**: `https://acme-corp.careercraft.com`
2. **Subdomain**: `https://acme.careercraft.com`
3. **Header-based**: `X-Tenant-ID: acme-corp`
4. **User-based**: Resolve tenant from authenticated user

### Azure Functions Tenant Handling

Update your Azure Functions to extract and validate tenant context:

```javascript
// Example: Extract tenant from request header
const tenantId = req.headers['x-tenant-id'] || 'default';

// Validate tenant exists
if (!isValidTenant(tenantId)) {
  return { status: 403, body: 'Invalid tenant' };
}

// Use tenant-specific resources
const searchIndex = `${tenantId}-documents`;
const cosmosDatabase = `${tenantId}-graphdb`;
const cosmosGraph = `${tenantId}-graph`;
```

### Access Control

Implement tenant-scoped access control:

1. **Authentication**: Verify user identity (Supabase Auth, Azure AD)
2. **Authorization**: Check user has access to tenant
3. **Data Filtering**: Apply tenant context to all queries
4. **Audit Logging**: Log all tenant-scoped operations

## Migration Path

### From Single-Tenant to Multi-Tenant

If you deployed without multi-tenancy initially:

```powershell
# 1. Create tenant-specific resources for existing data
$existingTenant = "default"

# 2. Create new search index for tenant
az search index create --name "$existingTenant-documents" ...

# 3. Copy data from old index to new tenant index
# (Use process-pdfs.ps1 to reindex)

# 4. Create tenant storage container
az storage container create --name "$existingTenant-documents" ...

# 5. Copy blobs to tenant container
az storage blob copy start-batch ...

# 6. Deploy new tenant Cosmos database
.\infrastructure\scripts\deploy-graph.ps1 `
    -ResourceGroup "rg-careercraft-prod" `
    -TenantId $existingTenant `
    -EnableMultiTenancy

# 7. Migrate graph data
.\infrastructure\scripts\populate-graph.ps1 `
    -ResourceGroup "rg-careercraft-prod" `
    -TenantId $existingTenant
```

## Monitoring & Analytics

### Per-Tenant Metrics

Track usage per tenant:

```powershell
# Search query volume by index (tenant)
az monitor metrics list `
    --resource {search-resource-id} `
    --metric "SearchQueriesPerSecond" `
    --dimension "IndexName"

# Storage usage by container (tenant)
az monitor metrics list `
    --resource {storage-resource-id} `
    --metric "BlobCapacity" `
    --dimension "BlobContainer"

# Cosmos DB RU consumption by database (tenant)
az monitor metrics list `
    --resource {cosmos-resource-id} `
    --metric "TotalRequestUnits" `
    --dimension "DatabaseName"
```

## Best Practices

1. **Tenant Naming**
   - Use lowercase, hyphen-separated tenant IDs: `acme-corp`, `globex-inc`
   - Keep IDs under 20 characters for Azure resource name limits
   - Avoid special characters except hyphens

2. **Resource Limits**
   - Azure Search Basic tier: Up to 15 indexes (15 tenants max)
   - Upgrade to Standard tier for 50+ indexes if needed
   - Monitor storage account limits (500 containers max)

3. **Cost Optimization**
   - Use Cosmos DB serverless for variable workloads
   - Implement data retention policies per tenant
   - Monitor and optimize search index sizes

4. **Backup & DR**
   - Implement tenant-specific backup policies
   - Test tenant restoration procedures
   - Document tenant data recovery SLAs

## Support

For questions or issues with multi-tenancy:

- Review docs/DEPLOYMENT-ORDER.md for deployment sequence
- Check docs/SECURITY-AUDIT.md for security best practices
- Refer to docs/STORAGE-ARCHITECTURE.md for data organization

## Future Enhancements

Planned improvements:

- [ ] Automated tenant provisioning API
- [ ] Tenant usage dashboard
- [ ] Per-tenant rate limiting
- [ ] Tenant data export tools
- [ ] Cross-tenant analytics (aggregated)
