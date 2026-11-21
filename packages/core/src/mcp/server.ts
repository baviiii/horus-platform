/**
 * Horus as a stateless Streamable-HTTP MCP Server & Gateway.
 *
 * Uses the official `@modelcontextprotocol/sdk` Web Standards transport so it
 * runs natively inside Next.js App Router (`Request` -> `Response`) with zero
 * Express adapter overhead and works across Cursor, Claude Desktop, Windsurf,
 * MCP Inspector, and `@modelcontextprotocol/sdk` clients.
 *
 * Also normalizes `Accept` headers for lightweight JSON-RPC HTTP callers (e.g.
 * `curl` sending `Accept: application/json` without `text/event-stream`), returning JSON directly
 * while streaming standard SSE (`text/event-stream`) to full MCP clients.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { INDEX_MCP_TOOLS, type ResolvedMarketplaceTarget } from '../marketplace/catalog.js';
import {
  executeIndexAsk,
  executeIndexCategories,
  executeIndexGraphLookup,
  executeIndexSearch,
  executeMcpGatewayCall,
  type MarketplaceCaller,
} from '../marketplace/execute.js';
import { listMcpTools } from './client.js';

function normalizeMcpRequest(req: Request): { request: Request; enableJsonResponse: boolean } {
  const accept = req.headers.get('accept') ?? '';
  const wantsSse = accept.includes('text/event-stream');
  const wantsJson = accept.includes('application/json');

  if (wantsSse && wantsJson) {
    return { request: req, enableJsonResponse: false };
  }

  const headers = new Headers(req.headers);
  headers.set('accept', 'application/json, text/event-stream');
  return {
    request: new Request(req.url, {
      method: req.method,
      headers,
      body: req.body,
      signal: req.signal,
      ...({ duplex: 'half' } as Record<string, unknown>),
    }),
    enableJsonResponse: !wantsSse,
  };
}

function createMarketplaceMcpServer(
  target: ResolvedMarketplaceTarget,
  caller: MarketplaceCaller,
): Server {
  const server = new Server(
    {
      name: `horus-${target.listing.slug}`,
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: `${target.listing.name} — ${target.listing.tagline}`,
    },
  );

  if (target.kind === 'INDEX') {
    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: INDEX_MCP_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as { type: 'object'; properties?: Record<string, object> },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      const args = (request.params.arguments ?? {}) as Record<string, unknown>;

      try {
        if (toolName === 'search_index') {
          const query = typeof args.query === 'string' ? args.query : '';
          const topK = typeof args.topK === 'number' ? args.topK : undefined;
          const category = typeof args.category === 'string' ? args.category : undefined;
          const year = typeof args.year === 'number' ? args.year : undefined;
          const tags = Array.isArray(args.tags)
            ? args.tags.filter((t): t is string => typeof t === 'string')
            : undefined;

          const { hits } = await executeIndexSearch(
            target,
            { query, topK, category, year, tags },
            caller,
          );

          if (hits.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No matching passages found in this Horus knowledge index.',
                },
              ],
            };
          }

          const formatted = hits
            .map((h) => {
              const loc = [
                h.pageNumber !== undefined ? `p. ${h.pageNumber}` : null,
                h.sourceUrl ?? null,
              ]
                .filter(Boolean)
                .join(' · ');
              return `[${h.rank}] ${h.title}${loc ? ` (${loc})` : ''}\n${h.excerpt}`;
            })
            .join('\n\n---\n\n');

          return {
            content: [{ type: 'text', text: formatted }],
          };
        }

        if (toolName === 'ask_index') {
          const query = typeof args.query === 'string' ? args.query : '';
          const maxSources = typeof args.maxSources === 'number' ? args.maxSources : undefined;
          const category = typeof args.category === 'string' ? args.category : undefined;

          const res = await executeIndexAsk(target, { query, maxSources, category }, caller);
          const citationsBlock =
            res.sources.length > 0
              ? '\n\nSources:\n' +
                res.sources
                  .map(
                    (s) =>
                      `[${s.n}] ${s.title}${s.pageNumber !== undefined ? `, p. ${s.pageNumber}` : ''}${s.sourceUrl ? ` — ${s.sourceUrl}` : ''}`,
                  )
                  .join('\n')
              : '';

          return {
            content: [
              {
                type: 'text',
                text: `${res.answer}${citationsBlock}\n\n(confidence: ${res.confidence.toFixed(2)})`,
              },
            ],
          };
        }

        if (toolName === 'graph_lookup') {
          const entity = typeof args.entity === 'string' ? args.entity : '';
          const graph = await executeIndexGraphLookup(target, { entity }, caller);
          return {
            content: [{ type: 'text', text: graph.summaryText }],
          };
        }

        if (toolName === 'list_categories') {
          const categories = await executeIndexCategories(target);
          const text =
            categories.length === 0
              ? 'No categorized documents indexed yet.'
              : categories
                  .map((c) => `- ${c.category}: ${c.documents} documents (${c.chunks} chunks)`)
                  .join('\n');
          return {
            content: [{ type: 'text', text }],
          };
        }

        return {
          isError: true,
          content: [{ type: 'text', text: `Unknown index tool "${toolName}".` }],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: err instanceof Error ? err.message : 'Index tool execution failed.',
            },
          ],
        };
      }
    });

    return server;
  }

  // target.kind === 'MCP' — authenticated Horus MCP gateway
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    if (!target.serverRef) {
      return {
        tools: target.listing.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as { type: 'object'; properties?: Record<string, object> },
        })),
      };
    }
    const discovered = await listMcpTools(target.serverRef);
    return {
      tools: discovered.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as { type: 'object'; properties?: Record<string, object> },
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const res = await executeMcpGatewayCall(
        target,
        {
          tool: request.params.name,
          arguments: (request.params.arguments ?? {}) as Record<string, unknown>,
        },
        caller,
      );
      return {
        isError: !res.ok,
        content: [{ type: 'text', text: res.output }],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: err instanceof Error ? err.message : 'Upstream MCP tool call failed.',
          },
        ],
      };
    }
  });

  return server;
}

/**
 * Handle a Web Standard HTTP request (POST/GET/DELETE) as a stateless MCP server.
 */
export async function handleMarketplaceMcpRequest(
  req: Request,
  target: ResolvedMarketplaceTarget,
  caller: MarketplaceCaller,
): Promise<Response> {
  const { request, enableJsonResponse } = normalizeMcpRequest(req);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse,
  });
  const server = createMarketplaceMcpServer(target, caller);
  await server.connect(transport);
  return transport.handleRequest(request);
}
