import { AgentsClient } from '@azure/ai-agents';
import { DefaultAzureCredential } from '@azure/identity';

let cached: AgentsClient | null = null;

/**
 * Foundry Agent Service client. Entra-only data plane: locally this rides the
 * `az login` session via DefaultAzureCredential; deployed it picks up
 * AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET.
 */
export function getAgentsClient(): AgentsClient {
  if (cached) return cached;

  const endpoint = process.env.AZURE_AI_PROJECT_ENDPOINT;
  if (!endpoint) {
    throw new Error('AZURE_AI_PROJECT_ENDPOINT is required (Foundry project endpoint)');
  }

  cached = new AgentsClient(endpoint, new DefaultAzureCredential());
  return cached;
}
