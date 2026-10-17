<script>
    import SubmitPlugin from './SubmitPlugin.svelte';
    import { addToast } from '../stores/toast.js';

    let plugins = [];
    let loading = true;
    let error = '';
    let token = '';

    // Initialize immediately (safe because of client:only="svelte")
    try {
        token = localStorage.getItem('camelkit_token') || localStorage.getItem('camelcore_token') || '';
    } catch (e) {
        token = '';
    }

    if (!token) {
        error = 'You must be logged in to view this page.';
        loading = false;
    } else {
        fetchPlugins();
    }

    async function fetchPlugins() {
        loading = true;
        error = '';
        try {
            // Safe decoding of JWT
            const payloadBase64 = token.split('.')[1];
            if (payloadBase64) {
                // Convert base64url to base64 to prevent atob from throwing
                const base64 = payloadBase64.replace(/-/g, '+').replace(/_/g, '/');
                const payload = JSON.parse(atob(base64));
                if (!payload.github_id) {
                    error = 'Access Denied: A linked GitHub account is required to view this page.';
                    loading = false;
                    return;
                }
            }

            const API_URL = import.meta.env.DEV ? 'http://localhost:8787' : import.meta.env.PUBLIC_API_URL;
            const res = await fetch(`${API_URL}/api/developer/plugins`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await res.json();

            if (res.ok) {
                // Ensure plugins is an array
                plugins = Array.isArray(data) ? data : (data.results || []);
            } else {
                error = data.error || 'Failed to fetch your plugins.';
            }
        } catch (err) {
            error = 'An error occurred while fetching your plugins. ' + err.message;
            console.error(err);
        } finally {
            loading = false;
        }
    }

    async function updatePlugin(id) {
        try {
            const API_URL = import.meta.env.DEV ? 'http://localhost:8787' : import.meta.env.PUBLIC_API_URL;
            const res = await fetch(`${API_URL}/api/developer/plugins/${id}/update`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            const data = await res.json();

            if (res.ok) {
                plugins = plugins.map(p => p.id === id ? { ...p, latest_commit_hash: data.hash } : p);
                addToast('Plugin updated successfully to commit: ' + data.hash, 'success');
            } else {
                addToast('Failed to update plugin: ' + data.error, 'error');
            }
        } catch (err) {
            addToast('An error occurred while updating the plugin.', 'error');
            console.error(err);
        }
    }

    async function seedDevData() {
        try {
            const API_URL = import.meta.env.DEV ? 'http://localhost:8787' : import.meta.env.PUBLIC_API_URL;
            const res = await fetch(`${API_URL}/api/dev/seed`, {
                method: 'POST'
            });
            const data = await res.json();
            if (res.ok) {
                addToast(data.message, 'success');
                fetchPlugins();
            } else {
                addToast(data.error || 'Failed to seed plugins.', 'error');
            }
        } catch (err) {
            addToast('A network error occurred while seeding.', 'error');
        }
    }
</script>

<div class="developer-dashboard">
    <h2>Submit New Plugin</h2>
    <div class="submit-section panel inset">
        <SubmitPlugin on:submitted={fetchPlugins} />
    </div>

    {#if import.meta.env.DEV}
        <div style="text-align: center; margin-bottom: 2rem; width: 100%;">
            <button class="action-btn" style="width: auto; padding: 0.75rem 2rem; border-color: #f39c12; color: #f39c12;" on:click={seedDevData}>
                Seed Dummy Plugins (Dev Only)
            </button>
        </div>
    {/if}

    <h2>Your Plugins</h2>

    {#if loading}
        <div class="loading">Loading your plugins...</div>
    {:else if error}
        <div class="error">{error}</div>
    {:else if !Array.isArray(plugins) || plugins.length === 0}
        <div class="empty">
            You haven't submitted any plugins yet.
        </div>
    {:else}
        <div class="plugin-list">
            {#each plugins as plugin}
                <div class="plugin-card {plugin?.status || 'pending'}">
                    <h3>{plugin?.name || 'Unknown Plugin'}</h3>
                    <p class="description">{plugin?.description || 'No description provided.'}</p>
                    <div class="meta">
                        <span class="status status-badge">Status: <strong>{(plugin?.status || 'pending').toUpperCase()}</strong></span>
                        <span class="hash">Latest Commit: <strong>{plugin?.latest_commit_hash ? plugin.latest_commit_hash.substring(0,7) : 'None'}</strong></span>
                    </div>
                    <div class="actions">
                        {#if (plugin?.status || 'pending') === 'approved' || (plugin?.status || 'pending') === 'published'}
                            {#if plugin.remote_commit_hash && plugin.remote_commit_hash !== plugin.latest_commit_hash}
                                <button class="action-btn" on:click={() => updatePlugin(plugin.id)}>
                                    Sync Latest Commit
                                </button>
                            {:else}
                                <button class="action-btn" disabled style="opacity: 0.5; cursor: not-allowed; border-color: #555;">
                                    Up to Date
                                </button>
                            {/if}
                        {:else if (plugin?.status || 'pending') === 'pending'}
                            <span class="pending-msg">Pending Admin Review</span>
                        {:else if (plugin?.status || 'pending') === 'rejected'}
                            <span class="rejected-msg">Plugin Rejected</span>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>

<style>
    .developer-dashboard {
        max-width: 1000px;
        margin: 0 auto;
        padding: 0 2rem 2rem 2rem;
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    h2 {
        color: #d8372b;
        text-transform: uppercase;
        letter-spacing: 2px;
        margin-bottom: 1.5rem;
        text-shadow: 0 0 10px rgba(216, 55, 43, 0.3);
        text-align: center;
        width: 100%;
    }

    .error {
        color: #ff4d4d;
        background: rgba(255, 77, 77, 0.1);
        padding: 1rem;
        border: 1px solid #ff4d4d;
        border-radius: 4px;
        width: 100%;
        text-align: center;
        max-width: 600px;
    }

    .loading, .empty {
        text-align: center;
        padding: 2rem;
        color: #ccc;
        width: 100%;
    }

    .submit-section {
        margin-bottom: 4rem;
        padding: 2rem;
        width: 100%;
        max-width: 600px;
        box-sizing: border-box;
    }

    .plugin-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 2rem;
        width: 100%;
    }

    .plugin-card {
        background: #0f0f0f;
        border: 2px solid #2b2b2b;
        border-radius: 4px;
        padding: 1.5rem;
        box-shadow: inset 0 1px 0 0 #2a2a2a, 0 4px 6px rgba(0, 0, 0, 0.4);
        display: flex;
        flex-direction: column;
        transition: transform 0.2s, border-color 0.2s;
    }

    .plugin-card:hover {
        transform: translateY(-2px);
        border-color: #d8372b;
    }

    .plugin-card h3 {
        margin: 0 0 0.25rem 0;
        color: #d8372b;
        font-size: 1.25rem;
    }

    .description {
        margin: 0 0 1.5rem 0;
        font-size: 0.95rem;
        line-height: 1.4;
        color: #ccc;
        flex-grow: 1;
    }

    .meta {
        display: flex;
        flex-direction: row;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        font-size: 0.85rem;
        color: #ccc;
        margin-top: auto;
        border-top: 1px solid #2b2b2b;
        padding-top: 1rem;
    }

    .meta strong {
        color: #d8372b;
    }

    .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 0.5rem;
    }

    .action-btn {
        background: #151515;
        color: #f1eee7;
        border: 1px solid #d8372b;
        padding: 0.5rem 1rem;
        border-radius: 4px;
        cursor: pointer;
        transition: all 0.2s;
        text-transform: uppercase;
        font-size: 0.8rem;
        font-weight: bold;
        width: 100%;
    }

    .action-btn:hover:not(:disabled) {
        background: #d8372b;
        color: #fff;
        box-shadow: 0 0 15px rgba(216, 55, 43, 0.4);
    }

    /* Status specific styles */
    .plugin-card.pending { border-left: 4px solid #f39c12; }
    .plugin-card.approved { border-left: 4px solid #2ecc71; }
    .plugin-card.rejected { border-left: 4px solid #e74c3c; }

    .status-badge strong { text-shadow: 0 0 5px currentColor; }

    .plugin-card.pending .status-badge strong { color: #f39c12; }
    .plugin-card.approved .status-badge strong { color: #2ecc71; }
    .plugin-card.rejected .status-badge strong { color: #e74c3c; }

    .pending-msg {
        color: #f39c12;
        font-size: 0.9rem;
        font-weight: bold;
        text-transform: uppercase;
        align-self: center;
        text-align: center;
        width: 100%;
        margin-top: 0.5rem;
    }

    .rejected-msg {
        color: #e74c3c;
        font-size: 0.9rem;
        font-weight: bold;
        text-transform: uppercase;
        align-self: center;
        text-align: center;
        width: 100%;
        margin-top: 0.5rem;
    }
</style>
