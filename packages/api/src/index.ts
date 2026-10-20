import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { zValidator } from '@hono/zod-validator'; // Hono-native validation hook [cite: 123]
import { z } from 'zod';
import { sign, verify } from 'hono/jwt';

// Admin Discord IDs (Add your Discord ID here)
const ADMIN_DISCORD_IDS = [
  '106968215380336640', // Onizuka
  '322476176931160074' // @api
];

// Admin GitHub IDs (Add your GitHub ID here)
const ADMIN_GITHUB_IDS = [
  '1349314', // Onizuka
  '257034056' // @api
];


// 1. Map out your Cloudflare infrastructural environment bindings [cite: 112]
type Bindings = {
  DB: D1Database;
  STORAGE_BUCKET: R2Bucket;
  DISCORD_CLIENT_ID: string;
  DISCORD_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  GITHUB_BUILDER_PAT: string;
  JWT_SECRET: string;
  HUB_CALLBACK_TOKEN: string;
  PLUGINS_CDN_URL: string;
  FRONTEND_URL?: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Helper for authenticated GitHub API calls using GITHUB_BUILDER_PAT
async function githubFetch(url: string, env: Bindings, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set('User-Agent', 'CamelKit-Hub');
  headers.set('Accept', 'application/vnd.github.v3+json');
  if (env.GITHUB_BUILDER_PAT) {
    headers.set('Authorization', `Bearer ${env.GITHUB_BUILDER_PAT}`);
  }
  return fetch(url, {
    ...init,
    headers,
  });
}

// 2. Enable safe communication routes for your Astro front-end
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      const frontendUrl = c.env.FRONTEND_URL || '';
      const cleanHost = frontendUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

      if (!origin) return frontendUrl || 'http://localhost:4321';
      try {
        const originUrl = new URL(origin);
        const host = originUrl.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1') {
          return origin;
        }
        if (
          host === 'memoriesofmagic.com' ||
          host.endsWith('.memoriesofmagic.com') ||
          host === 'memoriesofmagic.wiki' ||
          host.endsWith('.memoriesofmagic.wiki') ||
          host === 'evilquest.net' ||
          host.endsWith('.evilquest.net')
        ) {
          return origin;
        }
        if (cleanHost) {
          const targetHost = cleanHost.toLowerCase();
          if (host === targetHost || host.endsWith(`.${targetHost}`)) {
            return origin;
          }
        }
      } catch {
        // Fall through on malformed origin
      }
      return frontendUrl || 'http://localhost:4321';
    },
    credentials: true,
  });
  return corsMiddleware(c, next);
});

// 3. Setup your Zod Validation Contracts [cite: 123, 127]
const submitPluginSchema = z.object({
  githubUrl: z.string().url().regex(/^https:\/\/github\.com\/[\w-]+\/[\w-]+$/),
});

// 4. Custom Admin Gatekeeper Middleware
const adminGate = () => async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: "Access Denied: Please log in to continue." }, 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    if (!payload.isAdmin) {
      return c.json({ error: "Access Denied: Admin privileges required." }, 403);
    }
    c.set('jwtPayload', payload);
  } catch (err) {
    return c.json({ error: "Access Denied: Invalid or expired token." }, 401);
  }

  // Proceed securely to the protected administrative endpoint handler if valid
  await next();
};

// 5. Custom GitHub Developer Gatekeeper Middleware
const githubDeveloperGate = () => async (c: any, next: any) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: "Access Denied: Please log in to continue." }, 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256');
    if (!payload.github_id) {
      return c.json({ error: "Access Denied: A linked GitHub account is required." }, 403);
    }
    c.set('jwtPayload', payload);
  } catch (err) {
    return c.json({ error: "Access Denied: Invalid or expired token." }, 401);
  }

  await next();
};

/* --- API Endpoints --- */

// --- Auth Endpoints ---

