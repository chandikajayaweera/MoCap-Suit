<script>
	import { onMount, onDestroy } from 'svelte';
	import CommandPanel from '$lib/components/CommandPanel.svelte';
	import LogViewer from '$lib/components/LogViewer.svelte';
	import SensorVisualization from '$lib/components/SensorVisualization.svelte';

	// Connection status
	let connected = false;
	let connecting = false;
	let socket;

	// Data storage
	let logs = [];
	let sensorData = {};

	// Settings
	let serialPort = ''; // Empty default value
	let showConfiguration = true; // Show by default
	let availablePorts = [];
	let loadingPorts = false;

	function connect() {
		if (connecting || connected) return;

		if (!serialPort) {
			alert('Please select a serial port first');
			return;
		}

		connecting = true;

		fetch('/api/connect', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ port: serialPort })
		})
			.then((response) => response.json())
			.then((data) => {
				if (data.success) {
					connected = true;
					initWebSocket();
				} else {
					alert('Failed to connect: ' + data.error);
				}
			})
			.catch((error) => {
				alert('Connection error: ' + error);
			})
			.finally(() => {
				connecting = false;
			});
	}

	function disconnect() {
		if (!connected) return;

		if (socket) {
			socket.close();
		}

		fetch('/api/disconnect', { method: 'POST' })
			.then((response) => response.json())
			.then((data) => {
				connected = false;
			})
			.catch((error) => {
				alert('Disconnect error: ' + error);
			});
	}

	function initWebSocket() {
		// Close existing connection if any
		if (socket) {
			socket.close();
		}

		// Create WebSocket connection
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = `${protocol}//${window.location.host}/api/ws`;

		console.log(`Connecting to WebSocket at ${wsUrl}`);
		socket = new WebSocket(wsUrl);

		socket.onopen = () => {
			console.log('WebSocket connected');
			// Add a log entry
			logs = [
				...logs,
				{ timestamp: new Date(), message: '[CLIENT] WebSocket connection established' }
			];
		};

		socket.onmessage = (event) => {
			console.log('WebSocket message received:', event.data);
			try {
				const data = JSON.parse(event.data);

				if (data.type === 'log') {
					logs = [...logs, { timestamp: new Date(), message: data.message }];
					// Keep only the last 1000 logs
					if (logs.length > 1000) {
						logs = logs.slice(-1000);
					}
				} else if (data.type === 'sensorData') {
					sensorData = data.data;
				}
			} catch (error) {
				console.error('Error parsing WebSocket message:', error);
			}
		};

		socket.onclose = (event) => {
			console.log('WebSocket disconnected:', event);
			if (connected) {
				logs = [
					...logs,
					{
						timestamp: new Date(),
						message: `[CLIENT] WebSocket connection closed ${event.wasClean ? 'cleanly' : 'unexpectedly'} (code: ${event.code})`
					}
				];

				// Attempt to reconnect after a delay if it wasn't intentional
				if (connected) {
					setTimeout(() => {
						logs = [
							...logs,
							{ timestamp: new Date(), message: '[CLIENT] Attempting to reconnect WebSocket...' }
						];
						initWebSocket();
					}, 2000);
				}
			}
		};

		socket.onerror = (error) => {
			console.error('WebSocket error:', error);
			logs = [...logs, { timestamp: new Date(), message: '[ERROR] WebSocket error occurred' }];
		};
	}

	function sendCommand(command) {
		if (!connected || !socket) {
			console.error('Cannot send command: not connected');
			return;
		}

		console.log('Sending command:', command);

		try {
			socket.send(
				JSON.stringify({
					type: 'command',
					command: command
				})
			);

			// Add to logs for immediate feedback
			logs = [...logs, { timestamp: new Date(), message: `[CLIENT] Sent command: ${command}` }];
		} catch (error) {
			console.error('Error sending command:', error);
			logs = [
				...logs,
				{ timestamp: new Date(), message: `[ERROR] Failed to send command: ${error.message}` }
			];
		}
	}

	function clearLogs() {
		logs = [];
	}

	function loadAvailablePorts() {
		loadingPorts = true;
		fetch('/api/ports')
			.then((response) => response.json())
			.then((data) => {
				if (data.success && data.ports) {
					availablePorts = data.ports;
					// Auto-select the first port if available
					if (availablePorts.length > 0 && !serialPort) {
						serialPort = availablePorts[0].path;
					}
				} else {
					console.error('Failed to get ports:', data.error);
				}
			})
			.catch((error) => {
				console.error('Error fetching ports:', error);
			})
			.finally(() => {
				loadingPorts = false;
			});
	}

	onMount(() => {
		// Load available ports on mount
		loadAvailablePorts();
	});

	onDestroy(() => {
		if (socket) {
			socket.close();
		}
	});
