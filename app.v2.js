// ============================================================
// CONFIGURATION — Edit these values for your Discord server
// ============================================================
const CONFIG = {
  WEBHOOK_URL: 'https://discord.com/api/webhooks/1522596919019573479/hNFVQE2n4DkMGrHhxt-WQU4R9sI8T5lj8O-dq3q6Y3lgLv3IRYlWzXxDHp-G7lw8zN1K',
  SERVER_NAME: 'Craftly.gg',
  // Optional: absolute URL to your review portal (https://...). If you serve
  // the app locally via file:// this should be set so Discord link buttons
  // can use a proper https URL. Update this to your hosted review page if needed.
  REVIEW_BASE: 'https://shahcaf.github.io/Craftly-Staff-apply/review.html',
  // Optional: if you run the Node bot server, set BOT_ENDPOINT to its public URL
  // e.g. 'https://example.com/api/sendReviewMessage'
  BOT_ENDPOINT: '',
  // Optional: set a Discord thread ID to post all applications into a specific thread
  THREAD_ID: null,
  // Webhook bot appearance
  WEBHOOK_USERNAME: '📋 Craftly.gg Application System',
  WEBHOOK_AVATAR: 'https://cdn.discordapp.com/emojis/1056479967568371712.png', // set to any image URL or null
  // Embed accent colors
  COLOR_PENDING:  5793266,  // Discord Blurple
  COLOR_APPROVED: 3066993,  // Green
  COLOR_REJECTED: 15158332, // Red
};
// ============================================================

// Debug: log the webhook URL at runtime to confirm which webhook is used
console.log('CONFIG.WEBHOOK_URL =', CONFIG.WEBHOOK_URL);

// ============================================================
// ANTI-SPAM CONFIGURATION
// ============================================================
const ANTI_SPAM = {
  // How long (ms) a user must wait before re-submitting (default: 10 minutes)
  // Set to 0 to disable cooldown between submissions
  COOLDOWN_MS: 0,
  // Key used to store submission metadata in localStorage
  STORAGE_KEY: 'craftly_last_submission',
  // Maximum submissions allowed from the same browser per day
  // Set to 0 to disable daily submission limit
  MAX_PER_DAY: 0,
};

/**
 * Check if the current browser session is allowed to submit.
 * Returns { allowed: boolean, reason: string, remainingMs: number }
 */
function checkAntiSpam(discordId) {
  try {
    const raw = localStorage.getItem(ANTI_SPAM.STORAGE_KEY);
    if (!raw) return { allowed: true };

    const data = JSON.parse(raw);
    const now = Date.now();

    // Cooldown check
    if (data.lastSubmit) {
      const elapsed = now - data.lastSubmit;
      if (elapsed < ANTI_SPAM.COOLDOWN_MS) {
        const remainingMs = ANTI_SPAM.COOLDOWN_MS - elapsed;
        const mins = Math.ceil(remainingMs / 60000);
        return {
          allowed: false,
          reason: `You recently submitted an application. Please wait ${mins} minute${mins !== 1 ? 's' : ''} before trying again.`,
          remainingMs
        };
      }
    }

    // Daily limit check (only enforce if MAX_PER_DAY > 0)
    if (ANTI_SPAM.MAX_PER_DAY > 0 && data.submissionsToday) {
      const lastDate = new Date(data.lastSubmit).toDateString();
      const today = new Date().toDateString();
      if (lastDate === today && data.submissionsToday >= ANTI_SPAM.MAX_PER_DAY) {
        return {
          allowed: false,
          reason: `You have reached the maximum of ${ANTI_SPAM.MAX_PER_DAY} applications today. Please try again tomorrow.`,
          remainingMs: 0
        };
      }
    }

    return { allowed: true };
  } catch (e) {
    return { allowed: true }; // fail-open
  }
}

/**
 * Record a successful submission for anti-spam tracking.
 */