app.get('/api/auth/discord/login', async (c) => {
  const url = new URL(c.req.url);
  const redirectBase = url.origin.replace('127.0.0.1', 'localhost');
  const existingToken = c.req.query('token');
  const redirectUri = encodeURIComponent(`${redirectBase}/api/auth/discord/callback`);
  
  let linkUserId: string | null = null;
  if (existingToken) {
    try {
      const payload = await verify(existingToken, c.env.JWT_SECRET, 'HS256');
      if (payload?.id) {
        linkUserId = payload.id as string;
      }
    } catch { }
  }

  // Create an HMAC-signed state nonce expiring in 10 minutes
  const state = await sign({
    type: 'oauth_state',
    provider: 'discord',
    linkUserId,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 600,
  }, c.env.JWT_SECRET, 'HS256');

  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${c.env.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify&state=${encodeURIComponent(state)}`;
  return c.redirect(discordAuthUrl);
});

app.get('/api/auth/discord/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.text('No code provided', 400);
  }

  const state = c.req.query('state');
  let linkedUserId: number | null = null;
  if (!state) {
    return c.text('Missing OAuth state parameter', 400);
  }
  try {
    const statePayload = await verify(state, c.env.JWT_SECRET, 'HS256');
    if (statePayload.type === 'oauth_state' && statePayload.provider === 'discord') {
      if (statePayload.linkUserId) {
        linkedUserId = parseInt(statePayload.linkUserId as string);
      }
    } else if (statePayload.id) {
      linkedUserId = parseInt(statePayload.id as string);
    } else {
      return c.text('Invalid OAuth state parameter', 400);
    }
  } catch (err) {
    return c.text('Invalid or expired OAuth state parameter', 400);
  }

  const url = new URL(c.req.url);
  const redirectBase = url.origin.replace('127.0.0.1', 'localhost');
  const redirectUri = `${redirectBase}/api/auth/discord/callback`;

  // Exchange code for token
  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenResponse.ok) {
    return c.text('Failed to exchange token', 400);
  }

  const tokenData = await tokenResponse.json() as any;

  // Get user info
  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });

  if (!userResponse.ok) {
    return c.text('Failed to fetch user info', 400);
  }

  const userData = await userResponse.json() as any;
  const discordId = userData.id;
  const discordUsername = userData.username;

  let user = await c.env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discordId).first() as any;

  if (user) {
    if (linkedUserId && user.id !== linkedUserId) {
      return c.text('This Discord account is already linked to another user account.', 409);
    }
    await c.env.DB.prepare("UPDATE users SET discord_username = ? WHERE id = ?").bind(discordUsername, user.id).run();
    user.discord_username = discordUsername;
  } else {
    if (linkedUserId) {
      // Preserve existing primary username when linking secondary provider
      await c.env.DB.prepare(
        "UPDATE users SET discord_id = ?, discord_username = ?, username = COALESCE(username, ?) WHERE id = ?"
      ).bind(discordId, discordUsername, discordUsername, linkedUserId).run();
      user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(linkedUserId).first() as any;
    } else {
      user = await c.env.DB.prepare(
        "INSERT INTO users (discord_id, discord_username, username) VALUES (?, ?, ?) RETURNING *"
      ).bind(discordId, discordUsername, discordUsername).first() as any;
    }
  }

  const isAdmin = ADMIN_DISCORD_IDS.includes(user.discord_id) || ADMIN_GITHUB_IDS.includes(user.github_id);

  // Generate JWT
  const jwt = await sign({
    id: user.id.toString(),
    username: user.username,
    github_username: user.github_username || (user.github_id ? user.username : null),
    discord_username: user.discord_username || (user.discord_id ? user.username : null),
    discord_id: user.discord_id,
    github_id: user.github_id,
    camel_coins: user.camel_coins || 0,
    isAdmin,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 1 week
  }, c.env.JWT_SECRET, 'HS256');

  // Redirect to frontend
  const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:4321';
  return c.redirect(`${frontendUrl}/auth-callback?token=${jwt}`);
});

app.get('/api/auth/github/login', async (c) => {
  const url = new URL(c.req.url);
  const redirectBase = url.origin.replace('127.0.0.1', 'localhost');
  const existingToken = c.req.query('token');
  const redirectUri = encodeURIComponent(`${redirectBase}/api/auth/github/callback`);
  
  let linkUserId: string | null = null;
  if (existingToken) {
    try {
      const payload = await verify(existingToken, c.env.JWT_SECRET, 'HS256');
      if (payload?.id) {
        linkUserId = payload.id as string;
      }
    } catch { }
  }

  const state = await sign({
    type: 'oauth_state',
    provider: 'github',
    linkUserId,
    nonce: crypto.randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 600,
  }, c.env.JWT_SECRET, 'HS256');

  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${c.env.GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=read:user&state=${encodeURIComponent(state)}`;
  return c.redirect(githubAuthUrl);
});

app.get('/api/auth/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.text('No code provided', 400);
  }

  const state = c.req.query('state');
  let linkedUserId: number | null = null;
  if (!state) {
    return c.text('Missing OAuth state parameter', 400);
  }
  try {
    const statePayload = await verify(state, c.env.JWT_SECRET, 'HS256');
    if (statePayload.type === 'oauth_state' && statePayload.provider === 'github') {
      if (statePayload.linkUserId) {
        linkedUserId = parseInt(statePayload.linkUserId as string);
      }
    } else if (statePayload.id) {
      linkedUserId = parseInt(statePayload.id as string);
    } else {
      return c.text('Invalid OAuth state parameter', 400);
    }
  } catch (err) {
    return c.text('Invalid or expired OAuth state parameter', 400);
  }

  // Exchange code for token
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code
    }),
  });

  if (!tokenResponse.ok) {
    return c.text('Failed to exchange token', 400);
  }

  const tokenData = await tokenResponse.json() as any;

  // Get user info
  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${tokenData.access_token}`,
      'User-Agent': 'CamelKit-Hub',
      'Accept': 'application/vnd.github.v3+json'
    },
  });

  if (!userResponse.ok) {
    return c.text('Failed to fetch user info', 400);
  }

  const userData = await userResponse.json() as any;
  const githubId = userData.id.toString();
  const githubUsername = userData.login;

  let user = await c.env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(githubId).first() as any;

  if (user) {
    if (linkedUserId && user.id !== linkedUserId) {
      return c.text('This GitHub account is already linked to another user account.', 409);
    }
    await c.env.DB.prepare("UPDATE users SET github_username = ? WHERE id = ?").bind(githubUsername, user.id).run();
    user.github_username = githubUsername;
  } else {
    if (linkedUserId) {
      // Preserve existing primary username when linking secondary provider
      await c.env.DB.prepare(
        "UPDATE users SET github_id = ?, github_username = ?, username = COALESCE(username, ?) WHERE id = ?"
      ).bind(githubId, githubUsername, githubUsername, linkedUserId).run();
      user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(linkedUserId).first() as any;
    } else {
      user = await c.env.DB.prepare(
        "INSERT INTO users (github_id, github_username, username) VALUES (?, ?, ?) RETURNING *"
      ).bind(githubId, githubUsername, githubUsername).first() as any;
    }
  }

  // Migrate any existing plugins to this user ID if they were submitted prior to unified accounts
  await c.env.DB.prepare("UPDATE plugins SET user_id = ? WHERE submitter_github_id = ? AND user_id IS NULL").bind(user.id, githubId).run();

  const isAdmin = ADMIN_DISCORD_IDS.includes(user.discord_id) || ADMIN_GITHUB_IDS.includes(user.github_id);

  // Generate JWT
  const jwt = await sign({
    id: user.id.toString(),
    username: user.username,
    github_username: user.github_username || (user.github_id ? user.username : null),
    discord_username: user.discord_username || (user.discord_id ? user.username : null),
    discord_id: user.discord_id,
    github_id: user.github_id,
    camel_coins: user.camel_coins || 0,
    isAdmin,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7, // 1 week
  }, c.env.JWT_SECRET, 'HS256');

  // Redirect to frontend
  const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:4321';
  return c.redirect(`${frontendUrl}/auth-callback?token=${jwt}`);
});

// --- Public Endpoints ---

// Public manifest tracking endpoint for the Electron Client and public web elements [cite: 93, 117]
const manifestHandler = async (c: any) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, name, description, author, current_version as version, download_url as url, download_url, github_url, latest_commit_hash, asset_sha FROM plugins WHERE status = 'published' OR (status IN ('building', 'failed') AND asset_sha IS NOT NULL)"
    ).all();
    return c.json(results || []);
  } catch (err: any) {
    console.error('[Manifest] Failed to query manifest:', err);
    return c.json({ error: "Failed to fetch plugins manifest.", details: err?.message }, 500);
  }
};

app.get('/manifest.json', manifestHandler);
app.get('/api/plugins/manifest.json', manifestHandler);
app.get('/api/plugins', manifestHandler);

// Public plugin repository submission route protected by fast edge Zod parsing [cite: 123, 133]
app.post('/api/plugins/submit', githubDeveloperGate(), zValidator('json', submitPluginSchema), async (c) => {
  const { githubUrl } = c.req.valid('json'); // Data is guaranteed verified [cite: 123]
  const jwtPayload = c.get('jwtPayload') as any;

  // Extract owner and repo from URL
  const match = githubUrl.match(/^https:\/\/github\.com\/([\w-]+)\/([\w-]+)$/);
  if (!match) {
    return c.json({ error: "Invalid GitHub URL format." }, 400);
  }
  const [_, owner, repo] = match;

  // Verify personal repository ownership using github_username (fallback to username)
  const allowedGithubUser = (jwtPayload.github_username || jwtPayload.username || '').toLowerCase();
  if (owner.toLowerCase() !== allowedGithubUser) {
    return c.json({ error: "You can only submit plugins from your personal GitHub account." }, 403);
  }

  // Fetch repository metadata and latest commit hash from GitHub API (authenticated)
  let name = repo;
  let description = '';
  let author = owner;
  let latestCommitHash = "unknown";

  try {
    const ghRes = await githubFetch(`https://api.github.com/repos/${owner}/${repo}`, c.env);
    if (ghRes.ok) {
      const ghData = await ghRes.json() as any;
      name = ghData.name || repo;
      description = ghData.description || '';
      author = ghData.owner?.login || owner;
    }
  } catch (err) {
    console.error("Failed to fetch from GitHub API", err);
    // Proceed with default values if GitHub API fails
  }

  try {
    const commitRes = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, c.env);
    if (commitRes.ok) {
      const commits = await commitRes.json() as any[];
      if (commits && commits.length > 0) {
        latestCommitHash = commits[0].sha;
      }
    }
  } catch (err) {
    console.error("Failed to fetch latest commit hash from GitHub API", err);
  }

  // Insert into D1 Database with pinned commit hash
  try {
    await c.env.DB.prepare(
      "INSERT INTO plugins (github_url, name, description, author, download_url, user_id, submitter_github_id, latest_commit_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(githubUrl, name, description, author, githubUrl, parseInt(jwtPayload.id), jwtPayload.github_id, latestCommitHash).run();
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ error: "This plugin has already been submitted." }, 409);
    }
    console.error(err);
    return c.json({ error: "Failed to insert into database." }, 500);
  }

  return c.json({ success: true, message: "Added to queue." }, 202);
});

