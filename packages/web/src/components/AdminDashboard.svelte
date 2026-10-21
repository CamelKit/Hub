<script>
    import { onDestroy } from 'svelte';
    import { addToast } from '../stores/toast.js';
    import { API_URL } from '../config';

    let queue = [];
    let builds = [];
    let loading = true;
    let refreshing = false;
    let errorMsg = '';
    let token = '';
    let activeTab = 'queue'; // 'queue' | 'builds'
    let retryingIds = {};
    let pollTimer = null;

    // Execute directly (safe because of client:only="svelte")
    try {
        token = localStorage.getItem('camelkit_token') || localStorage.getItem('camelcore_token') || '';
    } catch (e) {
        token = '';
    }

    fetchAll();

    onDestroy(() => {
        stopPolling();
    });

    function startPollingIfNeeded() {
        stopPolling();
        const hasActiveBuilds = builds.some(b => b.status === 'building' || b.status === 'approved');
        if (hasActiveBuilds) {
            pollTimer = setTimeout(async () => {
                await fetchBuilds(false);
                startPollingIfNeeded();
            }, 6000);
        }
    }

    function stopPolling() {
        if (pollTimer) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    async function fetchAll(showLoading = true) {
        if (!token) {
            errorMsg = 'You must be logged in as an admin to view this page.';
            loading = false;
            return;
        }

        if (showLoading) loading = true;
        refreshing = true;
        errorMsg = '';

        try {
            const [queueRes, buildsRes] = await Promise.all([
                fetch(`${API_URL}/api/admin/queue`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`${API_URL}/api/admin/builds`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);

            if (!queueRes.ok) {
                if (queueRes.status === 401 || queueRes.status === 403) {
                    errorMsg = 'Access Denied. You do not have admin privileges or your session expired.';
                } else {
                    errorMsg = 'Failed to fetch the plugin review queue.';
                }
                loading = false;
                refreshing = false;
                return;
            }

            queue = await queueRes.json();
            if (buildsRes.ok) {
                builds = await buildsRes.json();
            } else {
                builds = [];
            }

            // Auto-switch to builds tab if queue is empty and builds exist on initial load
            if (queue.length === 0 && builds.length > 0 && activeTab === 'queue' && showLoading) {
                activeTab = 'builds';
            }

            startPollingIfNeeded();
        } catch (err) {
            errorMsg = 'A network error occurred while fetching dashboard data.';
        } finally {
            loading = false;
            refreshing = false;
        }
    }

    async function fetchBuilds(silent = true) {
        if (!token) return;
        try {
            const res = await fetch(`${API_URL}/api/admin/builds`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                builds = await res.json();
            }
        } catch (err) {
            console.error('Failed to poll builds:', err);
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
                fetchAll(false);
            } else {
                const data = await res.json().catch(() => ({}));
                addToast(`Failed to ${action} plugin: ${data.error || 'Unknown error'}`, 'error');
            }
        } catch (err) {
            addToast('A network error occurred.', 'error');
        }
    }

    async function handleRetry(id) {
        if (!token) return;
        retryingIds[id] = true;
        retryingIds = { ...retryingIds };

        // Optimistically set status
        builds = builds.map(b => b.id === id ? { ...b, status: 'building' } : b);

        try {
            const res = await fetch(`${API_URL}/api/admin/plugins/${id}/retry`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await res.json().catch(() => ({}));

            if (res.ok) {
                addToast('Build re-triggered successfully.', 'success');
                await fetchBuilds();
                startPollingIfNeeded();
            } else {
                addToast(`Failed to retry build: ${data.error || 'Server error'}`, 'error');
                await fetchBuilds();
            }
        } catch (err) {
            addToast('Network error while retrying build.', 'error');
            await fetchBuilds();
        } finally {
            delete retryingIds[id];
            retryingIds = { ...retryingIds };
        }
    }

    $: failedCount = builds.filter(b => b.status === 'failed').length;
    $: buildingCount = builds.filter(b => b.status === 'building' || b.status === 'approved').length;
</script>

{#if loading}
    <div class="state-message">Loading admin dashboard...</div>
{:else if errorMsg}
    <div class="state-message error">{errorMsg}</div>
{:else}
    <div id="queue-container">
        <div class="dashboard-header">
            <div class="tabs-nav">
                <button
                    class="tab-btn {activeTab === 'queue' ? 'active' : ''}"
                    on:click={() => activeTab = 'queue'}
                >
                    Pending Review
                    <span class="count-badge">{queue.length}</span>
                </button>
                <button
                    class="tab-btn {activeTab === 'builds' ? 'active' : ''}"
                    on:click={() => activeTab = 'builds'}
                >
                    Building & Failed
                    <span class="count-badge {failedCount > 0 ? 'has-failed' : ''}">
                        {builds.length}
                    </span>
                </button>
            </div>
            <button class="action-btn refresh-btn" on:click={() => fetchAll(false)} disabled={refreshing}>
                {#if refreshing}
                    <span class="spinner-small"></span> Refreshing...
                {:else}
                    ⟳ Refresh
                {/if}
            </button>
        </div>

        {#if activeTab === 'queue'}
            <div class="tab-content">
                <h2>Pending Review Queue ({queue.length})</h2>
                {#if queue.length === 0}
                    <div class="empty-state">No pending plugins in the review queue.</div>
                {:else}
                    <ul class="plugin-list">
                        {#each queue as plugin}
                            <li class="plugin-item">
                                <div class="plugin-header-line">
                                    <strong class="plugin-title">{plugin.name || 'Unknown Plugin'}</strong>
                                    <span class="author-tag">by {plugin.author || 'Unknown'}</span>
                                </div>
                                <p>{plugin.description || 'No description provided.'}</p>
                                <div class="plugin-meta">
                                    <div class="meta-links">
                                        <a href="{plugin.github_url || plugin.download_url}" target="_blank" rel="noopener noreferrer">
                                            View Repository ↗
                                        </a>
                                        {#if plugin.latest_commit_hash}
                                            <span class="commit-pill">
                                                Commit: <code>{plugin.latest_commit_hash.substring(0, 7)}</code>
                                            </span>
                                        {/if}
                                    </div>
                                    <div class="plugin-actions">
                                        <button on:click={() => handlePluginAction(plugin.id, 'approve')} class="action-btn approve-btn">Approve</button>
                                        <button on:click={() => handlePluginAction(plugin.id, 'reject')} class="action-btn reject-btn">Reject</button>
                                    </div>
                                </div>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        {:else if activeTab === 'builds'}
            <div class="tab-content">
                <div class="builds-summary">
                    <h2>Active & Failed Builds ({builds.length})</h2>
                    <div class="summary-pills">
                        {#if buildingCount > 0}
                            <span class="summary-pill building-pill">
                                <span class="spinner-small"></span> {buildingCount} Building
                            </span>
                        {/if}
                        {#if failedCount > 0}
                            <span class="summary-pill failed-pill">
                                ⚠ {failedCount} Failed
                            </span>
                        {/if}
                    </div>
                </div>

                {#if builds.length === 0}
                    <div class="empty-state">No active or failed builds. Everything is clear!</div>
                {:else}
                    <ul class="plugin-list">
                        {#each builds as plugin}
                            <li class="plugin-item build-item {plugin.status}">
                                <div class="plugin-header-line">
                                    <div class="title-with-badge">
                                        <strong class="plugin-title">{plugin.name || 'Unknown Plugin'}</strong>
                                        <span class="author-tag">by {plugin.author || 'Unknown'}</span>
                                    </div>
                                    <div class="status-indicator">
                                        {#if plugin.status === 'building'}
                                            <span class="status-badge building">
                                                <span class="spinner-small"></span> Building in CI
                                            </span>
                                        {:else if plugin.status === 'failed'}
                                            <span class="status-badge failed">
                                                ⚠ Build Failed
                                            </span>
                                        {:else if plugin.status === 'approved'}
                                            <span class="status-badge approved">
                                                Approved (Queued)
                                            </span>
                                        {:else}
                                            <span class="status-badge">
                                                {plugin.status}
                                            </span>
                                        {/if}
                                    </div>
                                </div>
                                <p>{plugin.description || 'No description provided.'}</p>
                                <div class="plugin-meta">
                                    <div class="meta-links">
                                        {#if plugin.github_url}
                                            <a href="{plugin.github_url}" target="_blank" rel="noopener noreferrer">
                                                Repository ↗
                                            </a>
                                        {/if}
                                        {#if plugin.latest_commit_hash}
                                            <a
                                                href="{plugin.github_url ? `${plugin.github_url}/commit/${plugin.latest_commit_hash}` : '#'}"
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                class="commit-link"
                                            >
                                                Commit: <code>{plugin.latest_commit_hash.substring(0, 7)}</code> ↗
                                            </a>
                                        {/if}
                                        {#if plugin.current_version}
                                            <span class="version-tag">v{plugin.current_version}</span>
                                        {/if}
                                    </div>
                                    <div class="plugin-actions">
                                        <button
                                            on:click={() => handleRetry(plugin.id)}
                                            class="action-btn retry-btn"
                                            disabled={retryingIds[plugin.id] || plugin.status === 'building'}
                                        >
                                            {#if retryingIds[plugin.id]}
                                                <span class="spinner-small"></span> Retrying...
                                            {:else}
                                                Retry Build
                                            {/if}
                                        </button>
                                        <button
                                            on:click={() => handlePluginAction(plugin.id, 'reject')}
                                            class="action-btn reject-btn"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>
                            </li>
                        {/each}
                    </ul>
                {/if}
            </div>
        {/if}
    </div>
{/if}

<style>
	h2 {
		color: #e8a731;
		margin: 1rem 0;
		font-size: 1.25rem;
	}

	.dashboard-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
		border-bottom: 2px solid #2b2b2b;
	}

	.tabs-nav {
		display: flex;
		gap: 0.5rem;
	}

	.tab-btn {
		background: none;
		border: none;
		color: #888;
		font-size: 0.95rem;
		cursor: pointer;
		padding: 0.75rem 1rem;
		font-family: inherit;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		border-bottom: 2px solid transparent;
		margin-bottom: -2px;
		transition: all 0.2s ease;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.tab-btn.active {
		color: #e8a731;
		border-bottom: 2px solid #e8a731;
	}

	.tab-btn:hover:not(.active) {
		color: #f1eee7;
	}

	.count-badge {
		background: #222;
		color: #aaa;
		font-size: 0.75rem;
		padding: 2px 7px;
		border-radius: 10px;
		font-weight: bold;
	}

	.count-badge.has-failed {
		background: #8a1f18;
		color: #fff;
	}

	.refresh-btn {
		background: #151515;
		color: #e8a731;
		border: 1px solid #333;
		padding: 0.35rem 0.85rem;
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.refresh-btn:hover:not(:disabled) {
		background: #252525;
		border-color: #e8a731;
	}

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

	.empty-state {
		text-align: center;
		padding: 3rem 1rem;
		color: #888;
		background: #0a0a0a;
		border: 1px dashed #2b2b2b;
		border-radius: 4px;
		margin: 1rem 0;
	}

	.builds-summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.summary-pills {
		display: flex;
		gap: 0.5rem;
	}

	.summary-pill {
		font-size: 0.75rem;
		font-weight: bold;
		text-transform: uppercase;
		padding: 0.25rem 0.6rem;
		border-radius: 12px;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.building-pill {
		background: rgba(52, 152, 219, 0.15);
		color: #3498db;
		border: 1px solid #3498db;
	}

	.failed-pill {
		background: rgba(231, 76, 60, 0.15);
		color: #e74c3c;
		border: 1px solid #e74c3c;
	}

	.plugin-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.plugin-item {
		background: #0f0f0f;
		border: 1px solid #2b2b2b;
		padding: 1.25rem 1.5rem;
		margin-bottom: 1rem;
		border-radius: 4px;
		transition: border-color 0.2s;
	}

	.build-item.failed {
		border-left: 4px solid #e74c3c;
	}

	.build-item.building {
		border-left: 4px solid #3498db;
	}

	.build-item.approved {
		border-left: 4px solid #e8a731;
	}

	.plugin-header-line {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.4rem;
	}

	.title-with-badge {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.plugin-title {
		font-size: 1.15rem;
		color: #f1eee7;
	}

	.author-tag {
		color: #777;
		font-size: 0.85rem;
	}

	.plugin-item p {
		color: #999;
		margin: 0.35rem 0 1rem 0;
		font-size: 0.95rem;
		line-height: 1.4;
	}

	.plugin-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.85rem;
		border-top: 1px solid #1a1a1a;
		padding-top: 0.75rem;
	}

	.meta-links {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.meta-links a {
		color: #58a6ff;
		text-decoration: none;
	}

	.meta-links a:hover {
		text-decoration: underline;
	}

	.commit-pill, .commit-link {
		color: #aaa;
		text-decoration: none;
		font-size: 0.8rem;
	}

	.commit-pill code, .commit-link code {
		background: #1a1a1a;
		padding: 2px 5px;
		border-radius: 3px;
		color: #e8a731;
	}

	.version-tag {
		background: #222;
		color: #aaa;
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 0.75rem;
	}

	.status-badge {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.2rem 0.6rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: bold;
		letter-spacing: 0.5px;
		text-transform: uppercase;
	}

	.status-badge.failed {
		background: rgba(231, 76, 60, 0.15);
		color: #e74c3c;
		border: 1px solid #e74c3c;
	}

	.status-badge.building {
		background: rgba(52, 152, 219, 0.15);
		color: #3498db;
		border: 1px solid #3498db;
	}

	.status-badge.approved {
		background: rgba(232, 167, 49, 0.15);
		color: #e8a731;
		border: 1px solid #e8a731;
	}

	.retry-btn {
		background: #2a1f0a;
		color: #f1c40f;
		border: 1px solid #8c6812;
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
	}

	.retry-btn:hover:not(:disabled) {
		background: #48340d;
		border-color: #f1c40f;
	}

	.action-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.spinner-small {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(255, 255, 255, 0.2);
		border-top: 2px solid currentColor;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		display: inline-block;
	}

	@keyframes spin {
		0% { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}
</style>