function recordSubmission() {
  try {
    const raw = localStorage.getItem(ANTI_SPAM.STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    const now = Date.now();

    const lastDate = existing.lastSubmit ? new Date(existing.lastSubmit).toDateString() : null;
    const today = new Date().toDateString();
    const todayCount = lastDate === today ? (existing.submissionsToday || 0) : 0;

    localStorage.setItem(ANTI_SPAM.STORAGE_KEY, JSON.stringify({
      lastSubmit: now,
      submissionsToday: todayCount + 1,
    }));
  } catch (e) {
    console.warn('Failed to record submission for anti-spam', e);
  }
}
// ============================================================

// Compress a JSON string using deflate compression and return a URL-safe Base64 string
async function compressPayload(str) {
  try {
    const stream = new Blob([str]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('deflate'));
    const response = new Response(compressedStream);
    const buffer = await response.arrayBuffer();

    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (e) {
    console.error('Failed to compress payload', e);
    return null;
  }
}

// Send webhook with retry logic to handle rate-limits and network failures
async function sendWithRetry(url, body, method, retries, delay) {
  method = method || 'POST';
  retries = retries || 3;
  delay = delay || 1000;
  
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      if (resp.status === 429) {
        const rateLimitData = await resp.json();
        const retryAfter = (rateLimitData.retry_after * 1000) || delay;
        console.warn(`Rate limited by Discord. Retrying after ${retryAfter}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter));
        continue;
      }
      
      return resp;
    } catch (e) {
      if (i === retries - 1) throw e;
      console.warn(`Request failed. Retrying in ${delay}ms...`, e);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

const ROLE_SCHEMAS = {
  discord_staff: {
    title: "Discord Staff Team",
    questions: [
      { id: 'hours_active',   label: 'How many hours per week can you dedicate to the server?', type: 'number', step: 2, min: 1, max: 168, placeholder: 'e.g. 15', required: true },
      { id: 'why_staff',      label: 'Why do you want to join our staff team?', type: 'textarea', step: 2, placeholder: 'Tell us your motivation...', required: true },
      { id: 'experience',     label: 'What prior moderation/staff experience do you have?', type: 'textarea', step: 2, placeholder: 'Mention server names, sizes, or responsibilities...', required: true },
      { id: 'strengths',      label: 'What are your key strengths?', type: 'textarea', step: 2, placeholder: 'What makes you stand out?', required: true },
      
      { id: 'weaknesses',     label: 'What are your weaknesses, and how do you manage them?', type: 'textarea', step: 3, placeholder: 'Be honest - we value self-awareness...', required: true },
      { id: 'stress_handle',  label: 'How do you handle stressful situations or conflict?', type: 'textarea', step: 3, placeholder: 'Explain your coping mechanisms...', required: true },
      { id: 'handle_spam',    label: 'Scenario: A user is spamming links in chat. What do you do?', type: 'textarea', step: 3, placeholder: 'Detail your step-by-step reaction...', required: true },
      { id: 'handle_argument',label: 'Scenario: Two members are arguing in text/voice. How do you de-escalate?', type: 'textarea', step: 3, placeholder: 'How do you handle conflict between users?', required: true },
      
      { id: 'handle_dm_adv',  label: 'Scenario: A member is reported for advertising in DMs. What do you do?', type: 'textarea', step: 4, placeholder: 'What proof do you ask for, and what action is taken?', required: true },
      { id: 'handle_abuse',   label: 'Scenario: You suspect another staff member is abusing power. What do you do?', type: 'textarea', step: 4, placeholder: 'How do you handle internal staff conflicts?', required: true },
      { id: 'handle_nsfw',    label: 'Scenario: A user posts NSFW content in general chat. What is your response?', type: 'textarea', step: 4, placeholder: 'What actions do you take immediately?', required: true },
      { id: 'handle_unsure',  label: 'If you are unsure of a moderation decision, what do you do?', type: 'textarea', step: 4, placeholder: 'Who do you consult, or how do you decide?', required: true },
      
      { id: 'hobbies',        label: 'What are your hobbies or interests outside of Discord?', type: 'textarea', step: 5, placeholder: 'We want to know the person behind the screen!', required: true },
      { id: 'server_mgmt',    label: 'Do you have experience with server management, bots, or configurations?', type: 'textarea', step: 5, placeholder: 'e.g. setting up dyno, permissions, webhooks...', required: true },
      { id: 'guidelines_agree', label: 'Do you agree to follow all staff guidelines and remain active?', type: 'checkbox', step: 5, required: true, checkboxLabel: 'I agree to behave professionally, uphold server rules, and communicate with the team.' },
      { id: 'additional_info', label: 'Is there anything else you would like to share?', type: 'textarea', step: 5, placeholder: 'Anything else we should know?', required: true }
    ]
  },
  media_team: {
    title: "Media Team",
    questions: [
      { id: 'media_role',     label: 'What specific role are you applying for?', type: 'select', step: 2, options: ['Graphic Designer', 'Video Editor', 'Content Creator', 'Social Media Manager', 'Other'], required: true },
      { id: 'hours_active',   label: 'How many hours per week can you dedicate to media work?', type: 'number', step: 2, min: 1, max: 168, placeholder: 'e.g. 10', required: true },
      { id: 'portfolio',      label: 'Please provide a link to your portfolio or past work.', type: 'text', step: 2, placeholder: 'e.g. Behance, YouTube channel, Drive link...', required: true, helperText: 'Provide links to your graphic designs, edit reels, or channels.' },
      { id: 'tools_used',     label: 'What software/tools do you specialize in?', type: 'text', step: 2, placeholder: 'e.g. Photoshop, Premiere Pro, After Effects, Figma, Canva...', required: true },
      
      { id: 'why_media',      label: 'Why do you want to join our Media Team?', type: 'textarea', step: 3, placeholder: 'Tell us why you want to design/create for Craftly.gg...', required: true },
      { id: 'prior_work',     label: 'Detail any prior experience creating media content for servers or organizations.', type: 'textarea', step: 3, placeholder: 'Describe your past projects and responsibilities...', required: true },
      { id: 'strengths_media', label: 'What are your core creative strengths?', type: 'textarea', step: 3, placeholder: 'e.g. visual styling, motion graphics, audio design, branding...', required: true },
      
      { id: 'handle_negative_feedback', label: 'Scenario: A piece of content you designed/edited gets negative feedback. How do you handle it?', type: 'textarea', step: 4, placeholder: 'Explain your reaction and process...', required: true },
      { id: 'handle_deadline', label: 'Scenario: We need a thumbnail or promo video created on short notice (e.g. 24 hours). How do you handle it?', type: 'textarea', step: 4, placeholder: 'How do you handle urgent tasks or tight deadlines?', required: true },
      { id: 'handle_disagreement', label: 'Scenario: You disagree with a lead or staff member on design direction. How do you resolve this?', type: 'textarea', step: 4, placeholder: 'Explain how you approach differences in creative vision...', required: true },
      
      { id: 'hobbies',        label: 'What are your hobbies or interests outside of media work?', type: 'textarea', step: 5, placeholder: 'Tell us about yourself...', required: true },
      { id: 'guidelines_agree', label: 'Do you agree to follow Craftly.gg media guidelines and represent the community professionally?', type: 'checkbox', step: 5, required: true, checkboxLabel: 'I agree to follow design guidelines, use licensed assets, and communicate professionally.' },
      { id: 'additional_info', label: 'Is there anything else you would like to share?', type: 'textarea', step: 5, placeholder: 'Anything else we should know?', required: true }
    ]
  },
  rbx_dev: {
    title: "Roblox Dev Team",
    questions: [
      { id: 'dev_role',       label: 'What is your primary development role?', type: 'select', step: 2, options: ['Scripter (Luau)', 'Builder / Map Designer', 'UI/UX Designer', '3D Modeler (Blender)', 'Animator', 'Other'], required: true },
      { id: 'hours_active',   label: 'How many hours per week can you dedicate to project development?', type: 'number', step: 2, min: 1, max: 168, placeholder: 'e.g. 12', required: true },
      { id: 'roblox_profile', label: 'Please provide a link to your Roblox Profile.', type: 'text', step: 2, placeholder: 'e.g. https://www.roblox.com/users/123456/profile', required: true },
      { id: 'portfolio',      label: 'Please provide a link to your portfolio or showcases.', type: 'text', step: 2, placeholder: 'e.g. DevForum portfolio, GitHub, Roblox place links...', required: true },
      
      { id: 'prior_games',    label: 'List any Roblox games you have contributed to or worked on.', type: 'textarea', step: 3, placeholder: 'Provide links and detail what you did in each game...', required: true },
      { id: 'why_dev',        label: 'Why do you want to join the Craftly.gg Dev Team?', type: 'textarea', step: 3, placeholder: 'What motivates you to build/script for Craftly.gg?', required: true },
      { id: 'collaboration',  label: 'How do you handle working as a team with other devs (builders, scripters, modelers)?', type: 'textarea', step: 3, placeholder: 'Describe your teamwork and communication habits...', required: true },
      
      { id: 'handle_bug',     label: 'Scenario: A critical game-breaking bug is discovered in production right before an event. How do you react?', type: 'textarea', step: 4, placeholder: 'Detail your troubleshooting and response steps...', required: true },
      { id: 'handle_refactor', label: 'Scenario: Another developer refactors your scripts or modifies your assets without warning. What do you do?', type: 'textarea', step: 4, placeholder: 'How do you address creative differences or code ownership disputes?', required: true },
      { id: 'handle_deadline', label: 'Scenario: You are struggling to meet a milestone deadline. What is your action plan?', type: 'textarea', step: 4, placeholder: 'How do you manage stress and communicate delays?', required: true },
      
      { id: 'hobbies',        label: 'What are your hobbies or interests outside of development?', type: 'textarea', step: 5, placeholder: 'Tell us about yourself...', required: true },
      { id: 'guidelines_agree', label: 'Do you agree to follow developer guidelines, protect project assets, and not leak updates?', type: 'checkbox', step: 5, required: true, checkboxLabel: 'I agree to maintain asset security, follow coding/building standards, and cooperate with project leads.' },
      { id: 'additional_info', label: 'Is there anything else you would like to share?', type: 'textarea', step: 5, placeholder: 'Anything else we should know?', required: true }
    ]
  },

  beta_tester: {
    title: "Beta Tester",
    questions: [
      { id: 'hours_active',      label: 'How many hours per week can you dedicate to testing?', type: 'number', step: 2, min: 1, max: 168, placeholder: 'e.g. 8', required: true },
      { id: 'roblox_profile',   label: 'Please provide a link to your Roblox Profile.', type: 'text', step: 2, placeholder: 'e.g. https://www.roblox.com/users/123456/profile', required: true },
      { id: 'device_types',     label: 'Which platforms/devices do you primarily play Roblox on?', type: 'select', step: 2, options: ['PC (Windows/Mac)', 'Mobile (iOS)', 'Mobile (Android)', 'Xbox / Console', 'Multiple Platforms'], required: true },

      { id: 'testing_exp',      label: 'Do you have prior experience beta testing or QA testing games/software? If so, describe it.', type: 'textarea', step: 3, placeholder: 'List any games, software, or servers you have tested for...', required: true },
      { id: 'bug_report',       label: 'How would you describe and report a bug? Walk us through your process.', type: 'textarea', step: 3, placeholder: 'What information do you include in a bug report? Steps to reproduce, severity...', required: true },
      { id: 'why_beta',         label: 'Why do you want to become a Beta Tester for Craftly.gg?', type: 'textarea', step: 3, placeholder: 'What motivates you to help test and improve our projects?', required: true },

      { id: 'scenario_crash',   label: 'Scenario: You are in a beta session and the game crashes every time you enter a specific area. What do you do?', type: 'textarea', step: 4, placeholder: 'Describe exactly what you would do, what information you would collect, and how you would report it...', required: true },
      { id: 'scenario_balance', label: 'Scenario: You find a mechanic that feels unfair or unbalanced but is not technically a bug. How do you handle this?', type: 'textarea', step: 4, placeholder: 'How do you distinguish a bug from a design issue, and how do you report subjective feedback?', required: true },

      { id: 'confidentiality',  label: 'Do you understand that beta features are confidential and must not be shared publicly?', type: 'checkbox', step: 5, required: true, checkboxLabel: 'I agree to keep all beta content, unreleased features, and internal feedback strictly confidential.' },
      { id: 'additional_info',  label: 'Is there anything else you would like to share with us?', type: 'textarea', step: 5, placeholder: 'Any extra context, past experience, or anything else we should know?', required: true }
    ]
  }
};

// ============================================================
// PLACEHOLDER / NON-INFORMATIVE ANSWER VALIDATION
// ============================================================

/**
 * List of exact-match placeholder terms (case-insensitive, trimmed).
 * Any answer that is exclusively one of these is rejected.
 */
const PLACEHOLDER_TERMS = new Set([
  'n/a', 'na', 'n.a', 'n.a.', 'none', 'not applicable', 'no', '-', '--', '---',
  '.', '..', '...', 'unknown', 'test', 'asdf', 'qwerty', 'asd', 'foo', 'bar',
  'lol', 'idk', 'idc', 'whatever', 'nothing', 'nope', 'nah', 'blank', 'empty',
  'null', 'nil', 'n/a.', 'na.', 'not sure', 'unsure', 'skip', 'no idea',
  'no comment', 'pass', 'same', 'see above', 'as above', '?', '??', '???',
  'hello', 'hi', 'hey', '1', '2', '3', 'a', 'b', 'c', 'x', 'y', 'z',
  'yes', 'no.', 'yes.', 'ok', 'okay', 'sure', 'fine', 'good', 'great',
  'i dont know', "i don't know", 'i do not know', 'no answer', 'random',
  'placeholder', 'example', 'sample', 'temp', 'tbd', 'wip'
]);

/**
 * Returns an object { valid: boolean, reason: string } describing whether
 * the answer passes the placeholder / quality checks.
 *
 * Rules (for text & textarea fields):
 *  1. Trimmed value must not be empty (handled separately).
 *  2. Must not be solely a PLACEHOLDER_TERM.
 *  3. Must contain at least 3 meaningful words (words with ≥2 non-symbol chars).
 *     (Exception: number fields skip the word-count rule.)
 */
function validateAnswerQuality(value, fieldType) {
  const trimmed = value.trim();

  // Normalise to lower-case for set look-up
  const lower = trimmed.toLowerCase();

  // Rule 1 — placeholder term
  if (PLACEHOLDER_TERMS.has(lower)) {
    return {
      valid: false,
      reason: 'Please provide a valid, detailed answer. Placeholder responses are not accepted.'
    };
  }

  // Rule 2 — repeated single character or pure punctuation / symbols
  if (/^[^a-zA-Z0-9]+$/.test(trimmed)) {
    return {
      valid: false,
      reason: 'Please provide a valid, detailed answer. Placeholder responses are not accepted.'
    };
  }

  // Rule 3 — minimum word count for text and textarea fields only
  if (fieldType === 'textarea' || fieldType === 'text') {
    // Count words that have at least 2 alphabetic/numeric characters
    const words = trimmed.split(/\s+/).filter(w => (w.match(/[a-zA-Z0-9]/g) || []).length >= 2);
    if (words.length < 3) {
      return {
        valid: false,
        reason: 'Please provide a more detailed answer (at least 3 meaningful words).'
      };
    }
  }

  return { valid: true, reason: '' };
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('staff-app-form');
  const stepNodes = document.querySelectorAll('.step-node');
  const progressBar = document.getElementById('progress-indicator');
  const prevBtn = document.getElementById('prev-btn');
  const nextBtn = document.getElementById('next-btn');
  const submitBtn = document.getElementById('submit-btn');
  const statusCard = document.getElementById('status-card');
  const statusIconSuccess = document.getElementById('status-icon-success');
  const statusIconError = document.getElementById('status-icon-error');
  const statusTitle = document.getElementById('status-title');
  const statusMessage = document.getElementById('status-message');
  const statusResetBtn = document.getElementById('status-reset-btn');
  const dynamicContainer = document.getElementById('dynamic-sections-container');

  let currentStep = 1;
  const totalSteps = 5;

  // Render initial dynamic steps for default selected role
  let selectedRole = document.querySelector('input[name="role"]:checked').value;
  renderDynamicSteps(selectedRole);
  loadFormDraft();
  updateNavigation();

  // Handle Role Selection change
  form.querySelectorAll('input[name="role"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectedRole = e.target.value;
      renderDynamicSteps(selectedRole);
      // If we are past step 1, reset back to step 1 when they change the role to prevent confusion
      if (currentStep > 1) {
        currentStep = 1;
      }
      saveFormDraft();
      updateNavigation();
    });
  });

  nextBtn.addEventListener('click', () => {
    if (validateStep(currentStep)) { currentStep++; updateNavigation(); }
  });
  prevBtn.addEventListener('click', () => {
    if (currentStep > 1) { currentStep--; updateNavigation(); }
  });

  // Attach inputs check for the static inputs in step 1
  form.querySelectorAll('.form-section[data-section="1"] input').forEach(el => {
    el.addEventListener('input', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        const errSpan = el.closest('.form-group')?.querySelector('.error-msg');
        if (errSpan) errSpan.textContent = '';
        saveFormDraft();
    });
    el.addEventListener('change', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        const errSpan = el.closest('.form-group')?.querySelector('.error-msg');
        if (errSpan) errSpan.textContent = '';
        saveFormDraft();
    });
  });

  function renderDynamicSteps(roleKey) {
    const schema = ROLE_SCHEMAS[roleKey];
    dynamicContainer.innerHTML = '';
    
    const steps = [2, 3, 4, 5];
    steps.forEach(stepNum => {
      const section = document.createElement('section');
      section.className = 'form-section';
      section.dataset.section = stepNum;
      
      let stepTitle = '';
      let stepDesc = '';
      if (stepNum === 2) {
        stepTitle = `Step 2: Role Details & Commitment`;
        stepDesc = `Provide specific details about your availability and qualifications for the role.`;
      } else if (stepNum === 3) {
        stepTitle = `Step 3: Background & Motivation`;
        stepDesc = `Tell us why you want to join and what experiences you bring.`;
      } else if (stepNum === 4) {
        stepTitle = `Step 4: Scenarios & Decision-Making`;
        stepDesc = `Describe how you handle specific situations or conflicts.`;
      } else if (stepNum === 5) {
        stepTitle = `Step 5: Agreement & Miscellaneous`;
        stepDesc = `Almost done! Review the guidelines and provide any final details.`;
      }
      
      section.innerHTML = `
        <h2 class="section-title">${stepTitle}</h2>
        <p class="section-description">${stepDesc}</p>
      `;
      
      const stepQuestions = schema.questions.filter(q => q.step === stepNum);
      stepQuestions.forEach((q, idx) => {
        const group = document.createElement('div');
        group.className = 'form-group';
        
        let inputHtml = '';
        if (q.type === 'textarea') {
          inputHtml = `<textarea id="${q.id}" name="${q.id}" rows="3" placeholder="${q.placeholder}" ${q.required ? 'required' : ''}></textarea>`;
        } else if (q.type === 'text') {
          inputHtml = `<input type="text" id="${q.id}" name="${q.id}" placeholder="${q.placeholder}" ${q.required ? 'required' : ''}>`;
        } else if (q.type === 'number') {
          inputHtml = `<input type="number" id="${q.id}" name="${q.id}" placeholder="${q.placeholder}" min="${q.min || ''}" max="${q.max || ''}" ${q.required ? 'required' : ''}>`;
        } else if (q.type === 'select') {
          const optionsHtml = q.options.map(o => `<option value="${o}">${o}</option>`).join('');
          inputHtml = `<select id="${q.id}" name="${q.id}" ${q.required ? 'required' : ''}>${optionsHtml}</select>`;
        } else if (q.type === 'checkbox') {
          inputHtml = `
            <label class="checkbox-container" for="${q.id}">
              <input type="checkbox" id="${q.id}" name="${q.id}" value="Yes, I agree" ${q.required ? 'required' : ''}>
              <span class="checkmark"></span>
              <span class="checkbox-label">${q.checkboxLabel}</span>
            </label>
          `;
        }
        
        const labelHtml = q.type === 'checkbox' 
          ? `<label>Agreement <span class="required">*</span></label>`
          : `<label for="${q.id}">${q.label} ${q.required ? '<span class="required">*</span>' : ''}</label>`;
           
        const helperHtml = q.helperText ? `<small class="helper-text">${q.helperText}</small>` : '';
        const errorMsg = q.type === 'checkbox'
          ? `You must agree to continue.`
          : `Please fill out this field.`;
        
        group.innerHTML = `
          ${labelHtml}
          ${inputHtml}
          <span class="error-msg" id="error-${q.id}">${errorMsg}</span>
          ${helperHtml}
        `;
        section.appendChild(group);
      });
      
      dynamicContainer.appendChild(section);
    });

    // Attach input event listeners to clear invalid classes, count words, and save draft
    dynamicContainer.querySelectorAll('input, textarea, select').forEach(el => {
      el.addEventListener('input', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        if (el.tagName === 'TEXTAREA') {
          updateWordCount(el);
        }
        saveFormDraft();
      });
      el.addEventListener('change', () => {
        el.closest('.form-group')?.classList.remove('invalid');
        saveFormDraft();
      });
    });
  }

  // Live word counter updater
  function updateWordCount(textarea) {
    const counterSpan = document.getElementById(`word-count-${textarea.id}`);
    if (!counterSpan) return;
    const trimmed = textarea.value.trim();
    if (!trimmed) {
      counterSpan.textContent = '0';
      return;
    }
    const words = trimmed.split(/\s+/).filter(w => (w.match(/[a-zA-Z0-9]/g) || []).length >= 2);
    counterSpan.textContent = words.length;
    
    // Optional: give visual cue if min words met
    const wrapper = textarea.nextElementSibling;
    if (wrapper && wrapper.classList.contains('word-counter-wrapper')) {
      if (words.length >= 3) {
        wrapper.classList.add('met');
      } else {
        wrapper.classList.remove('met');
      }
    }
  }

  // Save form draft to localStorage
  function saveFormDraft() {
    const draft = {
      role: selectedRole,
      static: {
        discord_tag: document.getElementById('discord_tag').value.trim(),
        discord_id: document.getElementById('discord_id').value.trim(),
        age: document.getElementById('age').value.trim(),
        timezone: document.getElementById('timezone').value.trim(),
      },
      dynamic: {}
    };

    const schema = ROLE_SCHEMAS[selectedRole];
    if (schema) {
      schema.questions.forEach(q => {
        const el = document.getElementById(q.id);
        if (el) {
          draft.dynamic[q.id] = el.type === 'checkbox' ? el.checked : el.value;
        }
      });
    }
    localStorage.setItem('craftly_application_draft', JSON.stringify(draft));
  }

  // Load draft if it exists
  function loadFormDraft() {
    const raw = localStorage.getItem('craftly_application_draft');
    if (!raw) return;
    try {
      const draft = JSON.parse(raw);
      if (!draft) return;

      // Select role
      if (draft.role && draft.role !== selectedRole) {
        const radio = document.querySelector(`input[name="role"][value="${draft.role}"]`);
        if (radio) {
          radio.checked = true;
          selectedRole = draft.role;
          renderDynamicSteps(selectedRole);
        }
      }

      // Pre-fill static fields
      if (draft.static) {
        if (draft.static.discord_tag) document.getElementById('discord_tag').value = draft.static.discord_tag;
        if (draft.static.discord_id) document.getElementById('discord_id').value = draft.static.discord_id;
        if (draft.static.age) document.getElementById('age').value = draft.static.age;
        if (draft.static.timezone) document.getElementById('timezone').value = draft.static.timezone;
      }

      // Pre-fill dynamic fields
      if (draft.dynamic) {
        Object.keys(draft.dynamic).forEach(id => {
          const el = document.getElementById(id);
          if (el) {
            if (el.type === 'checkbox') {
              el.checked = draft.dynamic[id];
            } else {
              el.value = draft.dynamic[id];
              if (el.tagName === 'TEXTAREA') {
                updateWordCount(el);
              }
            }
          }
        });
      }

      // Show toast notification
      showToast('Draft restored from your last visit!');
    } catch (e) {
      console.error('Failed to load draft', e);
    }
  }

  // Clear form draft
  function clearFormDraft() {
    localStorage.removeItem('craftly_application_draft');
  }

  // Custom toast notifications helper
  function showToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.textContent = message;
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after 4 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function updateNavigation() {
    const currentSections = document.querySelectorAll('.form-section');
    currentSections.forEach(s => s.classList.toggle('active', parseInt(s.dataset.section) === currentStep));
    stepNodes.forEach(n => {
      const step = parseInt(n.dataset.step);
      n.classList.remove('active', 'completed');
      if (step === currentStep) n.classList.add('active');
      else if (step < currentStep) n.classList.add('completed');
    });
    progressBar.style.width = `${((currentStep - 1) / (totalSteps - 1)) * 100}%`;
    prevBtn.classList.toggle('disabled', currentStep === 1);
    prevBtn.disabled = currentStep === 1;
    nextBtn.classList.toggle('hidden', currentStep === totalSteps);
    submitBtn.classList.toggle('hidden', currentStep !== totalSteps);
    document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function validateStep(step) {
    const section = document.querySelector(`.form-section[data-section="${step}"]`);
    if (!section) return true;
    let isValid = true;
    section.querySelectorAll('input, textarea, select').forEach(input => {
      const group = input.closest('.form-group');
      const errorSpan = group?.querySelector('.error-msg');
      let fieldValid = true;
      let errorText = '';

      if (input.hasAttribute('required')) {
        if (input.type === 'checkbox') {
          fieldValid = input.checked;
          errorText = 'You must agree to continue.';
        } else {
          fieldValid = input.value.trim() !== '';
          errorText = 'Please fill out this field.';
        }
      }

      // Extra format / range checks
      if (fieldValid) {
        if (input.id === 'discord_id') {
          fieldValid = /^\d{17,19}$/.test(input.value.trim());
          errorText = 'Please enter a valid Discord User ID (numeric, 17\u201319 characters).';
        } else if (input.id === 'age') {
          const v = parseInt(input.value);
          fieldValid = !isNaN(v) && v >= 13 && v <= 100;
          errorText = 'Please enter a valid age (must be at least 13).';
        } else if (input.id === 'hours_active') {
          const v = parseInt(input.value);
          fieldValid = !isNaN(v) && v >= 1 && v <= 168;
          errorText = 'Please enter a number between 1 and 168.';
        }
      }

      // Placeholder / quality check for text and textarea fields
      if (fieldValid && (input.tagName === 'TEXTAREA' || (input.tagName === 'INPUT' && input.type === 'text'))) {
        const qualityResult = validateAnswerQuality(input.value, input.tagName.toLowerCase());
        if (!qualityResult.valid) {
          fieldValid = false;
          errorText = qualityResult.reason;
        }
      }

      // Apply or clear invalid state
      if (errorSpan) errorSpan.textContent = errorText || 'Please fill out this field.';
      group?.classList.toggle('invalid', !fieldValid);
      if (!fieldValid) isValid = false;
    });

    if (!isValid) {
      // Shake the card on error
      const card = document.querySelector('.form-card');
      card?.classList.add('shake');
      setTimeout(() => card?.classList.remove('shake'), 500);
    }

    return isValid;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateStep(currentStep)) return;

    const schema = ROLE_SCHEMAS[selectedRole];
    const payload = {
      role: selectedRole,
      role_title: schema.title
    };

    // Static fields
    payload.discord_tag = document.getElementById('discord_tag').value.trim();
    payload.discord_id = document.getElementById('discord_id').value.trim();
    payload.age = document.getElementById('age').value.trim();
    payload.timezone = document.getElementById('timezone').value.trim();

    // Dynamic fields
    schema.questions.forEach(q => {
      const el = document.getElementById(q.id);
      if (el) {
        payload[q.id] = el.type === 'checkbox' ? (el.checked ? 'Yes, I agree' : '') : el.value.trim();
      }
    });

    // ─── Anti-Spam Guard ────────────────────────────────────────────
    const spamCheck = checkAntiSpam(payload.discord_id);
    if (!spamCheck.allowed) {
      // Show shake + toast without hiding the form
      const card = document.querySelector('.form-card');
      card?.classList.add('shake');
      setTimeout(() => card?.classList.remove('shake'), 500);
      showToast(`⛔ ${spamCheck.reason}`);
      return;
    }
    // ────────────────────────────────────────────────────────────────

    // Show loading
    form.classList.add('hidden');
    document.querySelector('.progress-container').classList.add('hidden');
    statusCard.classList.remove('hidden');
    statusIconSuccess.classList.add('hidden');
    statusIconError.classList.add('hidden');
    statusTitle.innerText = 'Submitting…';
    statusMessage.innerText = 'Sending your application to Discord. Please wait.';
    statusResetBtn.classList.add('hidden');

    try {
      // Build review URL (for the Approve/Reject links in the embed)
      let reviewBase = 'review.html';
      if (window.location.protocol.startsWith('http')) {
        reviewBase = window.location.origin + window.location.pathname.replace('index.html', '') + 'review.html';
      }
      const jsonStr = JSON.stringify(payload);
      // Do not pre-encode the JSON string here — let URLSearchParams handle encoding.
      // Use a 'c:' prefix when CompressionStream produced a URL-safe base64 token.
      let answersParam = jsonStr;
      if (typeof CompressionStream !== 'undefined') {
        const compressed = await compressPayload(jsonStr);
        if (compressed) {
          answersParam = 'c:' + compressed; // compressed is URL-safe base64
        }
      }

      const encodedTag = payload.discord_tag;
      const tempMsgId = 'TEMP_MSG_ID';

      // Helper to generate absolute review URLs using the URL API. This
      // guarantees valid, fully-qualified URLs for Discord link buttons.
      const makeReviewUrls = (msgId) => {
        // Prefer explicit CONFIG.REVIEW_BASE if provided and absolute
        let baseUrl = (CONFIG.REVIEW_BASE && CONFIG.REVIEW_BASE.startsWith('http')) ? CONFIG.REVIEW_BASE : null;

        // Otherwise prefer the detected reviewBase when running over http/https
        if (!baseUrl) {
          if (reviewBase.startsWith('http')) baseUrl = reviewBase;
          else if (window.location.protocol && window.location.protocol.startsWith('http')) {
            baseUrl = window.location.origin.replace(/\/$/, '') + '/' + reviewBase.replace(/^\//, '');
          }
        }

        // If we couldn't determine an absolute HTTP(S) URL, return nulls so
        // calling code can avoid creating invalid link buttons.
        if (!baseUrl || !baseUrl.startsWith('http')) return { approveUrl: null, rejectUrl: null };

        const build = (action) => {
          const u = new URL(baseUrl);
          u.searchParams.set('action', action);
          u.searchParams.set('tag', encodedTag);
          // Attach answers payload so the static review portal can load the data
          if (typeof answersParam !== 'undefined' && answersParam) u.searchParams.set('answers', answersParam);
          return u.toString();
        };

        return { approveUrl: build('approve'), rejectUrl: build('reject') };
      };

      // Format field helper with truncation
      const formatEmbedValue = (val, maxLen) => {
        const text = val || 'N/A';
        if (text.length <= maxLen) return text;
        return text.substring(0, maxLen) + '… *(truncated — view full in portal)*';
      };

      // Safe value helper — Discord rejects empty-string field values
      const safeVal = (v) => (v !== undefined && v !== null && String(v).trim() !== '') ? String(v).trim() : 'N/A';

      // Submission timestamp (Discord relative)
      const submittedAt = `<t:${Math.floor(Date.now() / 1000)}:F>`;

      const getEmbedJson = (msgId, includeAnswers, maxValLen) => {
        const urls = makeReviewUrls(msgId);

        const fields = [
          { name: '📋 Applied Role',       value: safeVal(schema.title),         inline: true },
          { name: '🏷️ Discord Username',   value: safeVal(payload.discord_tag),  inline: true },
          { name: '🆔 Discord User ID',    value: `\`${safeVal(payload.discord_id)}\``, inline: true },
          { name: '🎂 Age',                value: safeVal(payload.age),          inline: true },
          { name: '🌍 Timezone',           value: safeVal(payload.timezone),     inline: true },
          { name: '⏱️ Hours / Week',       value: payload.hours_active ? `**${payload.hours_active} hrs**` : 'N/A', inline: true },
        ];

        if (payload.media_role) {
          fields.push({ name: '🎨 Specialization', value: payload.media_role, inline: true });
        } else if (payload.dev_role) {
          fields.push({ name: '💻 Developer Role', value: payload.dev_role, inline: true });
        }

        if (payload.portfolio) {
          fields.push({ name: '🔗 Portfolio', value: payload.portfolio, inline: true });
        }
        if (payload.roblox_profile) {
          fields.push({ name: '🎮 Roblox Profile', value: payload.roblox_profile, inline: true });
        }

        fields.push({ name: '\u200b', value: '━━━━━━━━━━━━━━━━━━━━━━', inline: false });

        const profileKeys = ['hours_active', 'media_role', 'dev_role', 'roblox_profile', 'portfolio', 'guidelines_agree'];
        const detailQuestions = schema.questions.filter(q => !profileKeys.includes(q.id));

        // Only include full Q&A detail fields when includeAnswers is true.
        if (includeAnswers) {
          detailQuestions.forEach((q, idx) => {
            fields.push({
              name: `${idx + 1}. ${q.label}`,
              value: formatEmbedValue(payload[q.id], maxValLen),
              inline: false
            });
          });
        }

        return {
          title: `📝 New Application — ${payload.discord_tag}`,
          description:
            `A new **${schema.title}** application was submitted.\n\n` +
            `> 📅 Submitted: ${submittedAt}\n\n` +
            `Use the action buttons below to open the review portal.`,
          color: CONFIG.COLOR_PENDING,
          fields,
          footer: {
            text: `${CONFIG.SERVER_NAME} • Staff Application Portal`,
          },
          timestamp: new Date().toISOString()
        };
      };

      const calculateEmbedLength = (embedObj) => {
        let len = 0;
        if (embedObj.title) len += embedObj.title.length;
        if (embedObj.description) len += embedObj.description.length;
        if (embedObj.footer && embedObj.footer.text) len += embedObj.footer.text.length;
        if (embedObj.author && embedObj.author.name) len += embedObj.author.name.length;
        if (embedObj.fields) {
          for (const field of embedObj.fields) {
            if (field.name) len += field.name.length;
            if (field.value) len += field.value.length;
          }
        }
        return len;
      };

      // Select best fit parameters to keep embed size under 6000 limit
      let chosenParams = null;
      let bestEmbed = null;
      const attemptParams = [
        { includeAnswers: true, maxValLen: 300 },
        { includeAnswers: true, maxValLen: 200 },
        { includeAnswers: false, maxValLen: 300 },
        { includeAnswers: false, maxValLen: 200 },
        { includeAnswers: false, maxValLen: 120 },
        { includeAnswers: false, maxValLen: 80 }
      ];

      for (const params of attemptParams) {
        const embed = getEmbedJson(tempMsgId, params.includeAnswers, params.maxValLen);

        // Estimate final embed size including the portal links text that will
        // be appended later in buildWebhookPayload. If portal links are present
        // they can push the embed over Discord's limit, so include them in the
        // size check.
        let testEmbed = JSON.parse(JSON.stringify(embed));
        // build portal text candidates similar to buildWebhookPayload
        const testUrls = makeReviewUrls(tempMsgId);
        let testCfgApprove = null, testCfgReject = null;
        if (CONFIG.REVIEW_BASE && CONFIG.REVIEW_BASE.startsWith('http')) {
          try {
            const uA = new URL(CONFIG.REVIEW_BASE);
            uA.searchParams.set('action', 'approve');
            uA.searchParams.set('tag', encodeURIComponent(payload.discord_tag));
            if (typeof answersParam !== 'undefined' && answersParam) uA.searchParams.set('answers', answersParam);
            testCfgApprove = uA.toString();
            const uR = new URL(CONFIG.REVIEW_BASE);
            uR.searchParams.set('action', 'reject');
            uR.searchParams.set('tag', encodeURIComponent(payload.discord_tag));
            if (typeof answersParam !== 'undefined' && answersParam) uR.searchParams.set('answers', answersParam);
            testCfgReject = uR.toString();
          } catch (e) {
            testCfgApprove = testCfgReject = null;
          }
        }

        const testPortalText = (testCfgApprove && testCfgReject)
          ? `\n\nOpen review portal:\n• [🟢 Approve](${testCfgApprove})\n• [🔴 Reject](${testCfgReject})`
          : (testUrls.approveUrl && testUrls.rejectUrl)
            ? `\n\nOpen review portal:\n• [🟢 Approve](${testUrls.approveUrl})\n• [🔴 Reject](${testUrls.rejectUrl})`
            : '\n\nOpen the review portal on the server where this app is hosted.';

        testEmbed.description = (testEmbed.description || '') + testPortalText;

        const embedLen = calculateEmbedLength(testEmbed);
        if (embedLen <= 5800) {
          bestEmbed = embed;
          chosenParams = params;
          console.log(`Chose embed with includeAnswers=${params.includeAnswers}, maxValLen=${params.maxValLen} (length: ${embedLen})`);
          break;
        }
      }

      if (!chosenParams) {
        chosenParams = { includeAnswers: false, maxValLen: 50 };
        bestEmbed = getEmbedJson(tempMsgId, chosenParams.includeAnswers, chosenParams.maxValLen);
      }

      const buildWebhookPayload = (msgId) => {
        const urls = makeReviewUrls(msgId);
        // Also build explicit links from configured REVIEW_BASE when available
        let cfgApprove = null, cfgReject = null;
        if (CONFIG.REVIEW_BASE && CONFIG.REVIEW_BASE.startsWith('http')) {
          try {
            const uA = new URL(CONFIG.REVIEW_BASE);
            uA.searchParams.set('action', 'approve');
            uA.searchParams.set('tag', encodeURIComponent(payload.discord_tag));
            if (typeof answersParam !== 'undefined' && answersParam) uA.searchParams.set('answers', answersParam);
            cfgApprove = uA.toString();
            const uR = new URL(CONFIG.REVIEW_BASE);
            uR.searchParams.set('action', 'reject');
            uR.searchParams.set('tag', encodeURIComponent(payload.discord_tag));
            if (typeof answersParam !== 'undefined' && answersParam) uR.searchParams.set('answers', answersParam);
            cfgReject = uR.toString();
            console.log('Built REVIEW_BASE portal URLs:', cfgApprove, cfgReject);
          } catch (e) {
            cfgApprove = cfgReject = null;
          }
        }
        const body = {
          username: CONFIG.WEBHOOK_USERNAME,
          embeds: [getEmbedJson(msgId, chosenParams.includeAnswers, chosenParams.maxValLen)]
        };

        // Final safety: if the selected embed still exceeds Discord's limit,
        // replace with a minimal embed containing only essential info and
        // the portal links. This guarantees the webhook will not be rejected
        // due to embed size.
        try {
          const finalLen = calculateEmbedLength(body.embeds[0]);
          if (finalLen > 5800) {
            console.warn('Selected embed too large (', finalLen, '). Falling back to minimal embed.');
            const minimalEmbed = {
              title: `📝 New Application — ${payload.discord_tag}`,
              description: `A new **${schema.title}** application was submitted.\n\n` +
                `• Discord Username: **${payload.discord_tag}**\n` +
                `• Discord ID: \`${payload.discord_id || 'N/A'}\`\n`,
              color: CONFIG.COLOR_PENDING,
              fields: [],
              timestamp: new Date().toISOString(),
              footer: { text: `${CONFIG.SERVER_NAME} • Staff Application Portal` }
            };

            // Attach portal links into description
            const portalLinks = (cfgApprove && cfgReject)
              ? `\nOpen review portal:\n• [🟢 Approve](${cfgApprove})\n• [🔴 Reject](${cfgReject})`
              : (urls.approveUrl && urls.rejectUrl)
                ? `\nOpen review portal:\n• [🟢 Approve](${urls.approveUrl})\n• [🔴 Reject](${urls.rejectUrl})`
                : '\nOpen the review portal on the server where this app is hosted.';

            minimalEmbed.description = (minimalEmbed.description || '') + portalLinks;
            body.embeds[0] = minimalEmbed;
          }
        } catch (e) {
          console.warn('Failed to evaluate embed length for final safeguard', e);
        }

        // NOTE: Link-style components have proven unreliable in this environment
        // (Discord may strip or reject them). Use markdown portal links in the
        // embed description which are guaranteed to render and be clickable.
        const fallbackEmbed = body.embeds[0];
        const portalText = (cfgApprove && cfgReject)
          ? `\n\nOpen review portal:\n• [🟢 Approve](${cfgApprove})\n• [🔴 Reject](${cfgReject})`
          : (urls.approveUrl && urls.rejectUrl)
            ? `\n\nOpen review portal:\n• [🟢 Approve](${urls.approveUrl})\n• [🔴 Reject](${urls.rejectUrl})`
            : '\n\nOpen the review portal on the server where this app is hosted.';
        fallbackEmbed.description = (fallbackEmbed.description || '') + portalText;

        if (CONFIG.WEBHOOK_AVATAR) body.avatar_url = CONFIG.WEBHOOK_AVATAR;
        return body;
      };

      // 1. Build the post URL (with optional thread_id)
      let postUrl = CONFIG.WEBHOOK_URL + '?wait=true';
      if (CONFIG.THREAD_ID) postUrl += `&thread_id=${CONFIG.THREAD_ID}`;

      // 2. If a bot endpoint is configured, POST to it to let the bot send
      // a native interaction-enabled message. Otherwise fall back to webhook.
      let resp = null;
      const initialPayload = buildWebhookPayload(tempMsgId);
      // Debug: log the payload and endpoints so we can inspect what is sent to Discord
      try {
        console.log('Initial webhook payload (preview):', initialPayload);
      } catch (e) {
        console.warn('Failed to serialize initialPayload for logging', e);
      }
      if (CONFIG.BOT_ENDPOINT && CONFIG.BOT_ENDPOINT.startsWith('http')) {
        try {
          resp = await fetch(CONFIG.BOT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: initialPayload.embeds[0].title,
              description: initialPayload.embeds[0].description,
              fields: initialPayload.embeds[0].fields,
              footerText: initialPayload.embeds[0].footer?.text,
              color: initialPayload.embeds[0].color
            })
          });
          console.log('Posted to BOT_ENDPOINT:', CONFIG.BOT_ENDPOINT, 'status=', resp.status);
        } catch (e) {
          resp = null;
        }
      }

      if (!resp) {
        // fallback to webhook
        const webhookPostUrl = CONFIG.WEBHOOK_URL + '?wait=true';
        if (CONFIG.THREAD_ID) webhookPostUrl += `&thread_id=${CONFIG.THREAD_ID}`;
        console.log('Posting webhook to:', webhookPostUrl);
        try {
          resp = await sendWithRetry(webhookPostUrl, initialPayload, 'POST');
          console.log('Received response status from Discord:', resp && resp.status);
          try {
            const respText = resp ? await resp.clone().text() : null;
            console.log('Discord response body:', respText);
          } catch (e) {
            console.warn('Could not read Discord response body', e);
          }
        } catch (e) {
          console.error('Failed to POST webhook:', e);
          resp = null;
        }
      }

      if (resp && (resp.ok || resp.status === 204)) {
        // Success — single POST delivered the message. No PATCH needed.
        recordSubmission(); // anti-spam: log this submission
        clearFormDraft();

        statusTitle.innerText = '✅ Application Submitted!';
        statusMessage.innerText = 'Your application was sent to the staff review channel successfully. You will be notified on Discord once a decision is made. Thank you for applying!';
        statusIconSuccess.classList.remove('hidden');
      } else {
        const errText = resp ? await resp.text() : 'No response';
        const statusCode = resp ? resp.status : 0;
        throw new Error(`Discord returned ${statusCode}: ${errText}`);
      }
    } catch (error) {
      statusTitle.innerText = 'Submission Failed';
      statusMessage.innerText = error.message || 'Could not send your application. Please check your connection and try again.';
      statusIconError.classList.remove('hidden');
      statusResetBtn.classList.remove('hidden');
    }
  });

  statusResetBtn.addEventListener('click', () => {
    statusCard.classList.add('hidden');
    document.querySelector('.progress-container').classList.remove('hidden');
    form.classList.remove('hidden');
    currentStep = 1;
    updateNavigation();
  });

  // Timezone Auto-detection
  function autofillTimezone() {
    const timezoneInput = document.getElementById('timezone');
    if (timezoneInput && !timezoneInput.value) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const now = new Date();
        const offsetMinutes = -now.getTimezoneOffset();
        const offsetHours = Math.floor(Math.abs(offsetMinutes) / 60);
        const offsetRemainingMinutes = Math.abs(offsetMinutes) % 60;
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const offsetStr = `GMT${sign}${offsetHours}${offsetRemainingMinutes ? ':' + String(offsetRemainingMinutes).padStart(2, '0') : ''}`;
        
        timezoneInput.value = `${offsetStr} (${tz})`;
        saveFormDraft();
      } catch (e) {
        console.warn('Failed to auto-detect timezone', e);
      }
    }
  }

  // Discord ID Input Sanitization / Extraction
  const discordIdInput = document.getElementById('discord_id');
  if (discordIdInput) {
    discordIdInput.addEventListener('blur', () => {
      const raw = discordIdInput.value.trim();
      const matched = raw.match(/\d{17,19}/);
      if (matched) {
        discordIdInput.value = matched[0];
        saveFormDraft();
      }
    });
    discordIdInput.addEventListener('input', () => {
      const raw = discordIdInput.value.trim();
      // If user pasted a full tag/mention like <@123456789012345678>
      if (raw.includes('<@') && raw.includes('>')) {
        const matched = raw.match(/\d{17,19}/);
        if (matched) {
          discordIdInput.value = matched[0];
          saveFormDraft();
        }
      }
    });
  }

  // Discord ID Help Toggle
  const helpBtn = document.getElementById('discord-id-helper-btn');
  const helpBox = document.getElementById('discord-id-helper-box');
  if (helpBtn && helpBox) {
    helpBtn.addEventListener('click', (e) => {
      e.preventDefault();
      helpBox.classList.toggle('hidden');
      helpBtn.classList.toggle('active');
    });
  }

  // Keyboard Shortcuts (Enter for next, Ctrl + Enter for textarea next)
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (e.target.tagName === 'TEXTAREA') {
        if (e.ctrlKey) {
          e.preventDefault();
          if (currentStep === totalSteps) {
            form.requestSubmit();
          } else {
            nextBtn.click();
          }
        }
      } else {
        e.preventDefault();
        if (currentStep === totalSteps) {
          form.requestSubmit();
        } else {
          nextBtn.click();
        }
      }
    }
  });

  // Run timezone auto-detection on load
  autofillTimezone();

  // --- Theme Dropdown Menu Control ---
  const themeToggleBtn = document.getElementById('theme-toggle');
  const themeMenu = document.getElementById('theme-dropdown-menu');
  const themeOptions = document.querySelectorAll('.theme-option');

  if (themeToggleBtn && themeMenu) {
    // Load saved theme
    const savedTheme = localStorage.getItem('craftly-theme') || 'dark';
    applyTheme(savedTheme);

    // Toggle menu dropdown
    themeToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = themeToggleBtn.getAttribute('aria-expanded') === 'true';
      themeToggleBtn.setAttribute('aria-expanded', !isExpanded);
      themeMenu.classList.toggle('hidden');
    });

    // Select theme option
    themeOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        const selected = opt.getAttribute('data-theme');
        applyTheme(selected);
        localStorage.setItem('craftly-theme', selected);
        
        // Close menu
        themeToggleBtn.setAttribute('aria-expanded', 'false');
        themeMenu.classList.add('hidden');
        showToast(`Theme switched to ${selected.toUpperCase()} mode!`);
      });
    });

    // Click outside to close
    document.addEventListener('click', (e) => {
      if (!themeToggleBtn.contains(e.target) && !themeMenu.contains(e.target)) {
        themeToggleBtn.setAttribute('aria-expanded', 'false');
        themeMenu.classList.add('hidden');
      }
    });

    function applyTheme(themeName) {
      document.body.classList.remove('light-mode', 'cyber-mode', 'forest-mode');
      if (themeName !== 'dark') {
        document.body.classList.add(`${themeName}-mode`);
      }
      // Update active list classes
      themeOptions.forEach(opt => {
        const isMatched = opt.getAttribute('data-theme') === themeName;
        opt.classList.toggle('active', isMatched);
      });
    }
  }

  // --- Interactive Particle Background ---
  const canvas = document.getElementById('particle-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    let particlesArray = [];
    let mouse = { x: null, y: null, radius: 100 };

    window.addEventListener('mousemove', (e) => {
      mouse.x = e.x;
      mouse.y = e.y;
    });

    window.addEventListener('mouseout', () => {
      mouse.x = null;
      mouse.y = null;
    });

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 2 + 1;
        this.speedX = Math.random() * 0.6 - 0.3;
        this.speedY = Math.random() * 0.6 - 0.3;
      }
      update() {
        this.x += this.speedX;
        this.y += this.speedY;

        // Wrap around borders
        if (this.x > canvas.width) this.x = 0;
        else if (this.x < 0) this.x = canvas.width;
        if (this.y > canvas.height) this.y = 0;
        else if (this.y < 0) this.y = canvas.height;

        // Mouse attraction/repulsion
        if (mouse.x != null && mouse.y != null) {
          let dx = mouse.x - this.x;
          let dy = mouse.y - this.y;
          let distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < mouse.radius) {
            const force = (mouse.radius - distance) / mouse.radius;
            this.x -= dx / distance * force * 1.5;
            this.y -= dy / distance * force * 1.5;
          }
        }
      }
      draw() {
        const isLight = document.body.classList.contains('light-mode');
        const isCyber = document.body.classList.contains('cyber-mode');
        const isForest = document.body.classList.contains('forest-mode');
        if (isCyber) {
          ctx.fillStyle = 'rgba(0, 240, 255, 0.25)';
        } else if (isForest) {
          ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
        } else {
          ctx.fillStyle = isLight ? 'rgba(88, 101, 242, 0.22)' : 'rgba(255, 255, 255, 0.15)';
        }
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function initParticles() {
      particlesArray = [];
      const numberOfParticles = Math.floor((canvas.width * canvas.height) / 15000);
      for (let i = 0; i < numberOfParticles; i++) {
        particlesArray.push(new Particle());
      }
    }
    initParticles();
    window.addEventListener('resize', initParticles);

    function connectParticles() {
      const maxDistance = 110;
      for (let a = 0; a < particlesArray.length; a++) {
        for (let b = a; b < particlesArray.length; b++) {
          let dx = particlesArray[a].x - particlesArray[b].x;
          let dy = particlesArray[a].y - particlesArray[b].y;
          let distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < maxDistance) {
            let alpha = (1 - (distance / maxDistance)) * 0.12;
            const isLight = document.body.classList.contains('light-mode');
            const isCyber = document.body.classList.contains('cyber-mode');
            const isForest = document.body.classList.contains('forest-mode');
            if (isCyber) {
              ctx.strokeStyle = `rgba(255, 0, 127, ${alpha * 1.5})`;
            } else if (isForest) {
              ctx.strokeStyle = `rgba(16, 185, 129, ${alpha})`;
            } else {
              ctx.strokeStyle = isLight 
                ? `rgba(88, 101, 242, ${alpha})` 
                : `rgba(255, 255, 255, ${alpha})`;
            }
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(particlesArray[a].x, particlesArray[a].y);
            ctx.lineTo(particlesArray[b].x, particlesArray[b].y);
            ctx.stroke();
          }
        }
      }
    }

    function animate() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < particlesArray.length; i++) {
        particlesArray[i].update();
        particlesArray[i].draw();
      }
      connectParticles();
      requestAnimationFrame(animate);
    }
    animate();
  }
});
