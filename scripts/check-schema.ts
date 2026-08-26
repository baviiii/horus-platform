import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  const tables = await p.$queryRawUnsafe<Array<{ table_name: string }>>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
  );
  console.log('Tables:', tables.map((t) => t.table_name).join(', '));
  await p.$disconnect();
}

main().catch(console.error);
