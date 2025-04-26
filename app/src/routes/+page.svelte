<script>
	import { onMount, onDestroy } from 'svelte';
	import CommandPanel from '$lib/components/CommandPanel.svelte';
	import LogViewer from '$lib/components/LogViewer.svelte';
	import SensorVisualization from '$lib/components/visualization/SensorVisualization.svelte';
	import DebugInfo from '$lib/components/DebugInfo.svelte';
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

	// Streaming status
	let isStreaming = $state(false);
	let lastDataTimestamp = $state(0);
	let dataPacketsReceived = $state(0);

	// Data storage
	let logs = $state([]);
	let sensorData = $state({});

	// Initialize tracking variables at component level
	let packetTimestamps = []; // Array to store recent packet timestamps
	let lastRate = 0; // Last calculated rate for change detection
	let rateHistory = []; // Historical rates for trend analysis
	const MAX_HISTORY = 30; // Number of rate values to keep for trending

	// Last sequence number for checking continuity
	let lastSequence = -1;
	let outOfOrderCount = 0;
	let missedPackets = 0;

	// Clear logs handler
	function clearLogs() {
		logs = [];
	}

	/**
	 * Enhanced function to track data reception with detailed metrics
	 * @param {Object} data - Optional data packet for inspection
	 */
	function trackDataReception(data = null) {
		const now = performance.now();

		// Store timestamp for rate calculation
		packetTimestamps.push(now);

		// Keep only recent packets in the window (5 second window)
		const windowSize = 5000; // 5 seconds
		while (packetTimestamps.length > 0 && now - packetTimestamps[0] > windowSize) {
			packetTimestamps.shift();
		}

		// Calculate current rate (packets per second)
		const currentRate = packetTimestamps.length / (windowSize / 1000);

		// Store rate for trend analysis
		rateHistory.push(currentRate);
		if (rateHistory.length > MAX_HISTORY) {
			rateHistory.shift();
		}

		// Calculate trend (increasing, decreasing, steady)
		let trend = 'steady';
		if (rateHistory.length > 5) {
			const recentAvg = rateHistory.slice(-5).reduce((sum, rate) => sum + rate, 0) / 5;
			const olderAvg = rateHistory.slice(0, 5).reduce((sum, rate) => sum + rate, 0) / 5;
			const difference = recentAvg - olderAvg;

			if (difference > 2) trend = 'increasing';
			else if (difference < -2) trend = 'decreasing';
		}

		// Log significant rate changes or every 50 packets
		if (Math.abs(currentRate - lastRate) > 5 || dataPacketsReceived % 50 === 0) {
			console.log(`Data rate: ${currentRate.toFixed(1)} packets/sec (${trend})`);
			lastRate = currentRate;

			// Only call setDataRate if it exists
			if (motionStore && typeof motionStore.setDataRate === 'function') {
				motionStore.setDataRate(currentRate);
			}
		}

		// Increment the counter
		dataPacketsReceived++;

		// Check sequence number if data is provided
		if (data && data.sequence !== undefined) {
			checkSequence(data.sequence);
		}

		// Update timestamp
		lastDataTimestamp = Date.now();

		// Return metrics for optional use
		return {
			rate: currentRate,
			trend: trend,
			count: dataPacketsReceived,
			packetTimestamps: packetTimestamps.length
		};
	}

	/**
	 * Check sequence number continuity
	 * @param {number} sequence - Current sequence number
	 */
	function checkSequence(sequence) {
		if (lastSequence === -1) {
			// First packet, just store sequence
			lastSequence = sequence;
			return;
		}

		// Check for expected next sequence
		const expectedSequence = (lastSequence + 1) % 65536; // Wrap at 16-bit

		if (sequence !== expectedSequence) {
			// Out of order or missed packets
			if (sequence > expectedSequence) {
				// Missed packets
				const missed = sequence - expectedSequence;
				if (missed < 1000) {
					// Sanity check for reasonable values
					missedPackets += missed;
					if (missed > 10) {
						console.warn(`Missing ${missed} packets between ${lastSequence} and ${sequence}`);
					}
				}
			} else {
				// Out of order packet (earlier than expected)
				outOfOrderCount++;
				if (outOfOrderCount % 10 === 1) {
					// Log occasionally to avoid spam
					console.warn(`Out-of-order packet: ${sequence} after ${lastSequence}`);
				}
			}
		}

		// Update last sequence
		lastSequence = sequence;
	}

	// Function to parse sensor data from raw message
	function parseDataMessage(message) {
		if (!message) return null;

		try {
			// Extract the QUAT_DATA part - handle both formats
			let dataStart = message.indexOf('QUAT_DATA:');
			if (dataStart === -1) return null;

			// Handle different formats - add 'QUAT_DATA:' length to get to the data
			const prefix = 'QUAT_DATA:';
			if (message.includes('DATA:QUAT_DATA:')) {
				dataStart = message.indexOf('DATA:QUAT_DATA:') + 5; // Skip 'DATA:' prefix
			}

			// Extract the clean data portion and TRIM any leading whitespace
			const cleanMessage = message.substring(dataStart + prefix.length).trim();

			// Debug output to see what we're parsing
			console.log(
				'Parsing data:',
				cleanMessage.substring(0, Math.min(50, cleanMessage.length)) + '...'
			);

			const result = {};

			// Parse with simple string manipulation instead of regex
			// Extract sequence number
			if (cleanMessage.includes('SEQ:')) {
				const seqPart = cleanMessage.substring(cleanMessage.indexOf('SEQ:') + 4);
				const seqEnd = seqPart.indexOf(',');
				if (seqEnd > 0) {
					result.sequence = parseInt(seqPart.substring(0, seqEnd), 10);
				}
			}

			// Extract sensor data with simple string manipulation
			let currentPos = 0;
			while ((currentPos = cleanMessage.indexOf('S', currentPos)) !== -1) {
				// Skip if not a valid sensor format (must be followed by a digit)
				if (currentPos + 1 >= cleanMessage.length || !/\d/.test(cleanMessage[currentPos + 1])) {
					currentPos++;
					continue;
				}

				// Find format S0:[w,x,y,z]
				const sensorIdEnd = cleanMessage.indexOf(':', currentPos);
				if (sensorIdEnd === -1) break;

				const sensorId = cleanMessage.substring(currentPos + 1, sensorIdEnd);

				const valuesStart = cleanMessage.indexOf('[', sensorIdEnd);
				if (valuesStart === -1) break;

				const valuesEnd = cleanMessage.indexOf(']', valuesStart);
				if (valuesEnd === -1) break;

				const valuesStr = cleanMessage.substring(valuesStart + 1, valuesEnd);
				const values = valuesStr.split(',').map((v) => parseFloat(v.trim()));

				if (values.length === 4) {
					result[`S${sensorId}`] = values;
				}

				currentPos = valuesEnd + 1;
			}

			// Debug to see what we extracted
			const sensorCount = Object.keys(result).filter((k) => k.startsWith('S')).length;
			console.log(`Extracted ${sensorCount} sensors and sequence ${result.sequence}`);

			// Validate we have actual data before returning
			if (sensorCount > 0 || result.sequence !== undefined) {
				return result;
			} else {
				console.log('No valid sensor data found in message');
				return null;
			}
		} catch (error) {
			console.error('Error parsing data message:', error);
			return null;
		}
	}

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
				isStreaming = false; // Reset streaming status on disconnect
				dataPacketsReceived = 0; // Reset packet counter
				portChangeDetected = false;
				motionStore.setConnected(false);
			})
			.catch((error) => {
				alert('Disconnect error: ' + (error.message || error));
			});
	}

	// Function to initialize WebSocket with performance optimizations
	function initWebSocket() {
		// Clean up existing socket properly before creating a new one
		cleanupWebSocket();

		// Protect against multiple simultaneous connection attempts
		if (socket) {
			console.warn('WebSocket connection already in progress');
			return;
		}

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const wsUrl = `${protocol}//${window.location.host}/api/ws`;

		console.log(`Connecting to WebSocket at ${wsUrl}`);

		try {
			socket = new WebSocket(wsUrl);

			// Critical for reducing latency: Use arraybuffer for more efficient binary handling
			socket.binaryType = 'arraybuffer';

			// Set a connection timeout
			const connectionTimeout = setTimeout(() => {
				if (socket && socket.readyState !== WebSocket.OPEN) {
					console.warn('WebSocket connection timeout');
					cleanupWebSocket();

					if (connected) {
						addLog('WebSocket connection timed out. Trying again...', LOG_WARNING);
						setTimeout(initWebSocket, 3000);
					}
				}
			}, 10000);

			socket.onopen = () => {
				console.log('WebSocket connected at', Date.now());
				clearTimeout(connectionTimeout);
				addLog('WebSocket connection established');
				motionStore.setConnected(true);

				// Request no buffering/compression for real-time data
				try {
					socket.send(
						JSON.stringify({
							type: 'config',
							settings: {
								noDelay: true,
								binaryType: 'arraybuffer'
							}
						})
					);
				} catch (e) {
					console.error('Error requesting real-time configuration:', e);
				}
			};

			// For real-time visualization, use a separate variable to track times between sensor updates
			let lastSensorUpdateTime = performance.now();
			let frameCounter = 0;
			let sensorUpdateIntervals = [];
			let reportTime = performance.now();

			// Animation frame management for smooth visualization
			let animFrameId = null;

			// Process and apply sensor data immediately when received
			// but render at optimal timing with requestAnimationFrame
			// Update the socket.onmessage handler to pass the data to trackDataReception

			socket.onmessage = (event) => {
				try {
					const data = JSON.parse(event.data);

					if (data.type === 'sensorData') {
						// Track timing between sensor updates
						const now = performance.now();
						const timeSinceLastUpdate = now - lastSensorUpdateTime;
						lastSensorUpdateTime = now;

						// Track update intervals for performance monitoring
						sensorUpdateIntervals.push(timeSinceLastUpdate);
						if (sensorUpdateIntervals.length > 100) {
							sensorUpdateIntervals.shift();
						}

						// Count frames for FPS calculation
						frameCounter++;

						// Report stats every second
						if (now - reportTime > 1000) {
							// Calculate average, min, max update intervals
							const avgInterval =
								sensorUpdateIntervals.reduce((sum, val) => sum + val, 0) /
								(sensorUpdateIntervals.length || 1);
							const minInterval = Math.min(...sensorUpdateIntervals);
							const maxInterval = Math.max(...sensorUpdateIntervals);

							console.log(
								`Sensor updates: ${frameCounter}fps, Intervals: avg=${avgInterval.toFixed(1)}ms, ` +
									`min=${minInterval.toFixed(1)}ms, max=${maxInterval.toFixed(1)}ms`
							);

							// Reset counters
							frameCounter = 0;
							reportTime = now;
						}

						// Extract sensor data - keep variable names consistent
						let extractedData;
						if (data.data && data.data.sensorData) {
							extractedData = data.data.sensorData;
						} else if (data.data) {
							extractedData = data.data;
						} else {
							extractedData = data;
						}

						// Update state immediately - important for real-time
						if (extractedData && typeof extractedData === 'object') {
							if (!isStreaming) isStreaming = true;

							// Pass the actual sensor data to trackDataReception
							trackDataReception(extractedData);

							// Update sensor data immediately
							sensorData = extractedData;
							lastDataTimestamp = Date.now();

							// Update motion store for the visualization components
							motionStore.updateSensorData(extractedData);

							// Ensure visualization updates at next animation frame
							if (!animFrameId) {
								animFrameId = requestAnimationFrame(() => {
									// Allow visualization components to update
									animFrameId = null;
								});
							}
						}
					} else if (data.type === 'log') {
						// Handle port change detection
						if (data.message && data.message.includes('reconnected to new port')) {
							handlePortChange(data.message);
						}

						// Detect streaming status from logs
						if (
							data.message &&
							(data.message.includes('Sensor reading started') ||
								data.message.includes('UDP server started for sensor data') ||
								data.message.includes('UDP data streaming started'))
						) {
							isStreaming = true;
							lastDataTimestamp = Date.now();
							addLog('Streaming started successfully', LOG_INFO);
						} else if (
							data.message &&
							(data.message.includes('Sensor reading stopped') ||
								data.message.includes('UDP server stopped') ||
								data.message.includes('stopped.') ||
								data.message.includes('not running') ||
								data.message.includes('Command sent: X'))
						) {
							isStreaming = false;
							addLog('Streaming stopped', LOG_INFO);
						}

						// Handle QUAT_DATA in logs
						if (data.message && data.message.includes('QUAT_DATA:')) {
							const parsedData = parseDataMessage(data.message);
							if (parsedData) {
								// Pass the parsed data to trackDataReception
								trackDataReception(parsedData);

								// Update sensor data
								sensorData = parsedData;
								lastDataTimestamp = Date.now();

								// Update motion store for visualization
								motionStore.updateSensorData(parsedData);
							}
						}

						// Add log to list
						if (data.message) {
							addLog(data.message);
						}
					} else if (data.type === 'pong') {
						// Calculate round-trip time for monitoring
						const rtt = performance.now() - data.timestamp;
						// Only log slow RTTs
						if (rtt > 100) {
							console.warn(`WebSocket RTT: ${Math.round(rtt)}ms`);
						}
					}
				} catch (error) {
					console.error('Error parsing WebSocket message:', error);
				}
			};

			socket.onerror = (error) => {
				console.error('WebSocket error:', error);
				addLog('WebSocket error occurred', LOG_ERROR);
			};
		} catch (error) {
			console.error('Failed to create WebSocket:', error);
			addLog(`WebSocket connection error: ${error.message}`, LOG_ERROR);
			socket = null;
		}
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

		// Update streaming state based on the command
		if (command === 'S') {
			// Set streaming state immediately for better UI responsiveness
			isStreaming = true;
			dataPacketsReceived = 0; // Reset packet counter
			lastDataTimestamp = Date.now();
			addLog('Sending command to start streaming...', LOG_INFO);
		} else if (command === 'X') {
			// Immediately mark streaming as stopped
			isStreaming = false;
			addLog('Sending command to stop streaming...', LOG_INFO);
		}

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

	// Function to check for streaming timeout
	function checkStreamingTimeout() {
		if (isStreaming && lastDataTimestamp > 0) {
			const now = Date.now();
			const timeSinceLastData = now - lastDataTimestamp;

			// If no data for 10 seconds while streaming is supposedly active
			if (timeSinceLastData > 10000) {
				isStreaming = false;
				addLog('Streaming appears to have stopped (no data received for 10 seconds)', LOG_INFO);
			}
		}
	}

	// Function to properly clean up WebSocket connections
	function cleanupWebSocket() {
		if (socket) {
			// Remove all event listeners to prevent memory leaks
			socket.onopen = null;
			socket.onmessage = null;
			socket.onclose = null;
			socket.onerror = null;

			// Only attempt to close if the socket isn't already closed
			if (socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
				try {
					socket.close();
				} catch (e) {
					console.error('Error closing socket during cleanup:', e);
				}
			}
			socket = null;
		}
	}

	// Settings
	let serialPort = $state('');
	let originalPort = $state('');
	let portChangeDetected = $state(false);
	let showConfiguration = $state(true);
	let availablePorts = $state([]);
	let loadingPorts = $state(false);

	onMount(() => {
		loadAvailablePorts();

		// Set up interval to check if streaming has silently stopped
		const interval = setInterval(checkStreamingTimeout, 1000);

		return () => {
			clearInterval(interval);
			cleanupWebSocket();
		};
	});

	onDestroy(() => {
		cleanupWebSocket();
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

						{#if connected && isStreaming}
							<span
								class="ml-2 flex items-center rounded bg-green-600 px-1.5 py-0.5 text-xs font-medium text-white"
							>
								<span class="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-white"></span>
								Streaming {dataPacketsReceived > 0 ? `(${dataPacketsReceived} packets)` : ''}
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
			<CommandPanel {connected} {isStreaming} onSendCommand={sendCommand} />
		</div>

		<div class="flex w-1/2 flex-col overflow-hidden bg-white p-4 shadow-md">
			<h2 class="mb-2 font-semibold text-gray-800">Visualization</h2>

			<!-- This wrapper is now a flex-1, relative box -->
			<div class="relative flex-1">
				<SensorVisualization data={sensorData} isConnected={connected} />
				<DebugInfo {isStreaming} {sensorData} {dataPacketsReceived} />
			</div>
		</div>

		<div class="flex w-1/4 flex-col overflow-hidden bg-white p-4 shadow-md">
			<h2 class="mb-2 font-semibold text-gray-800">System Logs</h2>
			<LogViewer {logs} onClearLogs={clearLogs} />
		</div>
	</div>

	<footer class="bg-white p-2 text-center text-sm text-gray-600 shadow-inner">
		Motion Capture Control Panel &copy; 2025
	</footer>
</div>
