<script>
	import modelManager from '$lib/three/models.js';
	import { selectedEnvironment } from '$lib/stores/motionStore.js';
</script>

<div>
	<label for="env-select" class="mr-2 text-sm font-medium">Environment:</label>
	<select
		id="env-select"
		bind:value={$selectedEnvironment}
		class="rounded border border-gray-300 bg-white px-2 py-1 text-sm"
	>
		{#each modelManager.getEnvironments() as env}
			<option value={env.id}>{env.name}</option>
		{/each}
	</select>
</div>