// Admin Queue View Endpoint protected by identity checkpoint middleware
app.get('/api/admin/queue', adminGate(), async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM plugins WHERE status = 'pending'").all();
  return c.json(results);
});

// Admin Approve Endpoint
app.post('/api/admin/plugins/:id/approve', adminGate(), async (c) => {
  const id = c.req.param('id');
  const jwtPayload = c.get('jwtPayload') as any;
  try {
    const plugin = await c.env.DB.prepare("SELECT * FROM plugins WHERE id = ?").bind(id).first() as any;
    if (!plugin) {
      return c.json({ error: "Plugin not found." }, 404);
    }

    const match = plugin.github_url.match(/^https:\/\/github\.com\/([\w-]+)\/([\w-]+)$/);
    if (!match) {
      return c.json({ error: "Invalid GitHub URL format." }, 400);
    }
    const [_, owner, repo] = match;

    // Resolve commit hash: use already pinned commit or fetch latest
    let commit_hash = plugin.latest_commit_hash && plugin.latest_commit_hash !== 'unknown' ? plugin.latest_commit_hash : null;
    if (!commit_hash) {
      try {
        const latestCommitRes = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, c.env);
        if (latestCommitRes.ok) {
          const commits = await latestCommitRes.json() as any[];
          if (commits && commits.length > 0 && commits[0].sha) commit_hash = commits[0].sha;
        }
      } catch (e) {
        console.error("Failed to fetch commit hash", e);
      }
    }

    if (!commit_hash) {
      return c.json({ error: "Failed to resolve commit hash from GitHub repository." }, 502);
    }

    // Trigger GitHub Actions workflow via repository dispatch
    const isLocalDev = new URL(c.req.url).hostname === 'localhost' || new URL(c.req.url).hostname === '127.0.0.1';
    
    if (isLocalDev) {
      console.log("Mocking GitHub Action dispatch in local development mode.");
      const mockWebhook = async () => {
        await new Promise(r => setTimeout(r, 5000));
        await fetch(`${new URL(c.req.url).origin}/api/plugins/callback`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${c.env.HUB_CALLBACK_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ plugin_id: id, commit_hash: commit_hash, status: 'published', version: '1.0.0', asset_sha: 'sha256:localdevmock' })
        });
      };
      c.executionCtx.waitUntil(mockWebhook());
    } else {
      const dispatchRes = await githubFetch(`https://api.github.com/repos/CamelKit/Plugin-Builder/dispatches`, c.env, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'build_plugin',
          client_payload: {
            plugin_id: id,
            plugin_name: plugin.name,
            author: plugin.author,
            github_url: plugin.github_url,
            approved_by: jwtPayload.username,
            commit_hash: commit_hash
          }
        })
      });

      if (!dispatchRes.ok) {
          const errorText = await dispatchRes.text();
          console.error("Failed to dispatch GitHub Action:", errorText);
          return c.json({ error: "Failed to trigger plugin build workflow." }, 500);
      }
    }

    await c.env.DB.prepare("UPDATE plugins SET status = 'approved', latest_commit_hash = COALESCE(?, latest_commit_hash) WHERE id = ?").bind(commit_hash, id).run();
    return c.json({ success: true, message: "Plugin approved and build triggered." });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Failed to approve plugin." }, 500);
  }
});

