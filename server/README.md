# Craftly Review Bot (Minimal)

This is a minimal Node.js Express server that lets a frontend ask a Discord bot to post review messages with native Discord buttons (message components). Buttons are handled by the `/interactions` endpoint.

Environment variables

- `BOT_TOKEN` - Bot token (starts with `Bot `). Required to post messages.
- `PUBLIC_KEY` - Discord application public key (for verifying interaction requests).
- `CHANNEL_ID` - Channel ID where the bot should post review messages.
- `BASE_URL` - Optional; absolute URL to your hosted `review.html` (used in embeds).
- `PORT` - Optional; default `3000`.

Install & run

```bash
cd server
npm install
BOT_TOKEN="Bot xxxxx" PUBLIC_KEY="..." CHANNEL_ID="123456" BASE_URL="https://example.com/review.html" npm start
```

How it works

- Frontend POSTs to `/api/sendReviewMessage` with an embed payload.
- Server posts the embed to the configured `CHANNEL_ID` using your bot token and attaches two `custom_id` buttons: `approve:<uuid>` and `reject:<uuid>`.
- When a staff member clicks a button, Discord sends an interaction to `/interactions` which verifies the request and replies ephemerally, and the server updates the original message footer to mark the decision.

Notes

- For local testing of interactions, your `/interactions` endpoint must be publicly reachable and the URL registered as your application's Interaction Endpoint URL in the Discord Developer Portal. Use `ngrok` to tunnel during development.
- This is a minimal scaffold. You may wish to persist application data in a database and include more robust error handling.
