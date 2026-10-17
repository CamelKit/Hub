<script>
    import { createEventDispatcher } from 'svelte';
    import { addToast } from '../stores/toast.js';
    import { API_URL } from '../config';
    const dispatch = createEventDispatcher();

    let url = '';

    async function handleSubmit() {
        try {
            const token = localStorage.getItem('camelkit_token') || localStorage.getItem('camelcore_token');
            const res = await fetch(`${API_URL}/api/plugins/submit`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': token ? `Bearer ${token}` : ''
                },
                body: JSON.stringify({ githubUrl: url })
            });

            const data = await res.json();
            
            if (res.ok) {
                addToast('Plugin submitted successfully! Added to queue.', 'success');
                url = ''; // reset form
                dispatch('submitted');
            } else {
                addToast(data.error || 'Failed to submit plugin.', 'error');
            }
        } catch (err) {
            addToast('A network error occurred.', 'error');
        }
    }
</script>

<form on:submit|preventDefault={handleSubmit}>
    <div class="input-group">
        <label for="githubUrl">GitHub Repository URL</label>
        <input 
            type="url" 
            id="githubUrl" 
            bind:value={url}
            placeholder="https://github.com/username/repo" 
            required 
            pattern="^https:\/\/github\.com\/[\w-]+\/[\w-]+$" 
            title="Must be a valid GitHub repository URL" 
        />
    </div>
    <button type="submit" class="submit-btn">Submit</button>
</form>

<style>
	.input-group {
		margin-bottom: 1.5rem;
		text-align: left;
	}

	.input-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-weight: bold;
		color: #f1eee7;
	}

	.input-group input {
		width: 100%;
		padding: 0.75rem;
		background: #151515;
		border: 2px solid #2b2b2b;
		color: #f1eee7;
		border-radius: 4px;
		box-sizing: border-box;
	}

	.submit-btn {
		background: #d8372b;
		color: white;
		border: 2px solid #5a120e;
		padding: 0.75rem 2rem;
		font-size: 1rem;
		font-weight: bold;
		cursor: pointer;
		width: 100%;
		transition: background 0.2s;
	}

	.submit-btn:hover {
		background: #b82c21;
	}

	.submit-btn:hover {
		background: #b82c21;
	}
</style>
