-- Set explicit maxConcurrentRuns: 1 on all gemini_local agents that don't already have it configured.
-- This ensures burst quota exhaustion protection is enforced explicitly, not just via the normalized default.
UPDATE agents
SET runtime_config = jsonb_set(
  jsonb_set(
    COALESCE(runtime_config, '{}'),
    '{heartbeat}',
    COALESCE(runtime_config->'heartbeat', '{}'),
    true
  ),
  '{heartbeat,maxConcurrentRuns}',
  '1',
  true
)
WHERE adapter_type = 'gemini_local'
  AND runtime_config->'heartbeat'->'maxConcurrentRuns' IS NULL;
