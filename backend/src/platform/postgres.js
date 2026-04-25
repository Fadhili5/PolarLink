import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

class MemoryAuditStore {
  constructor() {
    this.events = [];
  }

  async log(type, payload) {
    this.events.unshift({
      id: `${type}-${Date.now()}`,
      type,
      payload,
      loggedAt: new Date().toISOString(),
    });
    this.events = this.events.slice(0, 1000);
  }

  async list(limit = 100) {
    return this.events.slice(0, limit);
  }
}

class MemoryCargoLedgerStore {
  constructor() {
    this.ledger = new Map();
    this.state = new Map();
    this.evidence = new Map();
  }

  async ensureSchema() {
    return undefined;
  }

  async appendEvent(cargoId, event) {
    const items = this.ledger.get(cargoId) || [];
    this.ledger.set(cargoId, [event, ...items].slice(0, 5000));
  }

  async upsertState(cargoId, state) {
    this.state.set(cargoId, state);
  }

  async saveEvidence(cargoId, event) {
    const items = this.evidence.get(cargoId) || [];
    const evidence = {
      cargoId,
      eventId: event.id,
      videoClip: event.video_clip || null,
      photoEvidence: event.photo_evidence || null,
      sealId: event.seal_id || null,
      condition: event.condition || null,
      recordedAt: event.timestamp,
      location: event.location,
      action: event.action,
    };
    this.evidence.set(cargoId, [evidence, ...items].slice(0, 500));
  }

  async getHistory(cargoId, limit = 200) {
    return (this.ledger.get(cargoId) || []).slice(0, limit);
  }

  async getState(cargoId) {
    return this.state.get(cargoId) || null;
  }

  async listCargo(limit = 200) {
    return Array.from(this.state.values())
      .sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime())
      .slice(0, limit);
  }

  async getEvidence(cargoId, limit = 100) {
    return (this.evidence.get(cargoId) || []).slice(0, limit);
  }
}

class PostgresAuditStore {
  constructor(pool) {
    this.pool = pool;
  }

  async ensureSchema() {
    await this.pool.query(`
      create table if not exists audit_events (
        id text primary key,
        type text not null,
        payload jsonb not null,
        logged_at timestamptz not null default now()
      )
    `);
  }

  async log(type, payload) {
    await this.pool.query(
      "insert into audit_events (id, type, payload) values ($1, $2, $3)",
      [`${type}-${Date.now()}`, type, payload],
    );
  }

  async list(limit = 100) {
    const result = await this.pool.query(
      "select id, type, payload, logged_at from audit_events order by logged_at desc limit $1",
      [limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      payload: row.payload,
      loggedAt: row.logged_at,
    }));
  }
}

