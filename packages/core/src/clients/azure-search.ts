import { SearchClient, AzureKeyCredential } from '@azure/search-documents';

export function getSearchClient<T extends object = Record<string, unknown>>(
  indexName?: string,
): SearchClient<T> {
  const endpoint = process.env.AZURE_SEARCH_ENDPOINT;
  const apiKey = process.env.AZURE_SEARCH_API_KEY;
  const index = indexName ?? process.env.AZURE_SEARCH_INDEX_NAME;

  if (!endpoint || !apiKey || !index) {
    throw new Error(
      'AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_API_KEY, and AZURE_SEARCH_INDEX_NAME are required',
    );
  }

  return new SearchClient<T>(endpoint, index, new AzureKeyCredential(apiKey));
}
