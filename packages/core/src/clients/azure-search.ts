import { SearchClient, SearchIndexClient, AzureKeyCredential } from '@azure/search-documents';

function getSearchCredentials(): { endpoint: string; credential: AzureKeyCredential } {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  if (!endpoint || !apiKey) {
    throw new Error('AZURE_SEARCH_ENDPOINT and AZURE_SEARCH_API_KEY are required');
  }
  return { endpoint, credential: new AzureKeyCredential(apiKey) };
}

export function getSearchClient<T extends object = Record<string, unknown>>(
  indexName?: string,
): SearchClient<T> {
  const index = indexName ?? process.env.AZURE_SEARCH_INDEX_NAME;
  if (!index) {
    throw new Error('An index name (or AZURE_SEARCH_INDEX_NAME) is required');
  }
  const { endpoint, credential } = getSearchCredentials();
  return new SearchClient<T>(endpoint, index, credential);
}

/** Admin client for index lifecycle (create/update/delete indexes). */
export function getSearchIndexClient(): SearchIndexClient {
  const { endpoint, credential } = getSearchCredentials();
  return new SearchIndexClient(endpoint, credential);
}
