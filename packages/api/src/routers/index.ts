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
import { incidentsRouter } from './incidents.js';
import { careersRouter } from './careers.js';
import { budgetRouter } from './budget.js';
import { knowledgeRouter } from './knowledge.js';
import { agentsRouter } from './agents.js';
import { automationsRouter } from './automations.js';
import { usageRouter } from './usage.js';

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
  incidents: incidentsRouter,
  // Vertical module — careers-shaped reads over the shared graph.
  careers: careersRouter,
  // Budget-shaped reads over the same graph: extracted figures, never summed.
  budget: budgetRouter,
  // Customer portal — knowledge, agents, automations, usage.
  knowledge: knowledgeRouter,
  agents: agentsRouter,
  automations: automationsRouter,
  usage: usageRouter,
});

export type AppRouter = typeof appRouter;
