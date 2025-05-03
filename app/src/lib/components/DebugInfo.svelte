<script>
	import { debugMode } from '$lib/stores/motionStore.js';

	let { isStreaming = false, sensorData = {}, dataPacketsReceived = 0 } = $props();

	$effect(() => {
		if ($debugMode && isStreaming && sensorData) {
			const sensorCount = Object.keys(sensorData).filter((k) => k.startsWith('S')).length;

			// Safe access to sequence property
			const sequence = 'sequence' in sensorData ? sensorData.sequence : null;

			if (sensorCount > 0 && sequence !== null && sequence % 50 === 0) {
				console.log(
					`DebugInfo: seq=${sequence}, sensors=${sensorCount}, packets=${dataPacketsReceived}`
				);
			}
		}
	});

	function getFormattedData() {
		if (!sensorData) {
			return 'No data received yet';
		}

		if (typeof sensorData !== 'object' || Object.keys(sensorData).length === 0) {
			return 'No data received yet';
		}

		const seq = 'sequence' in sensorData ? `SEQ: ${sensorData.sequence}` : '';

		const activeSensors = Object.keys(sensorData).filter(
			(key) => key.startsWith('S') && Array.isArray(sensorData[key]) && sensorData[key].length === 4
		).length;

		return `${seq} | Active Sensors: ${activeSensors}`;
	}
</script>

{#if isStreaming && $debugMode}
	<div class="absolute right-2 top-2 z-10 rounded bg-black/70 p-1.5 font-mono text-xs text-white">
		<div>Packets: {dataPacketsReceived}</div>
		<div>{getFormattedData()}</div>
	</div>
{/if}
