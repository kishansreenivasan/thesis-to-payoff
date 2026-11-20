import opened from "../../../../evidence/rehearsal-2026-11-19-open.json";
import rescued from "../../../../evidence/rehearsal-2026-11-19-rescue.json";

// Keep the original receipts intact; this view only advances through saved evidence.
export const demo = {
  capturedAtUtc: opened.capturedAtUtc,
  plan: opened.plan,
  orders: opened.position.orders,
  shock: rescued.shock,
  request: rescued.shock.transferRequest,
  decline: rescued.declineWithFollowUp,
  reduction: rescued.declineWithFollowUp.followUp.reduceOrder,
  reverted: rescued.activityLog.find((event) => event.type === "RELEASE_REVERTED")!,
  calibration: rescued.calibrateAfter,
};