</script>

<div class="flex h-screen flex-col bg-gray-100">
	<!-- Header -->
	<header class="bg-blue-600 p-4 text-white shadow-md">
		<div class="flex items-center justify-between">
			<h1 class="text-2xl font-bold">Motion Capture Control Panel</h1>

			<div class="flex items-center gap-4">
				<button
					on:click={() => (showConfiguration = !showConfiguration)}
					class="rounded bg-blue-700 px-3 py-1 text-white hover:bg-blue-800"
				>
					Settings
				</button>

				{#if connected}
					<button
						on:click={disconnect}
						class="rounded bg-red-600 px-3 py-1 text-white hover:bg-red-700"
					>
						Disconnect
					</button>
				{:else}
					<button
						on:click={connect}
						class="rounded bg-green-600 px-3 py-1 text-white hover:bg-green-700"
						disabled={connecting}
					>
						{connecting ? 'Connecting...' : 'Connect'}
					</button>
				{/if}

				<div class="flex items-center">
					<span class="mr-2">Status:</span>
					<span
						class="mr-1 inline-block h-3 w-3 rounded-full"
						class:bg-green-500={connected}
						class:bg-red-500={!connected}
					></span>
					<span>{connected ? 'Connected' : 'Disconnected'}</span>
				</div>
			</div>
		</div>
	</header>

	<!-- Configuration Panel (conditionally shown) -->
	{#if showConfiguration}
		<div class="border-b border-gray-300 bg-gray-200 p-4">
			<h2 class="mb-2 font-semibold">Configuration</h2>
			<div class="flex items-center gap-4">
				<div class="flex items-center">
					<label for="serialPort" class="mr-2">Serial Port:</label>
					{#if loadingPorts}
						<div class="text-gray-500">Loading ports...</div>
					{:else if availablePorts.length === 0}
						<div class="text-red-500">No ports found</div>
					{:else}
						<select
							id="serialPort"
							bind:value={serialPort}
							class="w-64 rounded border px-2 py-1"
							disabled={connected}
						>
							<option value="">-- Select a port --</option>
							{#each availablePorts as port}
								<option value={port.path}>
									{port.path}
									{port.manufacturer ? `(${port.manufacturer})` : ''}
								</option>
							{/each}
						</select>
					{/if}
				</div>

				<button
					on:click={loadAvailablePorts}
					class="rounded bg-gray-300 px-2 py-1 text-sm hover:bg-gray-400"
					disabled={connected || loadingPorts}
				>
					{loadingPorts ? 'Loading...' : 'Refresh Ports'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Main Content -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Left Panel - Commands and Controls -->
		<div class="w-1/4 overflow-y-auto bg-white p-4 shadow-md">
			<CommandPanel {connected} onSendCommand={sendCommand} />
		</div>

		<!-- Center Panel - Visualization -->
		<div class="w-1/2 overflow-hidden bg-white p-4 shadow-md">
			<SensorVisualization data={sensorData} {connected} />
		</div>

		<!-- Right Panel - Logs -->
		<div class="flex w-1/4 flex-col overflow-hidden bg-white p-4 shadow-md">
			<div class="mb-2 flex items-center justify-between">
				<h2 class="font-semibold">System Logs</h2>
				<button
					on:click={clearLogs}
					class="rounded bg-gray-200 px-2 py-1 text-sm hover:bg-gray-300"
				>
					Clear
				</button>
			</div>
			<LogViewer {logs} />
		</div>
	</div>

	<!-- Footer -->
	<footer class="bg-gray-200 p-2 text-center text-sm text-gray-600">
		Motion Capture Control Panel &copy; 2025
	</footer>
</div>
