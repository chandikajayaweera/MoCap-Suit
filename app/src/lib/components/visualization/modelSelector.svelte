<script>
	import modelManager from '$lib/three/models.js';
	import { selectedModel, loading } from '$lib/stores/motionStore.js';
</script>

<div>
	<label for="model-select" class="mr-2 text-sm font-medium">Model:</label>
	<select
		id="model-select"
		bind:value={$selectedModel}
		disabled={$loading}
		class="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
	>
		{#each modelManager.getModels() as model}
			<option value={model.id}>{model.name}</option>
		{/each}
	</select>
</div>
