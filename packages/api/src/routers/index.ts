import { router } from '../trpc.js';
import { healthRouter } from './health.js';
import { ragRouter } from './rag.js';
import { agenticRouter } from './agentic.js';
import { graphRouter } from './graph.js';
import { documentsRouter } from './documents.js';
import { entitiesRouter } from './entities.js';
import { intelligenceRouter } from './intelligence.js';
import { alertsRouter } from './alerts.js';
import { adminRouter } from './admin.js';
import { billingRouter } from './billing.js';
import { tenantRouter } from './tenant.js';
import { connectionsRouter } from './connections.js';

export const appRouter = router({
  health: healthRouter,
  tenant: tenantRouter,
  rag: ragRouter,
  agentic: agenticRouter,
  graph: graphRouter,
  documents: documentsRouter,
  entities: entitiesRouter,
  intelligence: intelligenceRouter,
  alerts: alertsRouter,
  admin: adminRouter,
  billing: billingRouter,
  connections: connectionsRouter,
});

export type AppRouter = typeof appRouter;