class PostgresCargoLedgerStore {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.options = options;
  }

  async ensureSchema() {
    await this.pool.query(`
      create table if not exists cargo_ledger_events (
        id text primary key,
        cargo_id text not null,
        flight text not null,
        action text not null,
        event_timestamp timestamptz not null,
        location text not null,
        payload jsonb not null,
        hash text not null,
        previous_hash text not null,
        created_at timestamptz not null default now()
      );
    `);
    await this.pool.query(`
      create index if not exists cargo_ledger_events_cargo_time_idx
      on cargo_ledger_events (cargo_id, event_timestamp desc);
    `);
    await this.pool.query(`
      create index if not exists cargo_ledger_events_time_brin_idx
      on cargo_ledger_events using brin (event_timestamp);
    `);
    await this.pool.query(`
      create index if not exists cargo_ledger_events_action_time_idx
      on cargo_ledger_events (action, event_timestamp desc);
    `);
    await this.pool.query(`
      create table if not exists cargo_custody_state (
        cargo_id text primary key,
        state jsonb not null,
        updated_at timestamptz not null default now()
      );
    `);
    await this.pool.query(`
      create table if not exists cargo_evidence (
        id text primary key,
        cargo_id text not null,
        event_id text not null,
        video_clip text,
        photo_evidence text,
        seal_id text,
        condition text,
        recorded_at timestamptz not null,
        location text not null,
        action text not null,
        metadata jsonb not null,
        created_at timestamptz not null default now()
      );
    `);
    await this.pool.query(`
      create index if not exists cargo_evidence_cargo_time_idx
      on cargo_evidence (cargo_id, recorded_at desc);
    `);
    await this.pool.query(`
      create index if not exists cargo_evidence_time_brin_idx
      on cargo_evidence using brin (recorded_at);
    `);

    await this.configureTimescale();
  }

  async appendEvent(cargoId, event) {
    await this.pool.query(
      `
        insert into cargo_ledger_events (
          id, cargo_id, flight, action, event_timestamp, location, payload, hash, previous_hash
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      `,
      [
        event.id,
        cargoId,
        event.flight,
        event.action,
        event.timestamp,
        event.location,
        event,
        event.hash,
        event.previous_hash,
      ],
    );
  }

  async upsertState(cargoId, state) {
    await this.pool.query(
      `
        insert into cargo_custody_state (cargo_id, state, updated_at)
        values ($1,$2, now())
        on conflict (cargo_id)
        do update set state = excluded.state, updated_at = now()
      `,
      [cargoId, state],
    );
  }

  async saveEvidence(cargoId, event) {
    if (!event.video_clip && !event.photo_evidence) {
      return;
    }
    await this.pool.query(
      `
        insert into cargo_evidence (
          id, cargo_id, event_id, video_clip, photo_evidence, seal_id, condition, recorded_at, location, action, metadata
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (id) do nothing
      `,
      [
        `${event.id}-evidence`,
        cargoId,
        event.id,
        event.video_clip || null,
        event.photo_evidence || null,
        event.seal_id || null,
        event.condition || null,
        event.timestamp,
        event.location,
        event.action,
        {
          team: event.team,
          handler: event.handler,
          risk: event.risk,
          visionFindings: event.visionFindings,
          verification: event.verification,
          replay: buildReplayMetadata(event),
        },
      ],
    );
  }

  async getHistory(cargoId, limit = 200) {
    const result = await this.pool.query(
      `
        select payload
        from cargo_ledger_events
        where cargo_id = $1
        order by event_timestamp desc
        limit $2
      `,
      [cargoId, limit],
    );
    return result.rows.map((row) => row.payload);
  }

  async getState(cargoId) {
    const result = await this.pool.query(
      `select state from cargo_custody_state where cargo_id = $1`,
      [cargoId],
    );
    return result.rows[0]?.state || null;
  }

  async listCargo(limit = 200) {
    const result = await this.pool.query(
      `
        select state
        from cargo_custody_state
        order by updated_at desc
        limit $1
      `,
      [limit],
    );
    return result.rows.map((row) => row.state);
  }

  async getEvidence(cargoId, limit = 100) {
    const result = await this.pool.query(
      `
        select event_id, video_clip, photo_evidence, seal_id, condition, recorded_at, location, action, metadata
        from cargo_evidence
        where cargo_id = $1
        order by recorded_at desc
        limit $2
      `,
      [cargoId, limit],
    );
    return result.rows.map((row) => ({
      cargoId,
      eventId: row.event_id,
      videoClip: row.video_clip,
      photoEvidence: row.photo_evidence,
      sealId: row.seal_id,
      condition: row.condition,
      recordedAt: row.recorded_at,
      location: row.location,
      action: row.action,
      metadata: row.metadata,
    }));
  }

  async configureTimescale() {
    try {
      await this.pool.query(`create extension if not exists timescaledb`);
      await this.pool.query(`
        select create_hypertable(
          'cargo_ledger_events',
          by_range('event_timestamp'),
          if_not_exists => true,
          migrate_data => true
        )
      `);
      await this.pool.query(`
        select create_hypertable(
          'cargo_evidence',
          by_range('recorded_at'),
          if_not_exists => true,
          migrate_data => true
        )
      `);
      await this.pool.query(`
        alter table cargo_ledger_events
        set (
          timescaledb.compress,
          timescaledb.compress_segmentby = 'cargo_id,action',
          timescaledb.compress_orderby = 'event_timestamp desc'
        )
      `);
      await this.pool.query(`
        alter table cargo_evidence
        set (
          timescaledb.compress,
          timescaledb.compress_segmentby = 'cargo_id,action',
          timescaledb.compress_orderby = 'recorded_at desc'
        )
      `);
      await this.pool.query(`
        select add_compression_policy(
          'cargo_ledger_events',
          compress_after => interval '${this.options.compressionAfterDays || 14} days',
          if_not_exists => true
        )
      `);
      await this.pool.query(`
        select add_compression_policy(
          'cargo_evidence',
          compress_after => interval '${this.options.compressionAfterDays || 14} days',
          if_not_exists => true
        )
      `);
      await this.pool.query(`
        select add_retention_policy(
          'cargo_ledger_events',
          drop_after => interval '${this.options.ledgerRetentionDays || 180} days',
          if_not_exists => true
        )
      `);
      await this.pool.query(`
        select add_retention_policy(
          'cargo_evidence',
          drop_after => interval '${this.options.ledgerRetentionDays || 180} days',
          if_not_exists => true
        )
      `);
    } catch (error) {
      logger.warn(
        { error: error.message },
        "TimescaleDB extension unavailable, cargo ledger will run on standard PostgreSQL tables",
      );
    }
  }
}

