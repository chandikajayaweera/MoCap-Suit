<script>
	// Props using the $props rune for Svelte 5
	let { isStreaming = false, sensorData = {}, dataPacketsReceived = 0 } = $props();

	// Format sensor data using standard function instead of derived value
	function getFormattedData() {
		// Handle different data structures more robustly
		if (!sensorData) {
			return 'No data received yet';
		}

		// Make sure sensorData is an object with content
		if (typeof sensorData !== 'object' || Object.keys(sensorData).length === 0) {
			return 'No data received yet';
		}

		// Format sequence number if available
		const seq = sensorData.sequence !== undefined ? `SEQ: ${sensorData.sequence}` : '';

		// Count available sensors more reliably
		const activeSensors = Object.entries(sensorData).filter(
			([key, value]) => key.startsWith('S') && Array.isArray(value) && value.length === 4
		).length;

		// Build a more comprehensive status message
		return `${seq} | Active Sensors: ${activeSensors}`;
	}

	// Log the props when they change for debugging
	$effect(() => {
		if (isStreaming && dataPacketsReceived > 0) {
			// Only log when we're actually streaming and receiving data
			console.log(
				'DebugInfo sensor count:',
				sensorData ? Object.keys(sensorData).filter((k) => k.startsWith('S')).length : 0
			);
		}
	});
</script>

{#if isStreaming}
	<div class="absolute right-2 top-2 z-10 rounded bg-black/70 p-1.5 font-mono text-xs text-white">
		<div>Packets: {dataPacketsReceived}</div>
		<div>{getFormattedData()}</div>
	</div>
{/if}
