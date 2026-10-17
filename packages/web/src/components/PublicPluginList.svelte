<script>
	import { onMount } from "svelte";
	import { API_URL } from "../config";

	let plugins = [];
	let loading = true;
	let error = null;

	onMount(async () => {
		try {
			const response = await fetch(`${API_URL}/manifest.json`);
			if (response.ok) {
				plugins = await response.json();
			} else {
				error = "Failed to fetch plugins manifest";
			}
		} catch (e) {
			error = "Error fetching plugins manifest: " + e.message;
		} finally {
			loading = false;
		}
	});
</script>

<div class="plugins-grid">
	{#if loading}
		<p class="loading">Loading plugins...</p>
	{:else if error}
		<p class="error">{error}</p>
	{:else if plugins.length > 0}
		{#each plugins as plugin}
			<div class="plugin-card">
				<h3>{plugin.name}</h3>
				<p class="author">by {plugin.author}</p>
				<p class="description">
					{plugin.description || "No description provided."}
				</p>
				<div class="plugin-meta">
					<span class="version">v{plugin.version || "1.0.0"}</span>
					<a
						href={plugin.github_url}
						target="_blank"
						rel="noopener noreferrer"
						class="download-link">Source</a
					>
				</div>
			</div>
		{/each}
	{:else}
		<p class="no-plugins">No plugins approved yet. Check back later!</p>
	{/if}
</div>

<style>
	.plugins-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 2rem;
		margin-top: 2rem;
		text-align: left;
		width: 100%;
	}

	.plugin-card {
		background: #0f0f0f;
		border: 2px solid #2b2b2b;
		border-radius: 4px;
		padding: 1.5rem;
		box-shadow:
			inset 0 1px 0 0 #2a2a2a,
			0 4px 6px rgba(0, 0, 0, 0.4);
		transition:
			transform 0.2s,
			border-color 0.2s;
		display: flex;
		flex-direction: column;
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

	.author {
		margin: 0 0 1rem 0;
		font-size: 0.85rem;
		color: #888;
	}

	.description {
		margin: 0 0 1.5rem 0;
		font-size: 0.95rem;
		line-height: 1.4;
		color: #ccc;
		flex-grow: 1;
	}

	.plugin-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: auto;
		border-top: 1px solid #2b2b2b;
		padding-top: 1rem;
	}

	.version {
		font-size: 0.85rem;
		color: #888;
		background: #1a1a1a;
		padding: 0.2rem 0.5rem;
		border-radius: 3px;
		border: 1px solid #333;
	}

	.download-link {
		color: #f1eee7;
		text-decoration: none;
		font-size: 0.85rem;
		background: #2b2b2b;
		padding: 0.3rem 0.75rem;
		border-radius: 3px;
		border: 1px solid #444;
		transition:
			background 0.2s,
			color 0.2s;
	}

	.download-link:hover {
		background: #d8372b;
		color: #fff;
		border-color: #b82c21;
	}

	.no-plugins,
	.loading,
	.error {
		grid-column: 1 / -1;
		text-align: center;
		color: #888;
		font-style: italic;
	}

	.error {
		color: #d8372b;
	}
</style>
