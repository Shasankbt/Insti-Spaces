import { Request, Response } from 'express';
import { PoolClient } from 'pg';
import type { Role } from '../types';

// Re-export so all route files continue to import from this single module.
export { withTransaction } from '../db/pool';

export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, errorOrMessage: string | Record<string, unknown>) {
    const body =
      typeof errorOrMessage === 'string' ? { error: errorOrMessage } : errorOrMessage;
    super((body.error as string) || (body.message as string) || 'Error');
    this.status = status;
    this.body = body;
  }
}

export function parseSpaceId(req: Request): number | null {
  const id = Number(req.params.spaceId);
  return Number.isFinite(id) ? id : null;
}

// Throws HttpError if caller does not have one of the allowedRoles in the space.
// Returns the caller's role. Must be called inside a transaction.
export async function requireSpaceRole(
  client: PoolClient,
  spaceId: number,
  userId: number,
  allowedRoles: Role[],
): Promise<Role> {
  const { rows } = await client.query<{ role: Role }>(
    `SELECT role FROM following WHERE spaceid = $1 AND userid = $2 AND deleted = false`,
    [spaceId, userId],
  );
  if (!rows.length) throw new HttpError(403, 'Not a member of this space');
  if (!allowedRoles.includes(rows[0].role)) {
    throw new HttpError(403, 'Insufficient permissions');
  }
  return rows[0].role;
}

export function handleError(res: Response, err: unknown): void {
  if (err instanceof HttpError) {
    res.status(err.status).json(err.body);
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  res.status(500).json({ error: message });
}