export async function createAuditStore(connectionString, disabled = false) {
  if (disabled || !connectionString) {
    logger.warn("PostgreSQL audit store disabled, using in-memory audit log");
    return new MemoryAuditStore();
  }

  try {
    const pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 5000,
    });
    const store = new PostgresAuditStore(pool);
    await store.ensureSchema();
    return store;
  } catch (error) {
    logger.warn({ error: error.message }, "PostgreSQL unavailable, using in-memory audit log");
    return new MemoryAuditStore();
  }
}

export async function createCargoLedgerStore(connectionString, disabled = false, options = {}) {
  if (disabled || !connectionString) {
    logger.warn("PostgreSQL cargo ledger disabled, using in-memory cargo ledger");
    return new MemoryCargoLedgerStore();
  }

  try {
    const pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 1500,
      idleTimeoutMillis: 5000,
    });
    const store = new PostgresCargoLedgerStore(pool, options);
    await store.ensureSchema();
    return store;
  } catch (error) {
    logger.warn({ error: error.message }, "PostgreSQL unavailable, using in-memory cargo ledger");
    return new MemoryCargoLedgerStore();
  }
}

function buildReplayMetadata(event) {
  const findings = event.visionFindings || {};
  const anomalies = [];
  if (findings.brokenSeal) anomalies.push({ atSecond: 18, label: "Broken seal detected", severity: "HIGH" });
  if (findings.unauthorizedAccess) anomalies.push({ atSecond: 24, label: "Unauthorized access", severity: "CRITICAL" });
  if (findings.cargoSwapped) anomalies.push({ atSecond: 36, label: "Possible cargo swap", severity: "CRITICAL" });
  if (findings.leftUnattended) anomalies.push({ atSecond: 42, label: "Cargo left unattended", severity: "HIGH" });
  if (findings.packageDamage) anomalies.push({ atSecond: 58, label: "Damage signature", severity: "HIGH" });
  if (findings.heatSignatureAnomaly) anomalies.push({ atSecond: 63, label: "Heat anomaly", severity: "MEDIUM" });
  if (anomalies.length === 0) {
    anomalies.push({ atSecond: 30, label: "Custody checkpoint", severity: "LOW" });
  }

  return {
    durationSeconds: 90,
    anomalies,
    keyframes: [0, 15, 30, 45, 60, 75].map((atSecond, index) => ({
      index,
      atSecond,
      caption: anomalies.find((item) => Math.abs(item.atSecond - atSecond) <= 6)?.label || `${event.action} frame ${index + 1}`,
    })),
  };
}
