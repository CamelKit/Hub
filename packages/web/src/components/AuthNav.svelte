<script>
    import { API_URL } from '../config';

    let token = '';
    let discordId = null;
    let githubId = null;
    let username = '';
    let camelCoins = 0;

    // Bypass the onMount quirk and initialize immediately on the client
    if (typeof window !== 'undefined') {
        token = localStorage.getItem('camelkit_token') || localStorage.getItem('camelcore_token') || '';
        if (token) {
            try {
                const payloadBase64 = token.split('.')[1];
                const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
                const payload = JSON.parse(atob(base64));
                discordId = payload.discord_id;
                githubId = payload.github_id;
                username = payload.username;
                camelCoins = payload.camel_coins || 0;
            } catch (e) {
                console.error('Failed to parse token');
                token = ''; // Clear invalid token
            }
        }
    }

    function logout() {
        localStorage.removeItem('camelkit_token');
        localStorage.removeItem('camelcore_token');
        window.location.reload();
    }
</script>

<div class="auth-section">
    {#if !token}
        <a id="discord-login-btn" href="{API_URL}/api/auth/discord/login" class="login-btn">Login via Discord</a>
        <a id="github-login-btn" href="{API_URL}/api/auth/github/login" class="login-btn github-btn">Login via GitHub</a>
    {:else}
        <div class="currency-display">
            <img src="/CamelCoin32.png" alt="Camel Coins" class="coin-icon" />
            <span class="coin-amount">{camelCoins}</span>
        </div>
        <span class="user-info">
            Welcome, <strong>{username}</strong>!
        </span>
        
        <div class="link-actions">
            {#if !discordId}
                <a href="{API_URL}/api/auth/discord/login?token={token}" class="link-btn discord">Link Discord</a>
            {/if}
            {#if !githubId}
                <a href="{API_URL}/api/auth/github/login?token={token}" class="link-btn github">Link GitHub</a>
            {/if}
        </div>
        
        <button id="logout-btn" class="logout-btn" on:click={logout}>Logout</button>
    {/if}
</div>

<style>
    .auth-section {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    .currency-display {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        background: rgba(0, 0, 0, 0.3);
        padding: 0.2rem 0.5rem;
        border-radius: var(--radius-md);
        border: 1px solid #2b2b2b;
    }

    .coin-icon {
        width: 24px;
        height: 24px;
    }

    .coin-amount {
        color: #f1c40f;
        font-weight: bold;
        font-family: monospace;
        font-size: 1.1rem;
    }

    .user-info {
        color: var(--color-text);
        font-size: 0.95rem;
    }

    .user-info strong {
        color: var(--color-primary);
    }

    .link-actions {
        display: flex;
        gap: 0.5rem;
    }

    .link-btn {
        padding: 0.4rem 0.8rem;
        font-size: 0.8rem;
        font-weight: bold;
        text-transform: uppercase;
        border-radius: var(--radius-sm);
        text-decoration: none;
        transition: all 0.2s;
    }

    .link-btn.discord {
        background: #5865F2;
        color: white;
    }

    .link-btn.discord:hover {
        background: #4752C4;
    }

    .link-btn.github {
        background: #24292e;
        color: white;
        border: 1px solid #444;
    }

    .link-btn.github:hover {
        background: #1b1f23;
    }
</style>
