export class CargoRepository {
  constructor(redis, ledgerStore, retentionLimit = 5000) {
    this.redis = redis;
    this.ledgerStore = ledgerStore;
    this.retentionLimit = retentionLimit;
  }

  ledgerKey(cargoId) {
    return `cargo:${cargoId}:ledger`;
  }

  stateKey(cargoId) {
    return `cargo:${cargoId}:state`;
  }

  async appendEvent(cargoId, event) {
    await this.redis.lPush(this.ledgerKey(cargoId), JSON.stringify(event));
    await this.redis.lTrim(this.ledgerKey(cargoId), 0, this.retentionLimit - 1);
    if (this.ledgerStore) {
      await this.ledgerStore.appendEvent(cargoId, event);
      await this.ledgerStore.saveEvidence(cargoId, event);
    }
  }

  async getHistory(cargoId, limit = 200) {
    const items = await this.redis.lRange(this.ledgerKey(cargoId), 0, limit - 1);
    if (items.length > 0) {
      return items.map((item) => JSON.parse(item));
    }
    return this.ledgerStore ? this.ledgerStore.getHistory(cargoId, limit) : [];
  }

  async getLatestEvent(cargoId) {
    const [item] = await this.redis.lRange(this.ledgerKey(cargoId), 0, 0);
    return item ? JSON.parse(item) : null;
  }

  async saveState(cargoId, state) {
    await this.redis.set(this.stateKey(cargoId), JSON.stringify(state));
    await this.redis.hSet("cargo:index", cargoId, JSON.stringify(state));
    if (this.ledgerStore) {
      await this.ledgerStore.upsertState(cargoId, state);
    }
  }

  async getState(cargoId) {
    const raw = await this.redis.get(this.stateKey(cargoId));
    if (raw) {
      return JSON.parse(raw);
    }
    const state = this.ledgerStore ? await this.ledgerStore.getState(cargoId) : null;
    if (state) {
      await this.redis.set(this.stateKey(cargoId), JSON.stringify(state));
      await this.redis.hSet("cargo:index", cargoId, JSON.stringify(state));
    }
    return state;
  }

  async listCargo(limit = 200) {
    const rows = await this.redis.hGetAll("cargo:index");
    const cargo = Object.values(rows)
      .map((row) => JSON.parse(row))
      .sort((a, b) => new Date(b.lastUpdatedAt).getTime() - new Date(a.lastUpdatedAt).getTime())
      .slice(0, limit);
    if (cargo.length > 0) {
      return cargo;
    }
    return this.ledgerStore ? this.ledgerStore.listCargo(limit) : [];
  }

  async getEvidence(cargoId, limit = 100) {
    return this.ledgerStore ? this.ledgerStore.getEvidence(cargoId, limit) : [];
  }

  async getEvidenceEvent(cargoId, eventId) {
    const evidence = await this.getEvidence(cargoId, 250);
    return evidence.find((item) => item.eventId === eventId) || null;
  }
}
