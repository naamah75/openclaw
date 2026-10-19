import { collectNestedErrorCandidates } from "@openclaw/normalization-core/error-coercion";
import {
  ErrorCodes,
  errorShape,
  type ErrorShape,
} from "../../../packages/gateway-protocol/src/index.js";
import { GATEWAY_RESTART_UNAVAILABLE_REASON } from "../../../packages/gateway-protocol/src/restart-unavailable.js";
import { renderStorageFailureSummary } from "../../agents/failover/assistant-request-failure-copy.js";
import { isAgentRunRestartAbortReason } from "../../agents/run-termination.js";
import { SESSION_ROUTING_CHANGED_ERROR_REASON } from "../../config/sessions/main-session.js";
import { isSessionTranscriptProjectionUnavailableError } from "../../config/sessions/session-transcript-projection-error.js";
import { classifyGatewayStorageFailure } from "../../infra/sqlite-error-diagnostics.js";
import { isGatewayRestartDrainError } from "../../process/gateway-work-admission.js";
import { AgentDatabaseAdmissionError } from "../../state/agent-database-admission.js";
import { errorShapeFromError } from "../error-shape.js";
import { SessionMutationAuthorizationChangedError } from "../session-mutation-authorization-error.js";
import { formatForLog } from "../ws-log.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

/** An expected precondition refusal has an RPC response, not a failed-turn terminal. */
export class ChatSendAdmissionRefusedError extends Error {
  constructor(
    message: string,
    readonly error: ErrorShape = errorShape(ErrorCodes.INVALID_REQUEST, message),
  ) {
    super(message);
  }
}

export function resolveChatSendStorageErrorMessage(error: unknown): string | undefined {
  for (const candidate of collectNestedErrorCandidates(error)) {
    const message = renderStorageFailureSummary(classifyGatewayStorageFailure(candidate));
    if (message) {
      return message;
    }
  }
  return undefined;
}

export function createChatSessionRoutingChangedError() {
  return new ChatSendAdmissionRefusedError(
    SESSION_ROUTING_CHANGED_ERROR_REASON,
    errorShape(ErrorCodes.INVALID_REQUEST, "session routing changed; review and retry", {
      details: { reason: SESSION_ROUTING_CHANGED_ERROR_REASON },
    }),
  );
}

export function respondChatSessionRoutingChanged(respond: GatewayRequestHandlerOptions["respond"]) {
  respond(false, undefined, createChatSessionRoutingChangedError().error);
}

export function respondChatSendAdmissionError(
  error: unknown,
  respond: GatewayRequestHandlerOptions["respond"],
  onUnexpectedError?: (message: string) => void,
): void {
  if (
    error instanceof ChatSendAdmissionRefusedError ||
    error instanceof SessionMutationAuthorizationChangedError
  ) {
    return respond(false, undefined, error.error);
  }
  if (error instanceof AgentDatabaseAdmissionError) {
    return respond(false, undefined, errorShapeFromError(ErrorCodes.UNAVAILABLE, error));
  }
  if (isAgentRunRestartAbortReason(error) || isGatewayRestartDrainError(error)) {
    return respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "Gateway is restarting; retry after reconnecting", {
        retryable: true,
        details: { reason: GATEWAY_RESTART_UNAVAILABLE_REASON },
      }),
    );
  }
  if (isSessionTranscriptProjectionUnavailableError(error)) {
    return respond(
      false,
      undefined,
      errorShape(ErrorCodes.UNAVAILABLE, "session transcript is rebuilding; retry shortly", {
        details: { method: "chat.send" },
        retryable: true,
        retryAfterMs: 250,
      }),
    );
  }
  const storageMessage = resolveChatSendStorageErrorMessage(error);
  const failure = errorShapeFromError(
    storageMessage ? ErrorCodes.UNAVAILABLE : ErrorCodes.INVALID_REQUEST,
    error,
    { message: storageMessage ?? formatForLog(error) },
  );
  respond(false, undefined, failure);
  onUnexpectedError?.(failure.message);
}
