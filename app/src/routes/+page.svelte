<script>
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	// UI Components
	import CommandPanel from '$lib/components/CommandPanel.svelte';
	import LogViewer from '$lib/components/LogViewer.svelte';
	import SensorVisualization from '$lib/components/visualization/SensorVisualization.svelte';
	import DebugInfo from '$lib/components/DebugInfo.svelte';

	// Services
	import {
		connect,
		disconnect,
		sendCommand,
		loadAvailablePorts
	} from '$lib/services/connectionService.js';

	// Stores
	import * as motionStore from '$lib/stores/motionStore.js';
	import {
		connected,
		connecting,
		serialPort,
		availablePorts,
		loadingPorts,
		portChangeDetected,
		isStreaming,
		dataPacketsReceived,
		logs,
		clearLogs,
		setSerialPort,
		setAvailablePorts,
		setLoadingPorts,
		setPortChangeDetected,
		sensorData
	} from '$lib/stores/connectionStore.js';

	// UI state with Svelte 5 $state rune
	let showConfiguration = $state(true);

	// Debug store updates using $effect from Svelte 5
	$effect(() => {
		// Using $sensorData to access the store value
		if ($sensorData && Object.keys($sensorData).length > 0) {
			// Type-safe check for sequence property
			if ('sequence' in $sensorData && typeof $sensorData.sequence === 'number') {
				// Log occasionally for monitoring
				if ($sensorData.sequence % 100 === 0) {
					console.log(`Page sensor data updated: seq=${$sensorData.sequence}`);
				}
			}
		}
	});

	// Handle connection
	async function handleConnect() {
		if ($connecting || $connected) return;

		if (!$serialPort) {
			alert('Please select a serial port first');
			return;
		}

		try {
			await connect($serialPort);
		} catch (error) {
			alert('Connection error: ' + (error.message || error));
		}
	}

	// Handle disconnection
	async function handleDisconnect() {
		if (!$connected) return;

		try {
			await disconnect();
		} catch (error) {
			alert('Disconnect error: ' + (error.message || error));
		}
	}

	// Handle command
	function handleCommand(command) {
		return sendCommand(command);
	}

	// Fetch available ports
	async function fetchPorts() {
		setLoadingPorts(true);
		try {
			const ports = await loadAvailablePorts();
			setAvailablePorts(ports);

			// Update port selection logic
			if ($portChangeDetected && $serialPort) {
				const newPortInList = ports.some((p) => p.path === $serialPort);
				if (!newPortInList && ports.length > 0) {
					setSerialPort(ports[0].path);
				}
			} else if (!$serialPort && ports.length > 0) {
				setSerialPort(ports[0].path);
			}
		} catch (error) {
			console.error('Error fetching ports:', error);
		} finally {
			setLoadingPorts(false);
		}
	}

	// Check streaming timeout periodically
	function checkStreamingTimeout() {
		let lastTimestamp = 0;

		return setInterval(() => {
			if ($isStreaming && lastTimestamp > 0) {
				const now = Date.now();
				const timeSinceLastData = now - lastTimestamp;

				// If no data for 10 seconds while streaming is supposedly active
				if (timeSinceLastData > 10000) {
					isStreaming.set(false);
					logs.update((currentLogs) => [
						...currentLogs,
						{
							timestamp: new Date(),
							message: 'Streaming appears to have stopped (no data received for 10 seconds)'
						}
					]);
				}
			}
		}, 1000);
	}

	onMount(() => {
		fetchPorts();

		// Set up interval to check if streaming has silently stopped
		const interval = checkStreamingTimeout();

		return () => {
			clearInterval(interval);
		};
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

				{#if $connected}
					<button
						onclick={handleDisconnect}
						class="rounded bg-red-600 px-3 py-1.5 text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-opacity-75"
					>
						Disconnect
					</button>
				{:else}
					<button
						onclick={handleConnect}
						class="rounded bg-green-600 px-3 py-1.5 text-white transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-opacity-75 disabled:bg-green-400"
						disabled={$connecting}
					>
						{$connecting ? 'Connecting...' : 'Connect'}
					</button>
				{/if}

				<div class="flex items-center">
					<span class="mr-2 hidden sm:inline">Status:</span>
					<div class="flex items-center rounded bg-white/20 px-2 py-1">
						<span
							class="mr-1.5 inline-block h-3 w-3 rounded-full"
							class:bg-green-400={$connected}
							class:bg-red-400={!$connected}
						></span>
						<span class="text-sm font-medium">{$connected ? 'Connected' : 'Disconnected'}</span>

						{#if $connected && $isStreaming}
							<span
								class="ml-2 flex items-center rounded bg-green-600 px-1.5 py-0.5 text-xs font-medium text-white"
							>
								<span class="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-white"></span>
								Streaming {$dataPacketsReceived > 0 ? `(${$dataPacketsReceived} packets)` : ''}
							</span>
						{/if}
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
					{#if $loadingPorts}
						<div class="text-gray-500">Loading ports...</div>
					{:else if $availablePorts.length === 0}
						<div class="text-red-500">No ports found</div>
					{:else}
						<select
							id="serialPort"
							bind:value={$serialPort}
							class="w-64 rounded border border-gray-300 px-2 py-1 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
							disabled={$connected}
						>
							<option value="">-- Select a port --</option>
							{#each $availablePorts as port}
								<option value={port.path}>
									{port.path}
									{port.manufacturer ? ` (${port.manufacturer})` : ''}
								</option>
							{/each}
						</select>
					{/if}
				</div>

				<button
					onclick={fetchPorts}
					class="rounded border border-gray-300 bg-white px-3 py-1 text-sm transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-50"
					disabled={$connected || $loadingPorts}
				>
					{$loadingPorts ? 'Loading...' : 'Refresh Ports'}
				</button>
			</div>
		</div>
	{/if}

	{#if $portChangeDetected}
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
						<p>Device reconnected on port {$serialPort}.</p>
						<p class="mt-1">Connection has been automatically maintained.</p>
					</div>
					<div class="mt-3">
						<button
							onclick={() => setPortChangeDetected(false)}
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
			<CommandPanel
				connected={$connected}
				isStreaming={$isStreaming}
				onSendCommand={handleCommand}
			/>
		</div>

		<div class="flex w-1/2 flex-col overflow-hidden bg-white p-4 shadow-md">
			<h2 class="mb-2 font-semibold text-gray-800">Visualization</h2>

			<div class="relative flex-1">
				<SensorVisualization data={$sensorData} isConnected={$connected} />
				<DebugInfo
					isStreaming={$isStreaming}
					sensorData={$sensorData}
					dataPacketsReceived={$dataPacketsReceived}
				/>
			</div>
		</div>

		<div class="flex w-1/4 flex-col overflow-hidden bg-white p-4 shadow-md">
			<h2 class="mb-2 font-semibold text-gray-800">System Logs</h2>
			<LogViewer logs={$logs} onClearLogs={clearLogs} />
		</div>
	</div>

	<footer class="bg-white p-2 text-center text-sm text-gray-600 shadow-inner">
		Motion Capture Control Panel &copy; 2025
	</footer>
</div>
