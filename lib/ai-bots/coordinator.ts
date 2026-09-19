import { Pool } from "pg";
import { getDatabasePoolConfig } from "@/lib/db/client";

let coordinator: Pool | undefined;
/** A dedicated connection keeps waiting coordinators from starving the ordinary
 * roster pool. The shared domain services intentionally commit independently. */
export function getBotCoordinatorPool() {
  coordinator ??= new Pool({ ...getDatabasePoolConfig(), max: 1, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000 });
  return coordinator;
}