// Admin Reject Endpoint
app.post('/api/admin/plugins/:id/reject', adminGate(), async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare("UPDATE plugins SET status = 'rejected' WHERE id = ?").bind(id).run();
    return c.json({ success: true, message: "Plugin rejected." });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Failed to reject plugin." }, 500);
  }
});



// Webhook for GitHub Actions to report successful build
app.post('/api/plugins/callback', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.HUB_CALLBACK_TOKEN}`) {
    return c.json({ error: "Access Denied." }, 401);
  }

  const body = await c.req.json();
  const { plugin_id, commit_hash, status, version, asset_sha } = body;

  if (status === 'published') {
    // Setting download URL to point to production R2 Bucket
    // The base URL is configured in wrangler.jsonc via PLUGINS_CDN_URL
    const downloadUrl = `${c.env.PLUGINS_CDN_URL.replace(/\/$/, '')}/${plugin_id}/plugin.js`; 
    const currentVersion = version || body.current_version || null;
    const assetSha = asset_sha || null;

    await c.env.DB.prepare(
      "UPDATE plugins SET status = 'published', download_url = ?, latest_commit_hash = ?, current_version = COALESCE(?, current_version), asset_sha = COALESCE(?, asset_sha) WHERE id = ? AND status IN ('approved', 'building', 'published', 'failed')"
    ).bind(downloadUrl, commit_hash, currentVersion, assetSha, plugin_id).run();
  } else if (status === 'building' || status === 'failed') {
    await c.env.DB.prepare(
      "UPDATE plugins SET status = ? WHERE id = ? AND status IN ('approved', 'building', 'published', 'failed')"
    ).bind(status, plugin_id).run();
  }

  return c.json({ success: true });
});

// --- Developer Dashboard Endpoints ---
app.get('/api/developer/plugins', githubDeveloperGate(), async (c) => {
  const jwtPayload = c.get('jwtPayload') as any;
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM plugins WHERE user_id = ?"
  ).bind(parseInt(jwtPayload.id)).all();

  // Fetch remote commit hash for each published/approved plugin to check for updates
  const enrichedResults = await Promise.all(results.map(async (plugin: any) => {
    if (plugin.status === 'approved' || plugin.status === 'published') {
      const match = plugin.github_url?.match(/^https:\/\/github\.com\/([\w-]+)\/([\w-]+)$/);
      if (match) {
        const [_, owner, repo] = match;
        try {
          const ghRes = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, c.env);
          if (ghRes.ok) {
            const commits = await ghRes.json() as any[];
            if (commits && commits.length > 0) {
              plugin.remote_commit_hash = commits[0].sha;
            }
          }
        } catch (e) {
          console.error("Failed to fetch remote commits", e);
        }
      }
    }
    return plugin;
  }));

  return c.json(enrichedResults);
});

app.post('/api/developer/plugins/:id/update', githubDeveloperGate(), async (c) => {
  const id = c.req.param('id');
  const jwtPayload = c.get('jwtPayload') as any;

  // Fetch plugin to verify ownership and get repo details
  const plugin = await c.env.DB.prepare(
    "SELECT * FROM plugins WHERE id = ? AND user_id = ?"
  ).bind(id, parseInt(jwtPayload.id)).first() as any;

  if (!plugin) {
    return c.json({ error: "Plugin not found or unauthorized." }, 404);
  }

  // Admin approval gate: developers can only trigger updates on approved, published, or failed plugins
  if (!['approved', 'published', 'failed'].includes(plugin.status)) {
    return c.json({ error: `Cannot trigger a build while plugin status is '${plugin.status}'.` }, 403);
  }

  const match = plugin.github_url.match(/^https:\/\/github\.com\/([\w-]+)\/([\w-]+)$/);
  if (!match) {
    return c.json({ error: "Invalid GitHub URL." }, 400);
  }
  const [_, owner, repo] = match;

  try {
    const ghRes = await githubFetch(`https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`, c.env);

    if (!ghRes.ok) {
      return c.json({ error: "Failed to fetch commits from GitHub." }, 502);
    }

    const commits = await ghRes.json() as any[];
    if (!commits || commits.length === 0 || !commits[0].sha) {
      return c.json({ error: "No commits found in GitHub repository." }, 404);
    }

    const latestCommitHash = commits[0].sha;

    // Trigger GitHub Actions workflow via repository dispatch
    const isLocalDev = new URL(c.req.url).hostname === 'localhost' || new URL(c.req.url).hostname === '127.0.0.1';
    
    if (isLocalDev) {
      console.log("Mocking GitHub Action dispatch in local development mode.");
      const mockWebhook = async () => {
        await new Promise(r => setTimeout(r, 5000));
        await fetch(`${new URL(c.req.url).origin}/api/plugins/callback`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${c.env.HUB_CALLBACK_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ plugin_id: id, commit_hash: latestCommitHash, status: 'published', version: '1.0.0', asset_sha: 'sha256:localdevmock' })
        });
      };
      c.executionCtx.waitUntil(mockWebhook());
    } else {
      const dispatchRes = await githubFetch(`https://api.github.com/repos/CamelKit/Plugin-Builder/dispatches`, c.env, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'build_plugin',
          client_payload: {
            plugin_id: id,
            plugin_name: plugin.name,
            author: plugin.author,
            github_url: plugin.github_url,
            approved_by: jwtPayload.github_username || jwtPayload.username, // Developer syncing their own commit
            commit_hash: latestCommitHash
          }
        })
      });

      if (!dispatchRes.ok) {
          const errorText = await dispatchRes.text();
          console.error("Failed to dispatch GitHub Action:", errorText);
          return c.json({ error: "Failed to trigger plugin build workflow." }, 500);
      }
    }

    await c.env.DB.prepare(
      "UPDATE plugins SET status = 'building' WHERE id = ?"
    ).bind(id).run();

    return c.json({ success: true, message: "Plugin updated and build triggered.", hash: latestCommitHash });
  } catch (err) {
    console.error(err);
    return c.json({ error: "Failed to update plugin." }, 500);
  }
});

