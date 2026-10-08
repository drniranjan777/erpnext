import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { AuthContext } from '../../common/auth-context';
import { DatabaseService } from '../../database/database.service';
import { many } from '../../common/sql';

/**
 * What the quality and HSE side needs attention on, in one call: calibrations due, licences to
 * renew, overdue CAPA actions, SOP reviews and the user's unread SOPs, expired planned
 * deviations, retain samples to dispose of, supplier audits overdue.
 */
@Injectable()
export class AlertsService {
  constructor(private readonly database: DatabaseService) {}

  alerts(auth: AuthContext) {
    return this.database.run(auth, async (tx) => {
      const today = sql`(now() at time zone 'Asia/Kolkata')::date`;
      const [r] = await many<Record<string, number>>(
        tx,
        sql`select
              (select count(*)::int from gauges where status = 'in_use' and (next_due is null or next_due <= ${today} + 15)) as "calibrationDue",
              (select count(*)::int from gauges where status = 'in_use' and next_due < ${today}) as "calibrationOverdue",
              (select count(*)::int from licences where valid_until is not null and valid_until - renewal_lead_days <= ${today}) as "licencesToRenew",
              (select count(*)::int from licences where valid_until < ${today}) as "licencesExpired",
              (select count(*)::int from capa_actions a join capas c on c.id = a.capa_id join documents d on d.id = c.id where a.done_on is null and a.due_date < ${today} and d.status = 'approved' and c.stage <> 'closed') as "capaActionsOverdue",
              (select count(*)::int from sops s join documents d on d.id = s.id where d.status = 'approved' and s.superseded_at is null and s.review_due <= ${today} + 30) as "sopReviewsDue",
              (select count(*)::int from sop_trainees t join sops s on s.id = t.sop_id join documents d on d.id = s.id where t.user_id = ${auth.userId} and t.acknowledged_at is null and d.status = 'approved' and s.superseded_at is null) as "mySopsToRead",
              (select count(*)::int from deviations v join documents d on d.id = v.id where v.kind = 'planned' and v.closed_at is null and d.status = 'approved' and v.valid_until < ${today}) as "deviationsExpired",
              (select count(*)::int from retain_samples where disposed_on is null and retain_until <= ${today}) as "retainsDue",
              (select count(*)::int from hse_incidents where status = 'open') as "incidentsOpen",
              (select count(*)::int from hazardous_waste where disposed_on is null and generated_on < ${today} - 90) as "wasteStoredTooLong"`,
      );
      return r;
    });
  }
}
