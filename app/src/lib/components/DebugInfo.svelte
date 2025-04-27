<script>
	// Props using the $props rune for Svelte 5
	let { isStreaming = false, sensorData = {}, dataPacketsReceived = 0 } = $props();

	// Track data updates for debugging
	$effect(() => {
		if (isStreaming && sensorData && Object.keys(sensorData).length > 0) {
			const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;
			if (sensorCount > 0 && sensorData.sequence !== undefined && sensorData.sequence % 50 === 0) {
				console.log(
					`DebugInfo: seq=${sensorData.sequence}, sensors=${sensorCount}, packets=${dataPacketsReceived}`
				);
			}
		}
	});

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
		const activeSensors = Object.keys(sensorData).filter(
			(key) => key.startsWith('S') && Array.isArray(sensorData[key]) && sensorData[key].length === 4
		).length;

		// Build a more comprehensive status message
		return `${seq} | Active Sensors: ${activeSensors}`;
	}
</script>

{#if isStreaming}
	<div class="absolute right-2 top-2 z-10 rounded bg-black/70 p-1.5 font-mono text-xs text-white">
		<div>Packets: {dataPacketsReceived}</div>
		<div>{getFormattedData()}</div>
	</div>
{/if}
