export class AnalyticsService {
  constructor({ exposureRepository, operationsRepository }) {
    this.exposureRepository = exposureRepository;
    this.operationsRepository = operationsRepository;
  }

  async getSummary() {
    const fleet = await this.exposureRepository.getFleetStatus();
    const pendingActions = await this.operationsRepository.listPendingActions(200);
    const activeWorkflows = await this.operationsRepository.listActiveWorkflows(200);

    const compliant = fleet.filter((item) => item.status === "OK").length;
    const avgExposure =
      fleet.length > 0
        ? fleet.reduce((sum, item) => sum + item.exposureUsed, 0) / fleet.length
        : 0;

    const roleDistribution = Object.values(
      pendingActions.reduce((accumulator, action) => {
        const role = action.assignedRole || "Unassigned";
        const current = accumulator[role] || {
          role,
          openActions: 0,
          criticalActions: 0,
        };
        current.openActions += 1;
        if (action.priority === "CRITICAL") {
          current.criticalActions += 1;
        }
        accumulator[role] = current;
        return accumulator;
      }, {}),
    ).sort((left, right) => right.openActions - left.openActions);

    return {
      totalUlds: fleet.length,
      compliantShipmentsPercent:
        fleet.length > 0 ? Number(((compliant / fleet.length) * 100).toFixed(1)) : 100,
      averageExposureMinutes: Number(avgExposure.toFixed(2)),
      warningCount: fleet.filter((item) => item.status === "AT_RISK").length,
      breachCount: fleet.filter((item) => item.status === "BREACH").length,
      pendingActions: pendingActions.length,
      activeWorkflows: activeWorkflows.length,
      roleDistribution,
    };
  }
}
