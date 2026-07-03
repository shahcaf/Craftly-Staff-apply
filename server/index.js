const express = require('express');
const fetch = require('node-fetch');
const nacl = require('tweetnacl');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables required:
// BOT_TOKEN - bot token (starts with Bot )
// PUBLIC_KEY - Discord application public key (for verifying interaction requests)
// CHANNEL_ID - channel ID where to post review messages
// Optionally set BASE_URL to the public https URL where review.html is hosted.

const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_KEY = process.env.PUBLIC_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID || null;
const BASE_URL = process.env.BASE_URL || null; // e.g. https://example.com/review.html

if (!BOT_TOKEN) console.warn('Warning: BOT_TOKEN not set. The send endpoint will fail without it.');
if (!PUBLIC_KEY) console.warn('Warning: PUBLIC_KEY not set. Interaction verification will fail without it.');

app.use(express.json());

// Helper to verify Discord interaction signatures
function verifyDiscordRequest(req, res, buf) {
  const signature = req.get('x-signature-ed25519');
  const timestamp = req.get('x-signature-timestamp');
  if (!signature || !timestamp) return false;
  const message = Buffer.concat([Buffer.from(timestamp, 'utf8'), buf]);
  const sig = Buffer.from(signature, 'hex');
  const pubKey = Buffer.from(PUBLIC_KEY || '', 'hex');
  try {
    return nacl.sign.detached.verify(new Uint8Array(message), new Uint8Array(sig), new Uint8Array(pubKey));
  } catch (e) {
    return false;
  }
}

// Use raw body for interaction verification
app.post('/interactions', express.raw({ type: '*/*' }), (req, res) => {
  if (!verifyDiscordRequest(req, res, req.body)) {
    return res.status(401).send('invalid request signature');
  }
  let body;
  try { body = JSON.parse(req.body.toString()); } catch (e) { return res.status(400).send('bad json'); }

  // PING
  if (body.type === 1) return res.json({ type: 1 });

  // MESSAGE_COMPONENT
  if (body.type === 3) {
    const customId = body.data.custom_id; // e.g. "approve:UUID"
    const [action, id] = (customId || '').split(':');
    const userTag = body.member?.user?.username || body.user?.username || 'Staff';
    const decisionText = action === 'approve' ? `✅ Approved by ${userTag}` : `❌ Rejected by ${userTag}`;

    // Edit the original message to reflect decision (requires bot token)
    const channelId = body.channel_id;
    const messageId = body.message?.id;
    if (BOT_TOKEN && channelId && messageId) {
      const editUrl = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`;
      const patchBody = { content: null, embeds: [] };
      // Simple approach: leave embed intact and add a footer field indicating decision
      // Fetch original message to get embed
      fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
        headers: { Authorization: `Bot ${BOT_TOKEN}` }
      }).then(r => r.json()).then(orig => {
        const embed = (orig.embeds && orig.embeds[0]) || {};
        embed.footer = embed.footer || {};
        embed.footer.text = (embed.footer.text ? embed.footer.text + ' • ' : '') + decisionText;
        const payload = { embeds: [embed] };
        fetch(editUrl, {
          method: 'PATCH',
          headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }).catch(() => {});
    }

    // Respond ephemerally to the user who clicked
    return res.json({
      type: 4,
      data: { content: decisionText, flags: 64 }
    });
  }

  return res.status(400).send('unknown interaction type');
});

// Endpoint for frontend to ask the bot to post a review message
app.post('/api/sendReviewMessage', async (req, res) => {
  if (!BOT_TOKEN) return res.status(500).json({ error: 'BOT_TOKEN not configured on server' });
  const body = req.body;
  // Body expected: { title, fields: [{name, value, inline}], footerText }
  const applicationId = uuidv4();
  const embed = {
    title: body.title || 'New Application',
    description: body.description || null,
    color: body.color || 5793266,
    fields: body.fields || [],
    footer: { text: body.footerText || '' },
    timestamp: new Date().toISOString()
  };

  // Build buttons with custom_id referencing the applicationId
  const components = [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: '🟢 Approve', custom_id: `approve:${applicationId}` },
        { type: 2, style: 4, label: '🔴 Reject',  custom_id: `reject:${applicationId}` }
      ]
    }
  ];

  const postUrl = `https://discord.com/api/v10/channels/${CHANNEL_ID}/messages`;
  const resp = await fetch(postUrl, {
    method: 'POST',
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed], components })
  });

  if (!resp.ok) {
    const text = await resp.text();
    return res.status(resp.status).json({ error: 'discord_error', detail: text });
  }

  const data = await resp.json();
  return res.json({ ok: true, messageId: data.id, channelId: data.channel_id, applicationId });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
