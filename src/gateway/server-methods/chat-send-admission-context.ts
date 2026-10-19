import type { GatewaySessionEntryRead } from "../session-utils.js";
import { resolveChatSendOriginatingRoute } from "./chat-origin-routing.js";
import { assertExpectedLeafActive } from "./chat-send-active-leaf.js";
import {
  ChatSendAdmissionRefusedError,
  respondChatSendAdmissionError,
} from "./chat-send-admission-errors.js";
import type { NormalizedChatSendRequest } from "./chat-send-request.js";
import type { PreparedChatSendSession } from "./chat-send-session.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

export function prepareChatSendAdmissionContext(params: {
  request: NormalizedChatSendRequest;
  session: PreparedChatSendSession;
  client: GatewayRequestHandlerOptions["client"];
}) {
  const { request, session, client } = params;
  const { p, explicitOrigin, normalizedAttachments } = request;
  const { cfg, entry, sessionKey, selectedAgent, agentId, clientRunId, resolvedSessionModel } =
    session;
  return {
    chatSendTraceAttributes: {
      runId: clientRunId,
      sessionKey,
      agentId: selectedAgent.agentId ?? agentId,
      provider: resolvedSessionModel.provider,
      model: resolvedSessionModel.model,
      hasAttachments: normalizedAttachments.length > 0,
      hasExplicitOrigin: explicitOrigin !== undefined,
      hasConnectedClient: client?.connect !== undefined,
    },
    originatingRoute: resolveChatSendOriginatingRoute({
      client: request.clientInfo,
      deliver: p.deliver,
      entry,
      explicitOrigin,
      hasConnectedClient: client?.connect !== undefined,
      mainKey: cfg.session?.mainKey,
      sessionKey,
    }),
  };
}

/** Check the captured target assertion and settle admission failure before responding. */
export function assertChatSendSessionTargetOrRespond(params: {
  assertSessionTargetCurrent: () => void;
  cleanup: () => void;
  respond: GatewayRequestHandlerOptions["respond"];
}): boolean {
  try {
    params.assertSessionTargetCurrent();
    return true;
  } catch (error) {
    params.cleanup();
    respondChatSendAdmissionError(error, params.respond);
    return false;
  }
}

/** Refuse a deleted, branched, or reset session before committing new work. */
export function assertChatSendSessionEntryCurrent(
  request: NormalizedChatSendRequest,
  session: PreparedChatSendSession,
  latest: GatewaySessionEntryRead,
) {
  const { entry, sessionKey, expectedLeafEntryId, requestedSessionId, backingSessionId } = session;
  const latestSessionId = latest.entry?.sessionId;
  if (entry && !latest.entry) {
    throw new ChatSendAdmissionRefusedError(
      `Session "${sessionKey}" was deleted while starting work. Retry.`,
    );
  }
  if (request.p.queueMode !== "steer" && expectedLeafEntryId !== undefined) {
    assertExpectedLeafActive(latest, expectedLeafEntryId, requestedSessionId, {
      allowEmptyAncestor: true,
    });
  }
  // Check the leaf first for typed errors; a reset must never redirect this request.
  if (backingSessionId && latestSessionId && latestSessionId !== backingSessionId) {
    throw new ChatSendAdmissionRefusedError(
      `Session "${sessionKey}" changed while starting work. Retry.`,
    );
  }
}
