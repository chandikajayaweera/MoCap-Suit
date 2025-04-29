#!/usr/bin/env node
import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import figures from 'figures';
import { createSpinner } from 'nanospinner';

// Import modules
import ConnectionManager from './modules/connection-manager.js';
import DataProcessor from './modules/data-processor.js';
import Logger from './modules/logger.js';
import UIManager from './modules/ui-manager.js';
import BenchmarkManager from './modules/benchmark-manager.js';

// Get directory path in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_VERSION = '1.0.0';

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
	fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Main Application Class with Terminal UI Dashboard
 */
class MocapCLI {
	constructor() {
		// Initialize managers as singletons
		this.connection = ConnectionManager.getInstance();
		this.dataProcessor = DataProcessor.getInstance();
		this.logger = Logger.getInstance();
		this.ui = UIManager.getInstance();
		this.benchmark = BenchmarkManager.getInstance(this.connection, this.logger);

		// Set up state
		this.statsUpdateInterval = null;
		this.setupShutdownHandler();
	}

	/**
	 * Initialize the application
	 */
	async init() {
		// Show welcome screen
		await this.ui.showWelcome();

		// Initialize the dashboard
		this.ui.initDashboard();

		// Set up UI event handlers
		this.setupCommandHandlers();

		// Set up data handling
		this.setupDataHandling();

		// Set up exit handler
		this.ui.onExit(() => this.exitApplication());

		// Start status update interval
		this.startStatusUpdates();
	}

	/**
	 * Set up data handling
	 */
	setupDataHandling() {
		// Set up data processing
		this.connection.onData((data) => this.dataProcessor.processData(data));

		// Set up log handling
		this.dataProcessor.onLog((message, level) => {
			this.ui.log(message, level || 'info');
		});

		// Set up streaming status changes
		this.dataProcessor.onStreaming((status) => {
			this.ui.updateStatus({ streaming: status });

			if (status) {
				this.ui.log('Streaming started', 'success');
				this.ui.showNotification('Streaming started', 'success');
			} else {
				this.ui.log('Streaming stopped', 'info');
				this.ui.showNotification('Streaming stopped', 'info');
			}
		});

		// Set up data updates
		this.dataProcessor.onData((data) => {
			if (data && data.sensorData) {
				const activeSensors = Object.keys(data.sensorData).filter(
					(key) => key.startsWith('S') && Array.isArray(data.sensorData[key])
				).length;

				this.ui.updateStatus({
					packetCount: data.packetCount || 0,
					activeSensors: activeSensors,
					missedPackets: data.missedPackets || 0,
					sequence: data.sensorData.sequence || 0
				});
			}
		});
	}

	/**
	 * Set up command handlers for UI
	 */
	setupCommandHandlers() {
		const handlers = {
			connect: async () => {
				await this.handleConnect();
			},
			disconnect: async () => {
				await this.handleDisconnect();
			},
			start_stream: async () => {
				await this.handleStartStreaming();
			},
			stop_stream: async (callback) => {
				await this.handleStopStreaming();
				if (callback) callback();
			},
			check_sensors: async () => {
				await this.handleCheckSensors();
			},
			init_sensors: async () => {
				await this.handleInitSensors();
			},
			restart_node: async () => {
				await this.handleRestartNode();
			},
			benchmark: async () => {
				await this.handleBenchmark();
			},
			about: () => {
				this.ui.showAbout();
			}
		};

		this.ui.registerCommandHandlers(handlers);
	}

	/**
	 * Start periodic status updates
	 */
	startStatusUpdates() {
		// Clear any existing interval
		if (this.statsUpdateInterval) {
			clearInterval(this.statsUpdateInterval);
		}

		// Update every second
		this.statsUpdateInterval = setInterval(() => {
			// Get current stats
			const stats = this.dataProcessor.getStats();

			// Update UI
			this.ui.updateStatus({
				dataRate: stats.rate,
				packetCount: stats.packetCount,
				streaming: this.dataProcessor.isStreaming()
			});
		}, 1000);
	}