// Dev Only Seed Endpoint
app.post('/api/dev/seed', async (c) => {
  const isLocalDev = new URL(c.req.url).hostname === 'localhost' || new URL(c.req.url).hostname === '127.0.0.1';
  if (!isLocalDev) {
      return c.json({ error: "Only available in local development." }, 403);
  }
  
  const user = await c.env.DB.prepare("SELECT * FROM users LIMIT 1").first() as any;
  if (!user) {
      return c.json({ error: "No user found in DB. Please login via frontend first." }, 400);
  }
  
  await c.env.DB.prepare(`
      INSERT INTO plugins (github_url, name, description, author, download_url, user_id, status, latest_commit_hash) VALUES
      ('https://github.com/fake/pending-plugin', 'Fake Pending Plugin', 'A plugin waiting for approval', 'fakeuser', 'https://github.com/fake/pending-plugin', ?, 'pending', '1111111'),
      ('https://github.com/fake/approved-plugin', 'Fake Approved Plugin', 'A plugin approved but not built', 'fakeuser', 'https://github.com/fake/approved-plugin', ?, 'approved', '2222222'),
      ('https://github.com/fake/published-plugin', 'Fake Published Plugin', 'A fully published plugin', 'fakeuser', 'http://localhost/plugins/fake/plugin.js', ?, 'published', '3333333'),
      ('https://github.com/fake/rejected-plugin', 'Fake Rejected Plugin', 'A plugin that was rejected', 'fakeuser', 'https://github.com/fake/rejected-plugin', ?, 'rejected', '4444444')
  `).bind(user.id, user.id, user.id, user.id).run();
  
  return c.json({ success: true, message: "Seeded 4 fake plugins into your account." });
});

