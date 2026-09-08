import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { TERMINAL_SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order.state-machine';
import type {
  BillingDocumentAlertCandidate,
  BillingRecordAlertCandidate,
  MeasurementAlertCandidate,
  ServiceOrderAlertCandidate,
} from '../domain/alert-evaluation.engine';

const TERMINAL_SERVICE_ORDER_SQL = Array.from(TERMINAL_SERVICE_ORDER_STATUSES)
  .map((status) => `'${status}'`)
  .join(', ');

@Injectable()
export class AlertCandidateRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_NOT_CONFIGURED');
    }
    return connection.pool;
  }

  async loadServiceOrderCandidates(): Promise<ServiceOrderAlertCandidate[]> {
    const result = await this.pool().query<{
      id: string;
      unit_id: string;
      client_id: string | null;
      status: ServiceOrderAlertCandidate['status'];
      created_at: Date;
      prepared_at: Date | null;
      released_at: Date | null;
      started_at: Date | null;
      paused_at: Date | null;
      updated_at: Date;
      deadline: Date | null;
    }>(
      `SELECT
         so.id,
         so.unit_id,
         so.client_id,
         so.status,
         so.created_at,
         so.prepared_at,
         so.released_at,
         so.started_at,
         so.paused_at,
         so.updated_at,
         deadlines.deadline
       FROM rpt.read_service_orders so LEFT JOIN LATERAL (SELECT so.deadline_for(so.id) AS deadline) deadlines ON TRUE
       WHERE so.status NOT IN (${TERMINAL_SERVICE_ORDER_SQL})`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      unitId: row.unit_id,
      clientId: row.client_id,
      status: row.status,
      deadline: row.deadline,
      createdAt: row.created_at,
      preparedAt: row.prepared_at,
      releasedAt: row.released_at,
      startedAt: row.started_at,
      pausedAt: row.paused_at,
      updatedAt: row.updated_at,
    }));
  }

  async loadMeasurementCandidates(): Promise<MeasurementAlertCandidate[]> {
    const result = await this.pool().query<{
      id: string;
      service_order_id: string;
      unit_id: string;
      client_id: string | null;
      status: MeasurementAlertCandidate['status'];
      submitted_at: Date | null;
      review_started_at: Date | null;
      created_at: Date;
    }>(
      `SELECT
         m.id,
         m.service_order_id,
         so.unit_id,
         so.client_id,
         m.status,
         m.submitted_at,
         m.review_started_at,
         m.created_at
       FROM rpt.read_measurements m
       INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id
       WHERE m.status IN ('SUBMITTED', 'UNDER_REVIEW')`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      serviceOrderId: row.service_order_id,
      unitId: row.unit_id,
      clientId: row.client_id,
      status: row.status,
      submittedAt: row.submitted_at,
      reviewStartedAt: row.review_started_at,
      createdAt: row.created_at,
    }));
  }

  async loadBillingRecordCandidates(): Promise<BillingRecordAlertCandidate[]> {
    const result = await this.pool().query<{
      id: string;
      service_order_id: string;
      unit_id: string;
      client_id: string | null;
      status: string;
      prepared_at: Date | null;
    }>(
      `SELECT
         br.id,
         br.service_order_id,
         so.unit_id,
         so.client_id,
         br.status,
         br.prepared_at
       FROM rpt.read_billing_records br
       INNER JOIN rpt.read_service_orders so ON so.id = br.service_order_id
       WHERE br.status = 'PREPARED'
         AND NOT EXISTS (
           SELECT 1
           FROM rpt.read_billing_documents bd
           WHERE bd.billing_record_id = br.id
             AND bd.status = 'FINALIZED'
         )`,
    );
    return result.rows.map((row) => ({
      id: row.id,
      serviceOrderId: row.service_order_id,
      unitId: row.unit_id,
      clientId: row.client_id,
      status: row.status,
      preparedAt: row.prepared_at,
    }));
  }

  async loadBillingDocumentCandidates(businessTimezone: string): Promise<BillingDocumentAlertCandidate[]> {
    const result = await this.pool().query<{
      id: string;
      billing_record_id: string;
      service_order_id: string;
      unit_id: string;
      client_id: string | null;
      status: string;
      due_date: string | null;
      issued_at: Date | null;
      service_order_status: string;
      billing_record_status: string | null;
      completed_at: Date | null;
      prepared_at: Date | null;
    }>(
      `SELECT
         bd.id,
         bd.billing_record_id,
         br.service_order_id,
         so.unit_id,
         so.client_id,
         bd.status,
         bd.due_date::text AS due_date,
         bd.issued_at,
         so.status AS service_order_status,
         br.status AS billing_record_status,
         so.completed_at,
         br.prepared_at
       FROM rpt.read_billing_documents bd
       INNER JOIN rpt.read_billing_records br ON br.id = bd.billing_record_id
       INNER JOIN rpt.read_service_orders so ON so.id = br.service_order_id
       WHERE bd.status = 'FINALIZED'
         AND bd.due_date IS NOT NULL
         AND bd.due_date::date < (NOW() AT TIME ZONE $1)::date`,
      [businessTimezone],
    );
    return result.rows.map((row) => ({
      id: row.id,
      billingRecordId: row.billing_record_id,
      serviceOrderId: row.service_order_id,
      unitId: row.unit_id,
      clientId: row.client_id,
      status: row.status,
      dueDate: row.due_date,
      issuedAt: row.issued_at,
      serviceOrderStatus: row.service_order_status,
      billingRecordStatus: row.billing_record_status,
      completedAt: row.completed_at,
      preparedAt: row.prepared_at,
    }));
  }
}