	/**
	 * Handle connecting to a device
	 */
	async handleConnect() {
		const hideSpinner = this.ui.showSpinner('Scanning for devices...');

		try {
			const ports = await SerialPort.list();

			hideSpinner();

			if (ports.length === 0) {
				this.ui.showNotification('No devices found', 'warning');
				this.ui.log('No devices found', 'warning');
				return;
			}

			// Show port selector
			const portPath = await this.ui.showPortSelector(ports);

			if (portPath) {
				const connectSpinner = this.ui.showSpinner(`Connecting to ${portPath}...`);

				try {
					const success = await this.connection.connect(portPath);

					if (success) {
						connectSpinner('Connected successfully', 'success');
						this.ui.log(`Connected to ${portPath}`, 'success');
						this.ui.updateStatus({
							connected: true,
							portName: portPath
						});
					} else {
						connectSpinner('Connection failed', 'error');
						this.ui.log(`Failed to connect to ${portPath}`, 'error');
					}
				} catch (error) {
					connectSpinner(`Connection error: ${error.message}`, 'error');
					this.ui.log(`Connection error: ${error.message}`, 'error');
				}
			}
		} catch (error) {
			hideSpinner();
			this.ui.log(`Error scanning ports: ${error.message}`, 'error');
			this.ui.showNotification(`Error scanning ports: ${error.message}`, 'error');
		}
	}

	/**
	 * Handle disconnecting from a device
	 */
	async handleDisconnect() {
		// Check if we're streaming first
		if (this.dataProcessor.isStreaming()) {
			this.ui.showDialog(
				'Streaming Active',
				'Streaming is active. Do you want to stop streaming before disconnecting?',
				[
					{
						text: 'Yes',
						callback: async () => {
							await this.handleStopStreaming();
							await this.performDisconnect();
						}
					},
					{
						text: 'No',
						callback: async () => {
							await this.performDisconnect();
						}
					},
					{
						text: 'Cancel',
						callback: () => {
							this.ui.screen.render();
						}
					}
				]
			);
		} else {
			await this.performDisconnect();
		}
	}

	/**
	 * Perform actual disconnection
	 */
	async performDisconnect() {
		const hideSpinner = this.ui.showSpinner('Disconnecting...');

		try {
			await this.connection.disconnect();
			hideSpinner('Disconnected successfully', 'success');
			this.ui.log('Disconnected from device', 'info');
			this.ui.updateStatus({
				connected: false,
				portName: 'None',
				streaming: false,
				activeSensors: 0
			});
		} catch (error) {
			hideSpinner(`Disconnect error: ${error.message}`, 'error');
			this.ui.log(`Disconnect error: ${error.message}`, 'error');
		}
	}

	/**
	 * Handle starting streaming
	 */
	async handleStartStreaming() {
		const hideSpinner = this.ui.showSpinner('Starting data streaming...');

		try {
			const success = await this.connection.sendCommand('S');

			if (success) {
				hideSpinner('Streaming started', 'success');
				// State is updated via callbacks
			} else {
				hideSpinner('Failed to start streaming', 'error');
				this.ui.log('Failed to start streaming', 'error');
			}
		} catch (error) {
			hideSpinner(`Error starting streaming: ${error.message}`, 'error');
			this.ui.log(`Error starting streaming: ${error.message}`, 'error');
		}
	}

	/**
	 * Handle stopping streaming
	 */
	async handleStopStreaming() {
		const hideSpinner = this.ui.showSpinner('Stopping data streaming...');

		try {
			const success = await this.connection.sendCommand('X');

			if (success) {
				hideSpinner('Streaming stopped', 'success');
				// State is updated via callbacks
			} else {
				hideSpinner('Failed to stop streaming', 'error');
				this.ui.log('Failed to stop streaming', 'error');
			}
		} catch (error) {
			hideSpinner(`Error stopping streaming: ${error.message}`, 'error');
			this.ui.log(`Error stopping streaming: ${error.message}`, 'error');
		}
	}

	/**
	 * Handle checking sensors
	 */
	async handleCheckSensors() {
		const hideSpinner = this.ui.showSpinner('Checking sensors...');

		try {
			const success = await this.connection.sendCommand('C');

			if (success) {
				hideSpinner('Sensor check command sent', 'success');
				this.ui.log('Sensor check command sent. Check logs for results.', 'info');
			} else {
				hideSpinner('Failed to check sensors', 'error');
				this.ui.log('Failed to check sensors', 'error');
			}
		} catch (error) {
			hideSpinner(`Error checking sensors: ${error.message}`, 'error');
			this.ui.log(`Error checking sensors: ${error.message}`, 'error');
		}
	}

