# WhatsApp intake

Most people in a flood have WhatsApp, not a custom app. The webhook (`backend/wa.ts`) accepts text, voice notes and a shared location from WhatsApp and feeds them into the same pipeline as the web page.

**What exists:** a signed-webhook Lambda, per-sender rate limiting, duplicate handling, voice-note transcription, Hindi acknowledgements that always mention 112.

**What you must do (cannot be done from code):**

1. Create a Meta developer app and a WhatsApp Business account. Business verification and a dedicated phone number are required by Meta, and approval can take days to weeks. A government department usually applies as the business.
2. Deploy the stack. Note the `ApiUrl` and the `WaSecret` output (the Secrets Manager secret name, `baadhmitra/whatsapp`).
3. Put the credentials into the secret (Windows CMD, one line, replace the values):
   ```
   aws secretsmanager put-secret-value --secret-id baadhmitra/whatsapp --secret-string "{\"verify_token\":\"choose-a-long-random-string\",\"app_secret\":\"<Meta app secret>\",\"access_token\":\"<permanent system-user token>\",\"phone_id\":\"<WhatsApp phone number id>\"}"
   ```
4. In the Meta dashboard, WhatsApp > Configuration, set the callback URL to `<ApiUrl>whatsapp` and the verify token to the same string. Subscribe to the `messages` field.
5. Send a test message from a phone. Within a minute it should appear in the queue (or in `unplaced` if no place was named).

**Safety behaviour you can rely on**

- Every webhook call is verified with `X-Hub-Signature-256` over the raw body. With no `app_secret` set the endpoint refuses everything (HTTP 503), so a half-configured deployment is not an open door.
- Phone numbers are never stored. They are salted and hashed to a sender id, which is what limits one phone to 30 reports an hour.
- Meta retries on error, so each message id is processed once.
- Replies never promise rescue. They say the report was recorded and tell the person to call 112 in an emergency.
- A person can share a WhatsApp location pin first; it is used for their next messages for two hours and only if it is inside Bihar.

**Limits:** voice notes over about 5 MB are refused; media types other than text, voice and location get a polite "send text or voice" reply; WhatsApp message templates (needed to message someone after 24 hours) are not implemented.