// --- Crowdsourced Drop Telemetry & Wiki Aggregation Endpoints ---

const dropItemSchema = z.object({
  itemId: z.number().int().positive(),
  itemName: z.string().max(100).optional(),
  quantity: z.number().int().positive().max(1000000),
});

const dropEventSchema = z.object({
  npcDefId: z.number().int().positive(),
  npcName: z.string().min(1).max(100),
  combatLevel: z.number().int().nonnegative().optional().default(0),
  drops: z.array(dropItemSchema).max(50),
  timestamp: z.number().int().optional(),
});

const telemetryBatchSchema = z.object({
  client: z.string().max(50).optional(),
  version: z.string().max(20).optional(),
  events: z.array(dropEventSchema).min(1).max(100),
});

async function computeReporterHash(c: any): Promise<string> {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '127.0.0.1';
  const salt = c.env.JWT_SECRET || 'camelkit-telemetry-salt';
  const msgUint8 = new TextEncoder().encode(`${ip}:${salt}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const dropTelemetryHandler = async (c: any) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON payload' }, 400);
  }

  const parseResult = telemetryBatchSchema.safeParse(body);
  if (!parseResult.success) {
    return c.json({ error: 'Validation failed', details: parseResult.error.format() }, 400);
  }

  const { events } = parseResult.data;
  const reporterHash = await computeReporterHash(c);

  // In-memory aggregation across the batch to minimize SQL operations
  const killAggregates = new Map<number, { npcName: string; combatLevel: number; count: number }>();
  const dropAggregates = new Map<string, { npcDefId: number; itemId: number; itemName?: string; totalDrops: number; totalQty: number; minQty: number; maxQty: number }>();

  for (const event of events) {
    const { npcDefId, npcName, combatLevel = 0, drops } = event;
    const existingKill = killAggregates.get(npcDefId);
    if (existingKill) {
      existingKill.count += 1;
      if (combatLevel > 0) existingKill.combatLevel = combatLevel;
    } else {
      killAggregates.set(npcDefId, { npcName, combatLevel, count: 1 });
    }

    for (const drop of drops) {
      const dropKey = `${npcDefId}:${drop.itemId}`;
      const existingDrop = dropAggregates.get(dropKey);
      if (existingDrop) {
        existingDrop.totalDrops += 1;
        existingDrop.totalQty += drop.quantity;
        existingDrop.minQty = Math.min(existingDrop.minQty, drop.quantity);
        existingDrop.maxQty = Math.max(existingDrop.maxQty, drop.quantity);
        if (drop.itemName && !existingDrop.itemName) existingDrop.itemName = drop.itemName;
      } else {
        dropAggregates.set(dropKey, {
          npcDefId,
          itemId: drop.itemId,
          itemName: drop.itemName || '',
          totalDrops: 1,
          totalQty: drop.quantity,
          minQty: drop.quantity,
          maxQty: drop.quantity,
        });
      }
    }
  }

  const statements: any[] = [];

  // 1. Upsert kill totals (denominator)
  for (const [npcDefId, kill] of killAggregates.entries()) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO npc_kill_totals (npc_def_id, npc_name, combat_level, total_kills, last_killed_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(npc_def_id) DO UPDATE SET
          total_kills = total_kills + excluded.total_kills,
          last_killed_at = CURRENT_TIMESTAMP,
          npc_name = excluded.npc_name,
          combat_level = CASE WHEN excluded.combat_level > 0 THEN excluded.combat_level ELSE npc_kill_totals.combat_level END
      `).bind(npcDefId, kill.npcName, kill.combatLevel, kill.count)
    );
  }

  // 2. Upsert drop details and track unique reporters (numerator + anti-cheat consensus)
  for (const drop of dropAggregates.values()) {
    statements.push(
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO drop_reporters (reporter_hash, npc_def_id, item_id, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(reporterHash, drop.npcDefId, drop.itemId)
    );

    statements.push(
      c.env.DB.prepare(`
        INSERT INTO npc_drop_totals (
          npc_def_id, item_id, item_name, total_drops, total_quantity, min_quantity, max_quantity, unique_reporters, status, last_dropped_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'unconfirmed', CURRENT_TIMESTAMP)
        ON CONFLICT(npc_def_id, item_id) DO UPDATE SET
          item_name = COALESCE(excluded.item_name, npc_drop_totals.item_name),
          total_drops = total_drops + excluded.total_drops,
          total_quantity = total_quantity + excluded.total_quantity,
          min_quantity = MIN(min_quantity, excluded.min_quantity),
          max_quantity = MAX(max_quantity, excluded.max_quantity),
          last_dropped_at = CURRENT_TIMESTAMP
      `).bind(drop.npcDefId, drop.itemId, drop.itemName || null, drop.totalDrops, drop.totalQty, drop.minQty, drop.maxQty)
    );

    statements.push(
      c.env.DB.prepare(`
        UPDATE npc_drop_totals
        SET unique_reporters = (
          SELECT COUNT(DISTINCT reporter_hash) FROM drop_reporters WHERE npc_def_id = ? AND item_id = ?
        ),
        status = CASE 
          WHEN (SELECT COUNT(DISTINCT reporter_hash) FROM drop_reporters WHERE npc_def_id = ? AND item_id = ?) >= 3 
          THEN 'confirmed' 
          ELSE 'unconfirmed' 
        END
        WHERE npc_def_id = ? AND item_id = ?
      `).bind(drop.npcDefId, drop.itemId, drop.npcDefId, drop.itemId, drop.npcDefId, drop.itemId)
    );
  }

  try {
    if (statements.length > 0) {
      await c.env.DB.batch(statements);
    }
    return c.json({
      success: true,
      processedEvents: events.length,
      killsRecorded: events.length,
    });
  } catch (err: any) {
    console.error('Failed to commit telemetry batch:', err);
    return c.json({ error: 'Database execution failed', details: err?.message }, 500);
  }
};

