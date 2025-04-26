<script>
	// A debugging component for the visualization panel

	// Props
	let { isStreaming = false, sensorData = {}, dataPacketsReceived = 0 } = $props();

	// Format sensor data using standard function instead of derived value
	function getFormattedData() {
		console.log(
			'DebugInfo component rendering with data:',
			sensorData ? typeof sensorData : 'undefined',
			sensorData ? Object.keys(sensorData).length : 0,
			'keys'
		);

		if (!sensorData || Object.keys(sensorData).length === 0) {
			console.log('No sensorData available');
			return 'No data received yet';
		}

		// Format sequence number if available
		const seq = sensorData.sequence !== undefined ? `SEQ: ${sensorData.sequence}` : '';

		// Count available sensors
		const activeSensors = Object.entries(sensorData).filter(
			([key, value]) => key.startsWith('S') && Array.isArray(value)
		).length;

		const result = `${seq} | Active Sensors: ${activeSensors}`;
		console.log('DebugInfo formatted data:', result);
		return result;
	}

	// Log the props when they change
	$effect(() => {
		console.log(
			'DebugInfo props updated:',
			'isStreaming =',
			isStreaming,
			'dataPacketsReceived =',
			dataPacketsReceived
		);
	});
</script>

{#if isStreaming}
	<div class="absolute right-2 top-2 z-10 rounded bg-black/70 p-1.5 font-mono text-xs text-white">
		<div>Packets: {dataPacketsReceived}</div>
		<div>{getFormattedData()}</div>
	</div>
{/if}
