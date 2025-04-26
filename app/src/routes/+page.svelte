<script>
	import { onMount, onDestroy } from 'svelte';
	import CommandPanel from '$lib/components/CommandPanel.svelte';
	import LogViewer from '$lib/components/LogViewer.svelte';
	import SensorVisualization from '$lib/components/visualization/SensorVisualization.svelte';
	import * as motionStore from '$lib/stores/motionStore.js';

	// Define log level constants
	const LOG_INFO = 'INFO';
	const LOG_WARNING = 'WARNING';
	const LOG_ERROR = 'ERROR';
	const LOG_DEBUG = 'DEBUG';

	// Connection status
	let connected = $state(false);
	let connecting = $state(false);
	let socket;

	// Data storage
	let logs = $state([]);
	let sensorData = $state({});

	// Settings
	let serialPort = $state('');
	let originalPort = $state('');
	let portChangeDetected = $state(false);
	let showConfiguration = $state(true);
	let availablePorts = $state([]);
	let loadingPorts = $state(false);

	function connect() {
		if (connecting || connected) return;

		if (!serialPort) {
			alert('Please select a serial port first');
			return;
		}

		connecting = true;
		originalPort = serialPort;
		portChangeDetected = false;

		fetch('/api/connect', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				port: serialPort,
				baudRate: 115200,
				dtrControl: false
			})
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
				alert('Connection error: ' + error.message || error);
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
				portChangeDetected = false;
				motionStore.setConnected(false);
			})
			.catch((error) => {
				alert('Disconnect error: ' + (error.message || error));
			});
	}

	function initWebSocket() {
		if (socket) {
			socket.close();
		}

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = `${protocol}//${window.location.host}/api/ws`;

		console.log(`Connecting to WebSocket at ${wsUrl}`);
		socket = new WebSocket(wsUrl);

		socket.onopen = () => {
			console.log('WebSocket connected');
			addLog('WebSocket connection established');
			motionStore.setConnected(true);
		};

		socket.onmessage = (event) => {
			try {
				const data = JSON.parse(event.data);

				if (data.type === 'log') {
					if (data.message.includes('reconnected to new port')) {
						handlePortChange(data.message);
					}
					addLog(data.message);
				} else if (data.type === 'sensorData') {
					sensorData = data.data.sensorData;
				}
			} catch (error) {
				console.error('Error parsing WebSocket message:', error);
			}
		};

		socket.onclose = (event) => {
			if (connected) {
				setTimeout(() => {
					initWebSocket(); // Reconnect
				}, 2000);
			}

			console.log('WebSocket disconnected:', event);
			if (connected) {
				addLog(
					`WebSocket connection closed ${event.wasClean ? 'cleanly' : 'unexpectedly'} (code: ${event.code})`
				);

				setTimeout(() => {
					addLog('Attempting to reconnect WebSocket...');
					initWebSocket();
				}, 2000);
			}
		};

		socket.onerror = (error) => {
			console.error('WebSocket error:', error);
			addLog('WebSocket error occurred', LOG_ERROR);
		};
	}

	function handlePortChange(message) {
		const match = message.match(/new port ([^ ]+)/);
		if (match && match[1]) {
			const newPort = match[1];

			if (serialPort !== newPort) {
				portChangeDetected = true;
				addLog(
					`Device has reconnected on port ${newPort} (was ${serialPort}). Port selection has been updated.`
				);

				serialPort = newPort;
				setTimeout(() => {
					loadAvailablePorts();
				}, 1000);
			}
		}
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

			addLog(`Sent command: ${command}`);
		} catch (error) {
			console.error('Error sending command:', error);
			addLog(`Failed to send command: ${error.message || error}`, LOG_ERROR);
		}
	}

	function addLog(message, level = '') {
		const PREFIX_MAP = {
			[LOG_ERROR]: '[ERROR] ',
			[LOG_WARNING]: '[WARNING] ',
			[LOG_DEBUG]: '[DEBUG] '
		};

		const prefix = PREFIX_MAP[level] || '';

		logs = [
			...logs,
			{
				timestamp: new Date(),
				message: prefix + message
			}
		];

		// Keep logs at reasonable size
		if (logs.length > 1000) {
			logs = logs.slice(-1000);
		}
	}

	function loadAvailablePorts() {
		loadingPorts = true;
		fetch('/api/ports')
			.then((response) => response.json())
			.then((data) => {
				if (data.success && data.ports) {
					availablePorts = data.ports;

					if (portChangeDetected && serialPort) {
						const newPortInList = availablePorts.some((p) => p.path === serialPort);
						if (!newPortInList && availablePorts.length > 0) {
							serialPort = availablePorts[0].path;
						}
					} else if (!serialPort && availablePorts.length > 0) {
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
		loadAvailablePorts();
	});

	onDestroy(() => {
		if (socket) {
			socket.close();
		}
	});
</script>

<div class="flex h-screen flex-col bg-gray-100">
	<header class="bg-blue-600 p-4 text-white shadow-md">
		<div class="flex items-center justify-between">
			<h1 class="text-2xl font-bold">Motion Capture Control Panel</h1>

			<div class="flex items-center gap-4">
				<button
					onclick={() => (showConfiguration = !showConfiguration)}
					class="rounded bg-blue-700 px-3 py-1.5 text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75"
				>
					{showConfiguration ? 'Hide Settings' : 'Show Settings'}
				</button>

				{#if connected}
					<button
						onclick={disconnect}
						class="rounded bg-red-600 px-3 py-1.5 text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-75"
					>
						Disconnect
					</button>
				{:else}
					<button
						onclick={connect}
						class="rounded bg-green-600 px-3 py-1.5 text-white transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75 disabled:bg-green-400"
						disabled={connecting}
					>
						{connecting ? 'Connecting...' : 'Connect'}
					</button>
				{/if}

				<div class="flex items-center">
					<span class="mr-2 hidden sm:inline">Status:</span>
					<div class="flex items-center rounded bg-white/20 px-2 py-1">
						<span
							class="mr-1.5 inline-block h-3 w-3 rounded-full"
							class:bg-green-400={connected}
							class:bg-red-400={!connected}
						></span>
						<span class="text-sm font-medium">{connected ? 'Connected' : 'Disconnected'}</span>
					</div>
				</div>
			</div>
		</div>
	</header>

	{#if showConfiguration}
		<div class="border-b border-gray-300 bg-white p-4 shadow-sm">
			<h2 class="mb-2 font-semibold text-gray-800">Connection Settings</h2>
			<div class="flex flex-wrap items-center gap-4">
				<div class="flex items-center">
					<label for="serialPort" class="mr-2 whitespace-nowrap">Serial Port:</label>
					{#if loadingPorts}
						<div class="text-gray-500">Loading ports...</div>
					{:else if availablePorts.length === 0}
						<div class="text-red-500">No ports found</div>
					{:else}
						<select
							id="serialPort"
							bind:value={serialPort}
							class="w-64 rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							disabled={connected}
						>
							<option value="">-- Select a port --</option>
							{#each availablePorts as port}
								<option value={port.path}>
									{port.path}
									{port.manufacturer ? ` (${port.manufacturer})` : ''}
								</option>
							{/each}
						</select>
					{/if}
				</div>

				<button
					onclick={loadAvailablePorts}
					class="rounded border border-gray-300 bg-white px-3 py-1 text-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50"
					disabled={connected || loadingPorts}
				>
					{loadingPorts ? 'Loading...' : 'Refresh Ports'}
				</button>
			</div>
		</div>
	{/if}

	{#if portChangeDetected}
		<div
			class="fixed bottom-4 right-4 z-20 max-w-md rounded-lg border-l-4 border-yellow-500 bg-yellow-50 p-4 shadow-lg"
		>
			<div class="flex items-start">
				<div class="flex-shrink-0">
					<svg class="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
						<path
							fill-rule="evenodd"
							d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
							clip-rule="evenodd"
						/>
					</svg>
				</div>
				<div class="ml-3">
					<h3 class="text-sm font-medium text-yellow-800">Port Change Detected</h3>
					<div class="mt-2 text-sm text-yellow-700">
						<p>Device reconnected on port {serialPort}.</p>
						<p class="mt-1">Connection has been automatically maintained.</p>
					</div>
					<div class="mt-3">
						<button
							onclick={() => (portChangeDetected = false)}
							class="text-sm font-medium text-yellow-800 hover:text-yellow-500"
						>
							Dismiss
						</button>
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div class="flex flex-1 overflow-hidden">
		<div class="w-1/4 overflow-y-auto bg-white p-4 shadow-md">
			<CommandPanel {connected} onSendCommand={sendCommand} />
		</div>

		<div class="flex w-1/2 flex-col overflow-hidden bg-white p-4 shadow-md">
			<h2 class="mb-2 font-semibold text-gray-800">Visualization</h2>

			<!-- This wrapper is now a flex-1, relative box -->
			<div class="relative flex-1">
				<SensorVisualization data={{ sensorData }} isConnected={connected} />
			</div>
		</div>

		<div class="flex w-1/4 flex-col overflow-hidden bg-white p-4 shadow-md">
			<h2 class="mb-2 font-semibold text-gray-800">System Logs</h2>
			<LogViewer {logs} />
		</div>
	</div>

	<footer class="bg-white p-2 text-center text-sm text-gray-600 shadow-inner">
		Motion Capture Control Panel &copy; 2025
	</footer>
</div>