	/**
	 * Handle initializing sensors
	 */
	async handleInitSensors() {
		const hideSpinner = this.ui.showSpinner('Initializing sensors...');

		try {
			const success = await this.connection.sendCommand('I');

			if (success) {
				hideSpinner('Sensor initialization command sent', 'success');
				this.ui.log('Sensor initialization command sent. This may take a moment...', 'info');
			} else {
				hideSpinner('Failed to initialize sensors', 'error');
				this.ui.log('Failed to initialize sensors', 'error');
			}
		} catch (error) {
			hideSpinner(`Error initializing sensors: ${error.message}`, 'error');
			this.ui.log(`Error initializing sensors: ${error.message}`, 'error');
		}
	}

	/**
	 * Handle restarting node
	 */
	async handleRestartNode() {
		this.ui.showDialog('Confirm Restart', 'Are you sure you want to restart the node?', [
			{
				text: 'Yes',
				callback: async () => {
					const hideSpinner = this.ui.showSpinner('Restarting node...');

					try {
						const success = await this.connection.sendCommand('N');

						if (success) {
							hideSpinner('Restart command sent', 'success');
							this.ui.log('Node restart command sent', 'info');

							// Update status
							this.ui.updateStatus({ streaming: false });
						} else {
							hideSpinner('Failed to restart node', 'error');
							this.ui.log('Failed to restart node', 'error');
						}
					} catch (error) {
						hideSpinner(`Error restarting node: ${error.message}`, 'error');
						this.ui.log(`Error restarting node: ${error.message}`, 'error');
					}
				}
			},
			{
				text: 'No',
				callback: () => {
					this.ui.screen.render();
				}
			}
		]);
	}

	/**
	 * Handle running benchmark
	 */
	async handleBenchmark() {
		// Show benchmark settings dialog
		this.ui.showBenchmarkSettings(async (duration) => {
			if (duration) {
				const hideSpinner = this.ui.showSpinner(`Preparing benchmark test (${duration}s)...`);

				try {
					// First stop any active streaming
					if (this.dataProcessor.isStreaming()) {
						await this.connection.sendCommand('X');
						await new Promise((resolve) => setTimeout(resolve, 1000));
					}

					hideSpinner();

					// Run benchmark
					const benchmarkResults = await this.runBenchmark(duration);

					// Show results
					if (benchmarkResults) {
						this.ui.showBenchmarkResults(benchmarkResults);
					}
				} catch (error) {
					hideSpinner(`Benchmark error: ${error.message}`, 'error');
					this.ui.log(`Benchmark error: ${error.message}`, 'error');
				}
			}
		});
	}

	/**
	 * Run benchmark test with progress updates in UI
	 */
	async runBenchmark(duration) {
		// Create dialog for benchmark progress
		const progressBox = blessed.box({
			top: 'center',
			left: 'center',
			width: '70%',
			height: 'shrink',
			tags: true,
			border: {
				type: 'line',
				fg: 'cyan'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'cyan'
				}
			},
			padding: {
				top: 1,
				right: 2,
				bottom: 1,
				left: 2
			}
		});

		// Add title
		progressBox.append(
			blessed.text({
				top: 0,
				left: 'center',
				content: '{bold}{cyan-fg}BENCHMARK IN PROGRESS{/}{/bold}',
				tags: true
			})
		);

		// Add progress bar
		const progressBar = blessed.progressbar({
			top: 3,
			left: 0,
			width: '100%',
			height: 1,
			orientation: 'horizontal',
			pch: '█',
			style: {
				bar: {
					bg: 'cyan'
				},
				bg: 'black'
			}
		});

		// Add progress text
		const progressText = blessed.text({
			top: 2,
			left: 'center',
			content: `0/${duration} seconds (0%)`,
			tags: true
		});

		// Add stats text
		const statsText = blessed.text({
			top: 5,
			left: 0,
			width: '100%',
			content: 'Starting benchmark...',
			tags: true
		});

		progressBox.append(progressBar);
		progressBox.append(progressText);
		progressBox.append(statsText);

		// Add to screen
		this.ui.screen.append(progressBox);
		this.ui.screen.render();

