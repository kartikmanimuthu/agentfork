-- Task 13: Drop the chat module — Conversation, Message, ConversationSummary, ConversationAnalytics.
-- All inferencing data now lives in inference_sessions + inference_session_messages + session_analytics.

-- Drop child tables first (FKs cascade from conversations but explicit is safer)
DROP TABLE IF EXISTS "conversation_analytics";
DROP TABLE IF EXISTS "conversation_summaries";
DROP TABLE IF EXISTS "messages";
DROP TABLE IF EXISTS "conversations";
