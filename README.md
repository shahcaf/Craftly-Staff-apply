# Discord Staff Application (Static GitHub Pages Edition)

A premium, fully static Discord-themed dark mode application form that connects directly to your Discord server via Webhook from the browser. It includes a staff review portal allowing you to Approve or Reject applications directly from Discord links without requiring a database or backend server.

Because it has **no backend**, you can deploy this website for free directly on **GitHub Pages**, **Vercel**, **Netlify**, or any other static hosting provider!

---

## 🚀 Quick Deployment to GitHub Pages

1. Go to your GitHub repository (e.g. `shahcaf/rop-apply`).
2. Go to **Settings** -> **Pages** (under the "Code and automation" section).
3. Under **Build and deployment**:
   - **Source**: Select `Deploy from a branch`.
   - **Branch**: Select `main` (and `/ (root)` folder).
4. Click **Save**.
5. Wait a minute and refresh. Your page will be live at `https://<your-username>.github.io/rop-apply/`!

---

## ⚙️ Configuration

Since this is a fully static website, the configuration is stored in the frontend JavaScript files.

### 1. Set Your Webhook URL
To make the application submit to your Discord server:
- Open [app.v2.js](file:///app.v2.js) and [review.html](file:///review.html).
- Find the `CONFIG` block at the top of the file:
```javascript
const CONFIG = {
  WEBHOOK_URL: 'YOUR_DISCORD_WEBHOOK_URL_HERE',
  SERVER_NAME: 'Our Discord Server'
};
```
- Replace the placeholder webhook URL with your actual Discord channel webhook URL.

### 2. Security Warning ⚠️
> [!WARNING]
> Because this is a static site with no backend server, the **Discord Webhook URL is visible in the browser's source code**. Anyone inspecting the website page can see the webhook URL. 
> To prevent spam:
> - Ensure your Discord channel permissions only allow authorized staff to read messages in the logs channel.
> - If the webhook is abused, you can delete it and generate a new one in your Discord Channel settings -> Integrations.

---

## 📝 How the Review Flow Works (No Database Required!)

1. **Submission**: The applicant fills out the 20-question form at `index.html`.
2. **Discord Embed**: The website posts a Discord embed to your channel via webhook. The embed has two action links:
   - `[🟢 Approve]`
   - `[🔴 Reject]`
3. **URL-Encoded State**: These buttons link to `review.html` and contain the applicant's responses encoded inside the URL parameters.
4. **Static Review Portal**: When a staff member clicks `Approve` or `Reject` from Discord:
   - They are redirected to `review.html` where all applicant answers are loaded and displayed from the URL parameters.
   - The reviewer inputs their name and clicks **Approve** or **Reject**.
   - The page sends a new, secondary webhook to Discord indicating that the application was reviewed and decided by that staff member!

---

## 💻 Local Testing

To test this locally:
1. Double-click `index.html` to open it in your browser, or run a local static server:
   ```bash
   npx serve .
   ```
2. Fill out the form and submit it.
3. Check your Discord channel for the incoming embed!
