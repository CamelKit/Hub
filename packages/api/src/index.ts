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
  STORAGE_BUCKET_STAGING: R2Bucket;
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

// 2. Enable safe communication routes for your Astro front-end
app.use('*', async (c, next) => {
  const corsMiddleware = cors({
    origin: (origin) => {
      const frontendUrl = c.env.FRONTEND_URL || '';
      const cleanHost = frontendUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');

      if (!origin) return frontendUrl || 'http://localhost:4321';
      if (origin.includes('localhost') || (cleanHost && origin.includes(cleanHost))) {
        return origin;
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
  let stateParam = '';
  if (existingToken) {
    stateParam = `&state=${existingToken}`;
  }
  const discordAuthUrl = `https://discord.com/api/oauth2/authorize?client_id=${c.env.DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=identify${stateParam}`;
  return c.redirect(discordAuthUrl);
});

app.get('/api/auth/discord/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.text('No code provided', 400);
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
  const username = userData.username;

  const state = c.req.query('state');
  let linkedUserId: number | null = null;
  if (state) {
    try {
      const statePayload = await verify(state, c.env.JWT_SECRET, 'HS256');
      linkedUserId = parseInt(statePayload.id as string);
    } catch (err) { }
  }

  let user = await c.env.DB.prepare("SELECT * FROM users WHERE discord_id = ?").bind(discordId).first() as any;

  if (!user) {
    if (linkedUserId) {
      await c.env.DB.prepare("UPDATE users SET discord_id = ?, username = ? WHERE id = ?").bind(discordId, username, linkedUserId).run();
      user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(linkedUserId).first() as any;
    } else {
      user = await c.env.DB.prepare("INSERT INTO users (discord_id, username) VALUES (?, ?) RETURNING *").bind(discordId, username).first() as any;
    }
  }

  const isAdmin = ADMIN_DISCORD_IDS.includes(user.discord_id) || ADMIN_GITHUB_IDS.includes(user.github_id);

  // Generate JWT
  const jwt = await sign({
    id: user.id.toString(),
    username: user.username,
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
  let stateParam = '';
  if (existingToken) {
    stateParam = `&state=${existingToken}`;
  }
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${c.env.GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=read:user${stateParam}`;
  return c.redirect(githubAuthUrl);
});

app.get('/api/auth/github/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) {
    return c.text('No code provided', 400);
  }

  const url = new URL(c.req.url);

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
  const username = userData.login;

  const state = c.req.query('state');
  let linkedUserId: number | null = null;
  if (state) {
    try {
      const statePayload = await verify(state, c.env.JWT_SECRET, 'HS256');
      linkedUserId = parseInt(statePayload.id as string);
    } catch (err) { }
  }

  let user = await c.env.DB.prepare("SELECT * FROM users WHERE github_id = ?").bind(githubId).first() as any;

  if (!user) {
    if (linkedUserId) {
      await c.env.DB.prepare("UPDATE users SET github_id = ?, username = ? WHERE id = ?").bind(githubId, username, linkedUserId).run();
      user = await c.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(linkedUserId).first() as any;
    } else {
      user = await c.env.DB.prepare("INSERT INTO users (github_id, username) VALUES (?, ?) RETURNING *").bind(githubId, username).first() as any;
    }
  }

  // Migrate any existing plugins to this user ID if they were submitted prior to unified accounts
  await c.env.DB.prepare("UPDATE plugins SET user_id = ? WHERE submitter_github_id = ? AND user_id IS NULL").bind(user.id, githubId).run();

  const isAdmin = ADMIN_DISCORD_IDS.includes(user.discord_id) || ADMIN_GITHUB_IDS.includes(user.github_id);

  // Generate JWT
  const jwt = await sign({
    id: user.id.toString(),
    username: user.username,
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
app.get('/manifest.json', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, description, author, current_version as version, download_url as url, github_url FROM plugins WHERE status = 'published'"
  ).all();
  return c.json(results);
});

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

  // Verify personal repository ownership
  if (owner.toLowerCase() !== jwtPayload.username.toLowerCase()) {
    return c.json({ error: "You can only submit plugins from your personal GitHub account." }, 403);
  }

  // Fetch from GitHub API
  let name = repo;
  let description = '';
  let author = owner;

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'User-Agent': 'CamelKit-Hub',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

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

  // Insert into D1 Database
  try {
    await c.env.DB.prepare(
      "INSERT INTO plugins (github_url, name, description, author, download_url, user_id, submitter_github_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).bind(githubUrl, name, description, author, githubUrl, parseInt(jwtPayload.id), jwtPayload.github_id).run();
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

    // Fetch the repository zipball
    const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;
    const zipRes = await fetch(zipUrl, {
      headers: {
        'User-Agent': 'CamelKit-Hub',
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    if (!zipRes.ok) {
      return c.json({ error: "Failed to download plugin source from GitHub." }, 500);
    }

    const zipBuffer = await zipRes.arrayBuffer();
    const objectKey = `sources/${id}-${repo}.zip`;

    // Upload to R2 Staging
    await c.env.STORAGE_BUCKET_STAGING.put(objectKey, zipBuffer);

    // Fetch latest commit hash
    let commit_hash = "unknown";
    try {
      const latestCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits`, {
        headers: {
          'User-Agent': 'CamelKit-Hub',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (latestCommitRes.ok) {
        const commits = await latestCommitRes.json() as any[];
        if (commits.length > 0) commit_hash = commits[0].sha;
      }
    } catch (e) { console.error("Failed to fetch commit hash", e); }

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
            body: JSON.stringify({ plugin_id: id, commit_hash: commit_hash, status: 'published' })
        });
      };
      c.executionCtx.waitUntil(mockWebhook());
    } else {
      const dispatchRes = await fetch(`https://api.github.com/repos/CamelC0re/Plugin-Builder/dispatches`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${c.env.GITHUB_BUILDER_PAT}`,
          'User-Agent': 'CamelKit-Hub',
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
            commit_hash: commit_hash,
            source_zip_url: `${new URL(c.req.url).origin}/api/internal/download-source?key=${encodeURIComponent(objectKey)}`
          }
        })
      });

      if (!dispatchRes.ok) {
          const errorText = await dispatchRes.text();
          console.error("Failed to dispatch GitHub Action:", errorText);
          return c.json({ error: "Failed to trigger plugin build workflow." }, 500);
      }
    }

    await c.env.DB.prepare("UPDATE plugins SET status = 'approved' WHERE id = ?").bind(id).run();
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

// Internal Endpoint for GitHub Actions to securely download the source zip
app.get('/api/internal/download-source', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.HUB_CALLBACK_TOKEN}`) {
    return c.json({ error: "Access Denied." }, 401);
  }

  const r2Key = c.req.query('key');
  if (!r2Key) return c.json({ error: "Missing key." }, 400);

  const object = await c.env.STORAGE_BUCKET_STAGING.get(r2Key);

  if (object === null) {
    return c.json({ error: "Source zip not found." }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers as any);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Type', 'application/zip');

  return new Response(object.body, { headers });
});

// Webhook for GitHub Actions to report successful build
app.post('/api/plugins/callback', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || authHeader !== `Bearer ${c.env.HUB_CALLBACK_TOKEN}`) {
    return c.json({ error: "Access Denied." }, 401);
  }

  const body = await c.req.json();
  const { plugin_id, commit_hash, status } = body;

  if (status === 'published') {
    // Setting download URL to point to production R2 Bucket
    // The base URL is configured in wrangler.jsonc via PLUGINS_CDN_URL
    const downloadUrl = `${c.env.PLUGINS_CDN_URL.replace(/\/$/, '')}/${plugin_id}/plugin.js`; 
    await c.env.DB.prepare(
      "UPDATE plugins SET status = 'published', download_url = ?, latest_commit_hash = ? WHERE id = ?"
    ).bind(downloadUrl, commit_hash, plugin_id).run();
  } else if (status === 'building' || status === 'failed') {
    await c.env.DB.prepare(
      "UPDATE plugins SET status = ? WHERE id = ?"
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
          const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits`, {
            headers: {
              'User-Agent': 'CamelKit-Hub',
              'Accept': 'application/vnd.github.v3+json',
              'Authorization': `Bearer ${c.env.GITHUB_BUILDER_PAT}`
            }
          });
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

  const match = plugin.github_url.match(/^https:\/\/github\.com\/([\w-]+)\/([\w-]+)$/);
  if (!match) {
    return c.json({ error: "Invalid GitHub URL." }, 400);
  }
  const [_, owner, repo] = match;

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/commits`, {
      headers: {
        'User-Agent': 'CamelKit-Hub',
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!ghRes.ok) {
      return c.json({ error: "Failed to fetch commits from GitHub." }, 500);
    }

    const commits = await ghRes.json() as any[];
    if (!commits || commits.length === 0) {
      return c.json({ error: "No commits found." }, 404);
    }

    const latestCommitHash = commits[0].sha;

    // Fetch the repository zipball
    const zipUrl = `https://api.github.com/repos/${owner}/${repo}/zipball`;
    const zipRes = await fetch(zipUrl, {
      headers: {
        'User-Agent': 'CamelKit-Hub',
        'Accept': 'application/vnd.github.v3+json',
      }
    });

    if (!zipRes.ok) {
      return c.json({ error: "Failed to download plugin source from GitHub." }, 500);
    }

    const zipBuffer = await zipRes.arrayBuffer();
    const objectKey = `sources/${id}-${repo}.zip`;

    // Upload to R2 Staging
    await c.env.STORAGE_BUCKET_STAGING.put(objectKey, zipBuffer);

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
            body: JSON.stringify({ plugin_id: id, commit_hash: latestCommitHash, status: 'published' })
        });
      };
      c.executionCtx.waitUntil(mockWebhook());
    } else {
      const dispatchRes = await fetch(`https://api.github.com/repos/CamelC0re/Plugin-Builder/dispatches`, {
        method: 'POST',
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'Authorization': `Bearer ${c.env.GITHUB_BUILDER_PAT}`,
          'User-Agent': 'CamelKit-Hub',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          event_type: 'build_plugin',
          client_payload: {
            plugin_id: id,
            plugin_name: plugin.name,
            author: plugin.author,
            github_url: plugin.github_url,
            approved_by: jwtPayload.username, // Developer syncing their own commit
            commit_hash: latestCommitHash,
            source_zip_url: `${new URL(c.req.url).origin}/api/internal/download-source?key=${encodeURIComponent(objectKey)}`
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
      "UPDATE plugins SET latest_commit_hash = ?, status = 'building' WHERE id = ?"
    ).bind(latestCommitHash, id).run();

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

// Export the type definition so your Svelte forms gain automatic compile-time RPC type-safety! [cite: 114, 116]
export type AppType = typeof app;
export default app;