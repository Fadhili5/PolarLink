export class ActionOrchestrator {
  constructor({ operationsRepository, auditStore, io }) {
    this.operationsRepository = operationsRepository;
    this.auditStore = auditStore;
    this.io = io;
  }

  async orchestrate({ uldId, decisionPackage, reading }) {
    const existingActions = await this.operationsRepository.getActions(uldId, 200);
    const existingWorkflows = await this.operationsRepository.getWorkflows(uldId, 200);
    const actions = [];
    const workflows = [];

    for (const actionTemplate of decisionPackage.actions) {
      const alreadyOpen = existingActions.some(
        (action) =>
          action.action === actionTemplate.action && action.status !== "VERIFIED",
      );
      if (alreadyOpen) {
        continue;
      }

      const action = {
        id: `${uldId}-${actionTemplate.action}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        uldId,
        action: actionTemplate.action,
        assignedRole: actionTemplate.assignedRole,
        priority: actionTemplate.priority,
        slaMinutes: actionTemplate.slaMinutes,
        status: "ALERT_CREATED",
        executionStatus: actionTemplate.priority === "AUTOMATED" ? "VERIFIED" : "ASSIGNED",
        createdAt: reading.timestamp,
        acknowledgedAt: null,
        completedAt: null,
        verifiedAt: null,
        responseTimeMinutes: null,
        slaDeadline: new Date(
          new Date(reading.timestamp).getTime() + actionTemplate.slaMinutes * 60000,
        ).toISOString(),
      };
      action.status = "ASSIGNED";
      if (actionTemplate.priority === "AUTOMATED") {
        action.status = "VERIFIED";
        action.completedAt = new Date().toISOString();
        action.verifiedAt = action.completedAt;
        action.responseTimeMinutes = 1;
      }
      await this.persistAction(uldId, action);
      actions.push(action);
    }

    for (const workflowTemplate of decisionPackage.workflows) {
      const alreadyOpen = existingWorkflows.some(
        (workflow) =>
          workflow.name === workflowTemplate.name && workflow.status !== "COMPLETED",
      );
      if (alreadyOpen) {
        continue;
      }

      const workflow = {
        id: `${uldId}-${workflowTemplate.name}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        uldId,
        name: workflowTemplate.name,
        status: "OPEN",
        steps: workflowTemplate.steps.map((step, index) => ({
          id: `${workflowTemplate.name}-${index + 1}`,
          label: step,
          status: index === 0 ? "READY" : "QUEUED",
        })),
        createdAt: reading.timestamp,
      };
      await this.persistWorkflow(uldId, workflow);
      workflows.push(workflow);
    }

    return { actions, workflows };
  }

  async completeAction(actionId) {
    const action = await this.operationsRepository.getAction(actionId);
    if (!action) return null;

    const completed = {
      ...action,
      status: "VERIFIED",
      completedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      responseTimeMinutes: action.responseTimeMinutes || 3,
    };
    await this.operationsRepository.setAction(completed);
    await this.operationsRepository.appendTimeline(completed.uldId, {
      type: "ACTION_UPDATE",
      ...completed,
    });
    await this.auditStore.log("action-completed", completed);
    this.io.emit("action", completed);
    return completed;
  }

  async acknowledgeAction(actionId, metadata = {}) {
    const action = await this.operationsRepository.getAction(actionId);
    if (!action) return null;

    const acknowledged = {
      ...action,
      status: action.status === "VERIFIED" ? action.status : "IN_PROGRESS",
      acknowledgedAt: metadata.at || new Date().toISOString(),
      acknowledgementSource: metadata.source || "external",
      acknowledgedBy: metadata.actor || "system",
      acknowledgementNote: metadata.note || null,
    };
    await this.persistUpdatedAction(acknowledged, "action-acknowledged");
    return acknowledged;
  }

  async acknowledgeFirstOpenAction(targetId, metadata = {}) {
    const [action] = (await this.operationsRepository.getActions(targetId, 200))
      .filter((item) => item.status !== "VERIFIED");
    if (!action) return null;
    return this.acknowledgeAction(action.id, metadata);
  }

  async completeFirstOpenAction(targetId, metadata = {}) {
    const [action] = (await this.operationsRepository.getActions(targetId, 200))
      .filter((item) => item.status !== "VERIFIED");
    if (!action) return null;

    const completed = {
      ...action,
      status: "VERIFIED",
      completedAt: metadata.at || new Date().toISOString(),
      verifiedAt: metadata.at || new Date().toISOString(),
      completedBy: metadata.actor || "system",
      completionSource: metadata.source || "external",
      completionNote: metadata.note || null,
      responseTimeMinutes: action.responseTimeMinutes || 3,
    };
    await this.persistUpdatedAction(completed, "action-completed");
    return completed;
  }

  async escalateOpenActions(targetId, metadata = {}) {
    const actions = (await this.operationsRepository.getActions(targetId, 200))
      .filter((item) => item.status !== "VERIFIED");

    const escalated = [];
    for (const action of actions) {
      const next = {
        ...action,
        priority: "CRITICAL",
        escalationSource: metadata.source || "external",
        escalatedBy: metadata.actor || "system",
        escalatedAt: metadata.at || new Date().toISOString(),
        escalationNote: metadata.note || null,
      };
      await this.persistUpdatedAction(next, "action-escalated");
      escalated.push(next);
    }
    return escalated;
  }

  async attachCommunicationEvent(targetId, event) {
    await this.operationsRepository.appendTimeline(targetId, {
      type: "COMMUNICATION",
      targetId,
      ...event,
    });
    await this.auditStore.log("communication", { targetId, ...event });
    this.io.emit("timeline", { targetId, ...event });
  }

  async orchestrateCargoIncident({ cargoId, incident }) {
    const existingActions = await this.operationsRepository.getActions(cargoId, 200);
    const existingWorkflows = await this.operationsRepository.getWorkflows(cargoId, 200);
    const actions = [];
    const workflows = [];

    const templates = [
      {
        action: incident.stopLoad ? "Stop cargo reload and hold shipment" : "Verify cargo custody at current location",
        assignedRole: "Cargo Team",
        priority: incident.stopLoad ? "CRITICAL" : "HIGH",
        slaMinutes: incident.stopLoad ? 5 : 10,
      },
      {
        action: incident.chainBroken ? "Dispatch security seal inspection" : "Confirm manifest and handler chain",
        assignedRole: incident.chainBroken ? "Security Supervisor" : "Ops Control",
        priority: "CRITICAL",
        slaMinutes: 8,
      },
    ];

    for (const template of templates) {
      const alreadyOpen = existingActions.some(
        (action) => action.action === template.action && action.status !== "VERIFIED",
      );
      if (alreadyOpen) continue;

      const action = {
        id: `${cargoId}-${template.action}-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        uldId: cargoId,
        action: template.action,
        assignedRole: template.assignedRole,
        priority: template.priority,
        slaMinutes: template.slaMinutes,
        status: "ASSIGNED",
        executionStatus: "ASSIGNED",
        createdAt: incident.timestamp,
        acknowledgedAt: null,
        completedAt: null,
        verifiedAt: null,
        responseTimeMinutes: null,
        slaDeadline: new Date(
          new Date(incident.timestamp).getTime() + template.slaMinutes * 60000,
        ).toISOString(),
        source: "CARGO_CUSTODY",
      };
      await this.persistAction(cargoId, action);
      actions.push(action);
    }

    if (!existingWorkflows.some((workflow) => workflow.name === "CargoCustodyIncidentWorkflow" && workflow.status !== "COMPLETED")) {
      const workflow = {
        id: `${cargoId}-CargoCustodyIncidentWorkflow-${Date.now()}-${Math.round(Math.random() * 1000)}`,
        uldId: cargoId,
        name: "CargoCustodyIncidentWorkflow",
        status: "OPEN",
        steps: [
          { id: "custody-1", label: "Freeze cargo movement", status: "READY" },
          { id: "custody-2", label: "Verify evidence, manifest, and seal", status: "QUEUED" },
          { id: "custody-3", label: "Approve reload or escalate for investigation", status: "QUEUED" },
        ],
        createdAt: incident.timestamp,
        source: "CARGO_CUSTODY",
      };
      await this.persistWorkflow(cargoId, workflow);
      workflows.push(workflow);
    }

    return { actions, workflows };
  }

  async persistAction(uldId, action) {
    await this.operationsRepository.appendAction(uldId, action);
    await this.operationsRepository.setAction(action);
    await this.operationsRepository.appendTimeline(uldId, {
      type: "ACTION",
      ...action,
    });
    await this.auditStore.log("action", action);
    this.io.emit("action", action);
  }

  async persistWorkflow(uldId, workflow) {
    await this.operationsRepository.appendWorkflow(uldId, workflow);
    await this.operationsRepository.setWorkflow(workflow);
    await this.operationsRepository.appendTimeline(uldId, {
      type: "WORKFLOW",
      ...workflow,
    });
    await this.auditStore.log("workflow", workflow);
    this.io.emit("workflow", workflow);
  }

  async persistUpdatedAction(action, auditType) {
    await this.operationsRepository.setAction(action);
    await this.operationsRepository.appendTimeline(action.uldId, {
      type: "ACTION_UPDATE",
      ...action,
    });
    await this.auditStore.log(auditType, action);
    this.io.emit("action", action);
  }
}
