<script>
    import { addToast } from '../stores/toast.js';
    import { API_URL } from '../config';
    let queue = [];
    let loading = true;
    let errorMsg = '';
    let token = '';

    // Execute directly (safe because of client:only="svelte")
    try {
        token = localStorage.getItem('camelkit_token') || localStorage.getItem('camelcore_token') || '';
    } catch (e) {
        token = '';
    }
    fetchQueue();

    async function fetchQueue() {
        if (!token) {
            errorMsg = 'You must be logged in as an admin to view this page.';
            loading = false;
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/admin/queue`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    errorMsg = 'Access Denied. You do not have admin privileges or your session expired.';
                } else {
                    errorMsg = 'Failed to fetch the plugin queue.';
                }
                loading = false;
                return;
            }

            queue = await res.json();
            loading = false;
        } catch (err) {
            errorMsg = 'A network error occurred while fetching the queue.';
            loading = false;
        }
    }

    async function handlePluginAction(id, action) {
        if (!token) return;
        try {
            const res = await fetch(`${API_URL}/api/admin/plugins/${id}/${action}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                addToast(`Successfully ${action}d plugin.`, 'success');
                fetchQueue(); // Refresh queue
            } else {
                addToast(`Failed to ${action} plugin.`, 'error');
            }
        } catch (err) {
            addToast('A network error occurred.', 'error');
        }
    }
</script>

{#if loading}
    <div class="state-message">Loading queue...</div>
{:else if errorMsg}
    <div class="state-message error">{errorMsg}</div>
{:else}
    <div id="queue-container">
        <h2>Pending Plugins</h2>
        <ul class="plugin-list">
            {#if queue.length === 0}
                <li>No pending plugins in the queue.</li>
            {:else}
                {#each queue as plugin}
                    <li class="plugin-item">
                        <strong>{plugin.name || 'Unknown Plugin'}</strong>
                        <p>{plugin.description || 'No description provided.'}</p>
                        <div class="plugin-meta">
                            <a href="{plugin.download_url}" target="_blank">View Repository</a>
                            <div class="plugin-actions">
                                <button on:click={() => handlePluginAction(plugin.id, 'approve')} class="action-btn approve-btn">Approve</button>
                                <button on:click={() => handlePluginAction(plugin.id, 'reject')} class="action-btn reject-btn">Reject</button>
                            </div>
                        </div>
                    </li>
                {/each}
            {/if}
        </ul>
    </div>
{/if}

<style>
	h2 { color: #e8a731; margin-top: 1.5rem; }

	.state-message {
		text-align: center;
		padding: 2rem;
		font-size: 1.2rem;
	}

	.state-message.error {
		color: #d8372b;
		background: #1a0505;
		border: 1px solid #d8372b;
		border-radius: 4px;
	}

	.plugin-list {
		list-style: none;
		padding: 0;
	}

	.plugin-item {
		background: #0f0f0f;
		border: 1px solid #2b2b2b;
		padding: 1.5rem;
		margin-bottom: 1rem;
		border-radius: 4px;
	}

	.plugin-item strong {
		font-size: 1.2rem;
		color: #f1eee7;
	}

	.plugin-item p {
		color: #a0a0a0;
		margin: 0.5rem 0 1rem 0;
		text-shadow: none;
	}

	.plugin-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.9rem;
	}

	.plugin-meta a {
		color: #58a6ff;
		text-decoration: none;
		text-shadow: none;
	}

	.plugin-meta a:hover {
		text-decoration: underline;
	}
</style>
