<script>
	import { onMount, afterUpdate } from 'svelte';

	export let logs = [];

	// Log filtering
	let filterText = '';
	let filterLevel = 'all';
	let autoscroll = true;

	// DOM reference to log container for autoscrolling
	let logContainer;

	// Filtered logs based on search text and level
	$: filteredLogs = logs.filter((log) => {
		const matchesText = !filterText || log.message.toLowerCase().includes(filterText.toLowerCase());
		const matchesLevel =
			filterLevel === 'all' ||
			(filterLevel === 'error' && log.message.includes('[ERROR]')) ||
			(filterLevel === 'warning' && log.message.includes('[WARNING]')) ||
			(filterLevel === 'debug' && log.message.includes('[DEBUG]'));

		return matchesText && matchesLevel;
	});

	function getLogStyle(message) {
		if (message.includes('[ERROR]')) return 'text-red-600';
		if (message.includes('[WARNING]')) return 'text-yellow-600';
		if (message.includes('[DEBUG]')) return 'text-blue-600';
		return 'text-gray-800';
	}

	function formatTimestamp(date) {
		return date.toLocaleTimeString();
	}

	// Auto-scroll to bottom when new logs arrive
	afterUpdate(() => {
		if (autoscroll && logContainer) {
			logContainer.scrollTop = logContainer.scrollHeight;
		}
	});
</script>

<div class="flex h-full flex-col">
	<!-- Log controls -->
	<div class="mb-2 space-y-2 border-b border-gray-200 pb-2">
		<div class="flex items-center gap-2">
			<input
				type="text"
				bind:value={filterText}
				placeholder="Filter logs..."
				class="flex-grow rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			/>

			<select
				bind:value={filterLevel}
				class="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			>
				<option value="all">All Levels</option>
				<option value="error">Errors</option>
				<option value="warning">Warnings</option>
				<option value="debug">Debug</option>
			</select>
		</div>

		<div class="flex items-center">
			<label class="flex items-center text-sm text-gray-700">
				<input
					type="checkbox"
					bind:checked={autoscroll}
					class="mr-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
				/>
				Auto-scroll
			</label>
		</div>
	</div>

	<!-- Log display -->
	<div
		bind:this={logContainer}
		class="mb-4 flex-grow overflow-y-auto rounded bg-gray-50 p-2 font-mono text-xs shadow-inner"
	>
		{#if filteredLogs.length === 0}
			<div class="italic text-gray-500">No logs to display.</div>
		{:else}
			{#each filteredLogs as log}
				<div class="mb-1 leading-tight">
					<span class="text-gray-500">[{formatTimestamp(log.timestamp)}]</span>
					<span class={getLogStyle(log.message)}>{log.message}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>
