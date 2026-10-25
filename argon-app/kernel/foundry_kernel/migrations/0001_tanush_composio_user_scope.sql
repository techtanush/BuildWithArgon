-- OWNER: tanush
-- Match the integration contract for ventures created by the initial Lane A build.
UPDATE ventures SET composio_user_id = 'foundry:' || id WHERE composio_user_id = id;
