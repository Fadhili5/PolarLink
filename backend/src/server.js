import http from "http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { logger } from "./platform/logger.js";
import { createRedisClient } from "./platform/redis.js";
import { createAuditStore, createCargoLedgerStore } from "./platform/postgres.js";
import { ExposureRepository } from "./repositories/exposureRepository.js";
import { OperationsRepository } from "./repositories/operationsRepository.js";
import { CargoRepository } from "./repositories/cargoRepository.js";
import { SubscriptionRepository } from "./repositories/subscriptionRepository.js";
import { DlqRepository } from "./repositories/dlqRepository.js";
import { VerificationQueueRepository } from "./repositories/verificationQueueRepository.js";
import { WeatherService } from "./services/weatherService.js";
import { AlertService } from "./services/alertService.js";
import { OneRecordAuthService } from "./services/oneRecordAuthService.js";
import { OneRecordService } from "./services/oneRecordService.js";
import { RiskService } from "./services/riskService.js";
import { AnalyticsService } from "./services/analyticsService.js";
import { ActionOrchestrator } from "./services/actionOrchestrator.js";
import { NotificationRouter } from "./services/notificationRouter.js";
import { ReconciliationService } from "./services/reconciliationService.js";
import { TelemetryPipeline } from "./services/telemetryPipeline.js";
import { CargoService } from "./services/cargoService.js";
import { MqttConsumer } from "./services/mqttConsumer.js";
import { RequestIntegrityService } from "./services/requestIntegrityService.js";
import { FlightDataService } from "./services/flightDataService.js";
import { TwilioService } from "./services/twilioService.js";
import { buildApp } from "./app.js";

const redis = await createRedisClient(config.redis.url, {
  disabled: config.redis.disabled,
});
const auditStore = await createAuditStore(
  config.postgres.url,
  config.postgres.disabled,
);
const cargoLedgerStore = await createCargoLedgerStore(
  config.postgres.url,
  config.postgres.disabled,
  {
    ledgerRetentionDays: config.cargo.ledgerRetentionDays,
    compressionAfterDays: config.cargo.compressionAfterDays,
  },
);
const exposureRepository = new ExposureRepository(redis, config.retention.eventListLimit);
const operationsRepository = new OperationsRepository(redis, config.retention.eventListLimit);
const cargoRepository = new CargoRepository(
  redis,
  cargoLedgerStore,
  config.retention.eventListLimit * 10,
);
const subscriptionRepository = new SubscriptionRepository(redis);
const dlqRepository = new DlqRepository(redis);
const verificationQueueRepository = new VerificationQueueRepository({
  redis,
  config,
  logger,
});
const analyticsService = new AnalyticsService({
  exposureRepository,
  operationsRepository,
});
const requestIntegrityService = new RequestIntegrityService({
  redis,
  config,
});
const weatherService = new WeatherService({ redis, config, logger });
const flightDataService = new FlightDataService({ config, logger });

const io = new Server({
  cors: { origin: "*" },
});

const actionOrchestrator = new ActionOrchestrator({
  operationsRepository,
  auditStore,
  io,
});
const oneRecordAuthService = new OneRecordAuthService({ config, redis, logger });
const oneRecordService = new OneRecordService({
  config,
  logger,
  authService: oneRecordAuthService,
  redis,
});
const reconciliationService = new ReconciliationService({
  config,
  exposureRepository,
  verificationQueueRepository,
  oneRecordService,
  auditStore,
  logger,
});
const cargoService = new CargoService({
  config,
  cargoRepository,
  exposureRepository,
  actionOrchestrator,
  notificationRouter: new NotificationRouter({
    alertService: new AlertService({
      subscriptions: subscriptionRepository,
      smtp: config.smtp,
      logger,
    }),
    auditStore,
    io,
  }),
  auditStore,
  io,
  logger,
});
const twilioService = new TwilioService({
  config,
  logger,
  auditStore,
  redis,
});

const pipeline = new TelemetryPipeline({
  config,
  exposureRepository,
  operationsRepository,
  weatherService,
  riskService: new RiskService({ config, logger }),
  actionOrchestrator,
  notificationRouter: new NotificationRouter({
    alertService: new AlertService({
      subscriptions: subscriptionRepository,
      smtp: config.smtp,
      logger,
    }),
    auditStore,
    io,
  }),
  auditStore,
  alertService: new AlertService({
    subscriptions: subscriptionRepository,
    smtp: config.smtp,
    logger,
  }),
  oneRecordService,
  reconciliationService,
  io,
});

const app = buildApp({
  config,
  logger,
  exposureRepository,
  operationsRepository,
  analyticsService,
  actionOrchestrator,
  auditStore,
  subscriptionRepository,
  reconciliationService,
  oneRecordService,
  cargoService,
  telemetryPipeline: pipeline,
  requestIntegrityService,
  weatherService,
  flightDataService,
  twilioService,
});

const server = http.createServer(app);
io.attach(server);

const mqttConsumer = new MqttConsumer({
  config,
  logger,
  pipeline,
  dlqRepository,
});

io.on("connection", async (socket) => {
  socket.emit("fleet", await exposureRepository.getFleetStatus());
});

server.listen(config.port, () => {
  logger.info({ port: config.port }, "Backend listening");
  void reconciliationService.start();
  void cargoService.ensureSeedData();
  mqttConsumer.start();
});
