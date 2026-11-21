import test from 'node:test';
import assert from 'node:assert/strict';
import { SCOPES, hasAllScopes, hasScope } from '../dist/scopes.js';

test('MCP and Marketplace scopes support exact and wildcard grants', () => {
  assert.equal(SCOPES.MCP_CALL, 'mcp:call');
  assert.equal(SCOPES.MARKETPLACE_READ, 'marketplace:read');
  assert.equal(SCOPES.MARKETPLACE_WRITE, 'marketplace:write');

  assert.equal(hasScope(['mcp:call'], 'mcp:call'), true);
  assert.equal(hasScope(['mcp:*'], 'mcp:call'), true);
  assert.equal(hasScope(['marketplace:*'], 'marketplace:read'), true);
  assert.equal(hasScope(['marketplace:*'], 'marketplace:write'), true);
  assert.equal(hasScope(['marketplace:read'], 'marketplace:write'), false);
  assert.equal(
    hasAllScopes(['marketplace:read', 'mcp:call'], ['marketplace:read', 'mcp:call']),
    true,
  );
  assert.equal(hasAllScopes(['rag:read'], ['mcp:call']), false);
});