const wikiDropsHandler = async (c: any) => {
  const showAll = c.req.query('all') === 'true' || c.req.query('all') === '1';
  const npcNameParam = c.req.query('npc_name') || c.req.query('name');
  const npcDefIdParam = c.req.query('npc_def_id');
  const itemIdParam = c.req.query('item_id');
  const minKillsParam = c.req.query('min_kills');

  const minKills = minKillsParam ? parseInt(minKillsParam, 10) || 0 : 0;
  const npcDefId = npcDefIdParam ? parseInt(npcDefIdParam, 10) : null;
  const itemId = itemIdParam ? parseInt(itemIdParam, 10) : null;

  let query = `
    SELECT 
      k.npc_def_id,
      k.npc_name,
      k.combat_level,
      k.total_kills,
      d.item_id,
      d.item_name,
      d.total_drops,
      d.total_quantity,
      d.min_quantity,
      d.max_quantity,
      d.unique_reporters,
      d.status,
      d.last_dropped_at
    FROM npc_drop_totals d
    JOIN npc_kill_totals k ON d.npc_def_id = k.npc_def_id
    WHERE 1=1
  `;
  const binds: any[] = [];

  if (!showAll) {
    query += ` AND d.status = 'confirmed'`;
  }
  if (npcNameParam && npcNameParam.trim()) {
    query += ` AND LOWER(k.npc_name) = LOWER(?)`;
    binds.push(npcNameParam.trim());
  }
  if (npcDefId !== null && !isNaN(npcDefId)) {
    query += ` AND d.npc_def_id = ?`;
    binds.push(npcDefId);
  }
  if (itemId !== null && !isNaN(itemId)) {
    query += ` AND d.item_id = ?`;
    binds.push(itemId);
  }
  if (minKills > 0) {
    query += ` AND k.total_kills >= ?`;
    binds.push(minKills);
  }

  query += ` ORDER BY k.npc_name ASC, d.total_drops DESC`;

  try {
    let npcMeta: any = null;
    if (npcNameParam || npcDefIdParam) {
      let metaQuery = "SELECT npc_def_id, npc_name, combat_level, total_kills, last_killed_at FROM npc_kill_totals WHERE ";
      metaQuery += npcNameParam ? "LOWER(npc_name) = LOWER(?)" : "npc_def_id = ?";
      const metaStmt = c.env.DB.prepare(metaQuery);
      npcMeta = await (npcNameParam ? metaStmt.bind(npcNameParam.trim()) : metaStmt.bind(npcDefId)).first();
    }

    const stmt = c.env.DB.prepare(query);
    const { results } = binds.length > 0 ? await stmt.bind(...binds).all() : await stmt.all();

    const formattedDrops = (results || []).map((row: any) => {
      const totalKills = Number(row.total_kills) || 1;
      const totalDrops = Number(row.total_drops) || 0;
      const dropRate = totalKills > 0 ? totalDrops / totalKills : 0;
      const ratePct = Number((dropRate * 100).toFixed(4));

      let fraction = 'Unknown';
      if (dropRate > 0) {
        const inv = 1 / dropRate;
        fraction = inv >= 1.05 ? `1/${Math.round(inv)}` : `1/${inv.toFixed(1)}`;
      }

      return {
        npc_def_id: row.npc_def_id,
        npc_name: row.npc_name,
        combat_level: row.combat_level,
        total_kills: row.total_kills,
        item_id: row.item_id,
        item_name: row.item_name || `Item #${row.item_id}`,
        total_drops: row.total_drops,
        total_quantity: row.total_quantity,
        min_quantity: row.min_quantity,
        max_quantity: row.max_quantity,
        quantity_range:
          row.min_quantity === row.max_quantity
            ? `${row.min_quantity}`
            : `${row.min_quantity}-${row.max_quantity}`,
        unique_reporters: row.unique_reporters,
        status: row.status,
        drop_rate: dropRate,
        drop_rate_pct: ratePct,
        formatted_rate: fraction,
        last_dropped_at: row.last_dropped_at,
      };
    });

    return c.json({
      success: true,
      npc: npcMeta,
      total_kills: npcMeta?.total_kills ?? formattedDrops[0]?.total_kills ?? 0,
      count: formattedDrops.length,
      drops: formattedDrops,
    });
  } catch (err: any) {
    console.error('Failed to query wiki drops:', err);
    return c.json({ error: 'Failed to query wiki drops', details: err?.message }, 500);
  }
};

const wikiNpcKillsHandler = async (c: any) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT npc_def_id, npc_name, combat_level, total_kills, last_killed_at FROM npc_kill_totals ORDER BY total_kills DESC'
    ).all();

    return c.json({
      success: true,
      count: results?.length || 0,
      npcs: results || [],
    });
  } catch (err: any) {
    console.error('Failed to query NPC kill counts:', err);
    return c.json({ error: 'Failed to query NPC kills', details: err?.message }, 500);
  }
};

app.post('/telemetry/drops', dropTelemetryHandler);
app.post('/api/telemetry/drops', dropTelemetryHandler);
app.get('/wiki/drops', wikiDropsHandler);
app.get('/api/wiki/drops', wikiDropsHandler);
app.get('/wiki/npc-kills', wikiNpcKillsHandler);
app.get('/api/wiki/npc-kills', wikiNpcKillsHandler);

// Export the type definition so your Svelte forms gain automatic compile-time RPC type-safety! [cite: 114, 116]
export type AppType = typeof app;
export default app;