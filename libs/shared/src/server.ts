// Server-only exports from @chatbot/shared — Node.js runtime required.
//
// S3Service pulls in @smithy/node-http-handler, which does static `node:http`/`node:https`/
// `node:http2` imports. Those are fine for the Next.js server runtime and for apps/workers
// (both are plain Node processes), but webpack's browser bundle can't resolve the `node:`
// scheme at all — it hard-fails the build rather than tree-shaking it out. S3Service used to
// live in the main `.` barrel, and it took only one careless `createLogger`-from-barrel import
// inside a file reachable from a 'use client' component (see git blame on this file for the
// incident) to drag the whole barrel — S3Service included — into the client bundle.
// Import S3Service from here, not from the root `@chatbot/shared` barrel, so a similar mistake
// elsewhere can't repeat this failure for S3 specifically.
export { S3Service } from './services/s3-service';
export type { S3ObjectHead, S3PresignedPost } from './services/s3-service';

// Same reasoning as S3Service above: each of these imports S3Service directly, so re-exporting
// them from the main barrel would drag @smithy/node-http-handler right back in through a
// different door.
export { executeTranscription } from './services/transcription-runner';
export type {
  TranscribeFn,
  TranscribeResult,
  ExecuteTranscriptionParams,
  ExecuteTranscriptionResult,
} from './services/transcription-runner';
export { TranscriptionUploadService, detectAudioFormat } from './services/transcription-upload-service';
export type {
  CreateTranscriptionUploadInput,
  CreateTranscriptionUploadResult,
  DetectedAudioFormat,
} from './services/transcription-upload-service';
export { dispatchUploadedTranscription, PayloadTooLargeError } from './services/transcription-dispatch';
export type {
  EnqueueFn,
  ResolvedJobConfigRef,
  DispatchUploadedTranscriptionParams,
  DispatchUploadedTranscriptionResult,
} from './services/transcription-dispatch';
