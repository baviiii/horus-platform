import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INDEX_MCP_TOOLS,
  isAllowedTenantSecretRef,
  isMissingMarketplaceTable,
  meetsPlan,
} from '../src/marketplace/index.ts';
import { handleMarketplaceMcpRequest } from '../src/mcp/index.ts';

test('meetsPlan enforces monotonic plan hierarchy', () => {
  assert.equal(meetsPlan('FREE', 'FREE'), true);
  assert.equal(meetsPlan('FREE', 'STARTER'), false);
  assert.equal(meetsPlan('PRO', 'STARTER'), true);
  assert.equal(meetsPlan('ENTERPRISE', 'SCALE'), true);
});

test('isAllowedTenantSecretRef rejects platform secrets and allows MCP_SECRET_*', () => {
  assert.equal(isAllowedTenantSecretRef('DATABASE_URL'), false);
  assert.equal(isAllowedTenantSecretRef('HORUS_AWS_SECRET_ACCESS_KEY'), false);
  assert.equal(isAllowedTenantSecretRef('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(isAllowedTenantSecretRef(null), false);
  assert.equal(isAllowedTenantSecretRef('MCP_SECRET_PARTNER_SERVER'), true);
});

test('isMissingMarketplaceTable detects Prisma P2021 and P2022 only', () => {
  assert.equal(isMissingMarketplaceTable({ code: 'P2021' }), true);
  assert.equal(isMissingMarketplaceTable({ code: 'P2022' }), true);
  assert.equal(isMissingMarketplaceTable({ code: 'P2002' }), false);
  assert.equal(isMissingMarketplaceTable(new Error('boom')), false);
});

const mockIndexTarget = {
  kind: 'INDEX',
  targetTenantId: '',
  collectionId: null,
  listing: {
    id: 'test-listing',
    slug: 'test-index',
    name: 'Test Policy Index',
    tagline: 'Unit test index target',
    description: 'Description',
    kind: 'INDEX',
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    category: 'policy',
    tags: ['test'],
    samplePrompts: [],
    minPlan: 'FREE',
    verified: true,
    featured: false,
    firstParty: true,
    publisherName: 'Horus',
    publisherTenantId: null,
    collectionId: null,
    connectionId: null,
    live: true,
    tools: INDEX_MCP_TOOLS,
    stats: {
      documents: 2,
      chunks: 20,
      entities: 5,
      relationships: 4,
      categories: ['budget', 'skills'],
    },
    installCount: 0,
    mcpPath: '/api/mcp/test-index',
    restPath: '/api/v1/marketplace/test-index/query',
  },
};

const mockCaller = {
  tenantId: '00000000-0000-0000-0000-000000000099',
  tenantSlug: 'acme',
  apiKeyId: null,
  surface: 'mcp',
};

test('handleMarketplaceMcpRequest serves JSON-RPC initialize & tools/list for lightweight HTTP clients', async () => {
  const initReq = new Request('https://horus.local/api/mcp/test-index', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'unit-test', version: '1.0.0' },
      },
    }),
  });

  const initRes = await handleMarketplaceMcpRequest(initReq, mockIndexTarget, mockCaller);
  assert.equal(initRes.status, 200);
  assert.match(initRes.headers.get('content-type') ?? '', /application\/json/);
  const initBody = await initRes.json();
  assert.equal(initBody.result.serverInfo.name, 'horus-test-index');

  const listReq = new Request('https://horus.local/api/mcp/test-index', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }),
  });

  const listRes = await handleMarketplaceMcpRequest(listReq, mockIndexTarget, mockCaller);
  assert.equal(listRes.status, 200);
  const listBody = await listRes.json();
  const toolNames = listBody.result.tools.map((t) => t.name);
  assert.deepEqual(toolNames, ['search_index', 'ask_index', 'graph_lookup', 'list_categories']);
});

test('handleMarketplaceMcpRequest streams SSE for standard MCP Streamable-HTTP clients and runs list_categories', async () => {
  const callReq = new Request('https://horus.local/api/mcp/test-index', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'list_categories',
        arguments: {},
      },
    }),
  });

  const res = await handleMarketplaceMcpRequest(callReq, mockIndexTarget, mockCaller);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const sseText = await res.text();
  assert.match(sseText, /budget/);
  assert.match(sseText, /skills/);
});
