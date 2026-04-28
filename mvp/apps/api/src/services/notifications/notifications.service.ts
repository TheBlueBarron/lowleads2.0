import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { ValidationError } from '../../lib/errors.js';
import type { UpdateNotificationPrefsBody } from './notifications.schema.js';

export interface NotificationServiceDeps {
  db: Pool;
  log: FastifyBaseLogger;
}

interface PrefsRow {
  user_id: string;
  email_new_lead: boolean;
  email_lead_resolved: boolean;
  email_low_escrow: boolean;
  low_escrow_threshold_cents: number;
  updated_at: Date;
}

export class NotificationService {
  constructor(private readonly deps: NotificationServiceDeps) {}

  async getPrefs(userId: string) {
    const result = await this.deps.db.query<PrefsRow>(
      `SELECT user_id, email_new_lead, email_lead_resolved, email_low_escrow,
              low_escrow_threshold_cents, updated_at
       FROM notification_preferences
       WHERE user_id = $1`,
      [userId],
    );

    if (result.rows.length > 0) return this.toResponse(result.rows[0]!);

    // Return defaults if no record exists yet
    return {
      userId,
      emailNewLead: true,
      emailLeadResolved: true,
      emailLowEscrow: true,
      lowEscrowThresholdCents: 5000,
      updatedAt: new Date().toISOString(),
    };
  }

  async updatePrefs(userId: string, body: UpdateNotificationPrefsBody) {
    const allUndefined =
      body.emailNewLead === undefined &&
      body.emailLeadResolved === undefined &&
      body.emailLowEscrow === undefined &&
      body.lowEscrowThresholdCents === undefined;
    if (allUndefined) throw new ValidationError('No fields to update');

    const result = await this.deps.db.query<PrefsRow>(
      `INSERT INTO notification_preferences
         (user_id, email_new_lead, email_lead_resolved, email_low_escrow, low_escrow_threshold_cents)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         email_new_lead             = COALESCE(EXCLUDED.email_new_lead, notification_preferences.email_new_lead),
         email_lead_resolved        = COALESCE(EXCLUDED.email_lead_resolved, notification_preferences.email_lead_resolved),
         email_low_escrow           = COALESCE(EXCLUDED.email_low_escrow, notification_preferences.email_low_escrow),
         low_escrow_threshold_cents = COALESCE(EXCLUDED.low_escrow_threshold_cents, notification_preferences.low_escrow_threshold_cents)
       RETURNING *`,
      [
        userId,
        body.emailNewLead ?? null,
        body.emailLeadResolved ?? null,
        body.emailLowEscrow ?? null,
        body.lowEscrowThresholdCents ?? null,
      ],
    );
    return this.toResponse(result.rows[0]!);
  }

  private toResponse(row: PrefsRow) {
    return {
      userId: row.user_id,
      emailNewLead: row.email_new_lead,
      emailLeadResolved: row.email_lead_resolved,
      emailLowEscrow: row.email_low_escrow,
      lowEscrowThresholdCents: row.low_escrow_threshold_cents,
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
