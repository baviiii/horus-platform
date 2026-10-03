export { appRouter, type AppRouter } from './routers/index.js';
export { createTRPCContext } from './context.js';
export type { Context } from './context.js';
export { createCaller } from './trpc.js';

// The budget procedures annotate their results with named interfaces, so those
// names have to be reachable from the package root — otherwise a consumer
// inferring the router type (apps/web's `getServerCaller`) hits TS2742,
// "cannot be named without a reference to …/routers/budget". They are part of
// the API contract regardless: CareerCraft mirrors these shapes by hand.
export type { BudgetAllocation, BudgetDocumentRef, BudgetSource } from './routers/budget.js';
