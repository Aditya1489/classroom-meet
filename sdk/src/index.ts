/**
 * Mathsy Meet Developer SDK
 *
 * Unified entry point providing server-side API client and browser-side embed helpers.
 */

export {
  MathsyMeetError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  SecurityError,
  type ServerClientConfig,
  type MeetingRoom,
  type CreateMeetingOptions,
  type ParticipantRole,
  type ParticipantPermissions,
  type CreateParticipantTokenOptions,
  type ParticipantTokenResult,
  type ParticipantList,
  type ApiKeyVerification,
  type EmbedEventType,
  type EmbedMeetingOptions,
  type MathsyMeetEmbedController,
} from "./types";

export { MathsyMeetServerClient } from "./server";
export { embedMeeting } from "./browser";
export {
  MathsyMeeting,
  useMathsyMeeting,
  type MathsyMeetingProps,
  type UseMathsyMeetingOptions,
  type UseMathsyMeetingReturn,
} from "./react";