		try {
			// Reset processor stats
			this.dataProcessor.reset();

			// Start streaming
			await this.connection.sendCommand('S');

			// Wait for streaming to start
			const streamingStarted = await new Promise((resolve) => {
				const checkInterval = setInterval(() => {
					if (this.dataProcessor.isStreaming()) {
						clearInterval(checkInterval);
						resolve(true);
					}
				}, 100);

				// Timeout after 5 seconds
				setTimeout(() => {
					clearInterval(checkInterval);
					resolve(false);
				}, 5000);
			});

			if (!streamingStarted) {
				throw new Error('Streaming failed to start for benchmark');
			}

			// Set starting time
			const startTime = Date.now();
			let lastUpdateTime = startTime;

			// Set up progress updates
			const rateData = [];

			const updateInterval = setInterval(() => {
				// Calculate elapsed time
				const now = Date.now();
				const elapsed = Math.floor((now - startTime) / 1000);
				const remainingTime = Math.max(0, duration - elapsed);

				// Calculate progress
				const progressPct = Math.min(100, Math.floor((elapsed / duration) * 100));

				// Get current stats
				const stats = this.dataProcessor.getStats();
				rateData.push(stats.rate);

				// Update progress display
				progressBar.setProgress(progressPct);
				progressText.setContent(`${elapsed}/${duration} seconds (${progressPct}%)`);

				// Update stats text
				statsText.setContent(
					`{bold}Packets:{/bold} ${stats.packetCount.toLocaleString()}   ` +
						`{bold}Rate:{/bold} ${stats.rate.toFixed(1)} packets/sec\n` +
						`{bold}Missing:{/bold} ${stats.missedPackets}   ` +
						`{bold}Active Sensors:{/bold} ${stats.activeSensors}`
				);

				// Render updates
				this.ui.screen.render();

				// Stop if duration reached
				if (elapsed >= duration) {
					clearInterval(updateInterval);
				}

				// Save last update time
				lastUpdateTime = now;
			}, 1000);

			// Wait for the benchmark to complete
			await new Promise((resolve) => setTimeout(resolve, duration * 1000 + 500));

			// Make sure the interval is stopped
			clearInterval(updateInterval);

			// Stop streaming
			await this.connection.sendCommand('X');

			// Get final stats
			const endTime = Date.now();
			const stats = this.dataProcessor.getStats();

			// Compile results
			const benchmarkResults = {
				duration: (endTime - startTime) / 1000,
				totalPackets: stats.packetCount,
				overallRate: stats.rate,
				minRate: Math.min(...rateData) || 0,
				maxRate: Math.max(...rateData) || 0,
				avgRate: rateData.reduce((sum, rate) => sum + rate, 0) / (rateData.length || 1),
				missedPackets: stats.missedPackets,
				outOfOrder: stats.outOfOrderPackets,
				lossRate:
					stats.packetCount > 0
						? (stats.missedPackets / (stats.packetCount + stats.missedPackets)) * 100
						: 0,
				logFile: 'benchmark_results.log'
			};

			// Clean up UI
			progressBox.detach();
			this.ui.screen.render();

			return benchmarkResults;
		} catch (error) {
			progressBox.detach();
			this.ui.screen.render();
			throw error;
		}
	}

	/**
	 * Exit the application
	 */
	async exitApplication() {
		// Clear any intervals
		if (this.statsUpdateInterval) {
			clearInterval(this.statsUpdateInterval);
		}

		// Disconnect if connected
		if (this.connection.isConnected()) {
			// Stop streaming if active
			if (this.dataProcessor.isStreaming()) {
				try {
					await this.connection.sendCommand('X');
					await new Promise((resolve) => setTimeout(resolve, 500));
				} catch (e) {
					// Ignore errors during shutdown
				}
			}

			try {
				await this.connection.disconnect();
			} catch (e) {
				// Ignore errors during shutdown
			}
		}

		// Clean up UI
		this.ui.destroy();

		// Show goodbye message
		console.clear();
		console.log(chalk.green(figlet.textSync('Thank You!', { font: 'Standard' })));
		console.log(chalk.cyan('Motion Capture CLI Tool closed successfully.'));

		// Exit process
		process.exit(0);
	}

	/**
	 * Set up shutdown handler
	 */
	setupShutdownHandler() {
		// Ensure process.stdin is properly reset on exit
		const cleanup = async () => {
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(false);
			}
			process.stdin.pause();

			// Clear any intervals
			if (this.statsUpdateInterval) {
				clearInterval(this.statsUpdateInterval);
			}

			// Clean up connection
			if (this.connection.isConnected()) {
				await this.connection.disconnect();
			}

			// Destroy UI
			if (this.ui) {
				this.ui.destroy();
			}

			process.exit(0);
		};

		// Handle termination signals
		process.on('SIGINT', cleanup);
		process.on('SIGTERM', cleanup);
	}
}

// Import these here to avoid circular dependencies
import blessed from 'blessed';

// Run application
try {
	const app = new MocapCLI();
	app.init();
} catch (error) {
	console.error(`\n${chalk.red(figures.cross)} Fatal error: ${error.message}`);
	process.exit(1);
}
