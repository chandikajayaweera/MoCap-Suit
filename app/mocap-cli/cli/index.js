#!/usr/bin/env node
import { SerialPort } from 'serialport';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import figures from 'figures';
import { createSpinner } from 'nanospinner';
import boxen from 'boxen';
import { select, confirm, input } from '@inquirer/prompts';

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
 * Main Application Class
 */
class MocapCLI {
	constructor() {
		// Initialize managers as singletons
		this.connection = ConnectionManager.getInstance();
		this.dataProcessor = DataProcessor.getInstance();
		this.logger = Logger.getInstance();
		this.ui = UIManager.getInstance();
		this.benchmark = BenchmarkManager.getInstance(this.connection, this.logger);

		// Set up shutdown handler
		this.setupShutdownHandler();
	}

	/**
	 * Initialize the application
	 */
	async init() {
		// Set up data processing
		this.connection.onData((data) => this.dataProcessor.processData(data));
		this.dataProcessor.onLog((message) => this.logger.log(message));
		this.dataProcessor.onStreaming((status) => {
			if (status) this.logger.log('Streaming started', 'success');
			else this.logger.log('Streaming stopped', 'info');
		});

		// Show welcome screen
		await this.ui.showWelcome();

		// Start main menu loop
		await this.mainMenuLoop();
	}

	/**
	 * Main menu loop
	 */
	async mainMenuLoop() {
		while (true) {
			this.ui.clear();
			this.ui.showHeader();

			const action = await this.showAppropriateMenu();

			if (action === 'exit') {
				await this.exitApplication();
				break;
			}

			await this.handleMenuAction(action);
		}
	}

	/**
	 * Show appropriate menu based on connection state
	 */
	async showAppropriateMenu() {
		if (!this.connection.isConnected()) {
			return await this.ui.showDisconnectedMenu();
		} else {
			return await this.ui.showConnectedMenu(
				this.connection.getPortName(),
				this.dataProcessor.isStreaming(),
				this.logger.isDebugMode()
			);
		}
	}

	/**
	 * Handle menu action
	 */
	async handleMenuAction(action) {
		switch (action) {
			case 'connect':
				await this.handleConnect();
				break;

			case 'disconnect':
				await this.connection.disconnect();
				break;

			case 'scan':
				await this.scanPorts();
				break;

			case 'stream_start':
				await this.connection.sendCommand('S');
				break;

			case 'stream_stop':
				await this.connection.sendCommand('X');
				break;

			case 'check_sensors':
				await this.connection.sendCommand('C');
				break;

			case 'init_sensors':
				await this.connection.sendCommand('I');
				break;

			case 'ping':
				await this.connection.sendCommand('P');
				break;

			case 'restart_node':
				if (
					await confirm({ message: 'Are you sure you want to restart the node?', default: false })
				) {
					await this.connection.sendCommand('N');
				}
				break;

			case 'restart_receiver':
				if (
					await confirm({
						message: 'Are you sure you want to restart the receiver?',
						default: false
					})
				) {
					await this.connection.sendCommand('R');
					await this.connection.disconnect();
				}
				break;

			case 'debug_level':
				const level = await this.ui.showDebugLevelMenu();
				if (level) await this.connection.sendCommand(level);
				break;

			case 'toggle_debug':
				this.logger.toggleDebugMode();
				this.logger.log(`Debug mode ${this.logger.isDebugMode() ? 'enabled' : 'disabled'}`);
				break;

			case 'benchmark':
				await this.runBenchmark();
				break;

			case 'about':
				await this.ui.showAbout();
				break;
		}
	}

	/**
	 * Handle connection to device
	 */
	async handleConnect() {
		const portPath = await this.selectPort();
		if (portPath) {
			const spinner = createSpinner('Connecting...').start();
			const success = await this.connection.connect(portPath);

			if (success) {
				spinner.success({ text: `Connected to ${chalk.green(portPath)}` });
			} else {
				spinner.error({ text: `Failed to connect to ${chalk.red(portPath)}` });
				await this.ui.waitForKey();
			}
		}
	}

	/**
	 * Scan for available ports
	 */
	async scanPorts() {
		const spinner = createSpinner('Scanning for ports...').start();

		try {
			const ports = await SerialPort.list();

			if (ports.length === 0) {
				spinner.warn({ text: 'No serial ports found' });
			} else {
				spinner.success({ text: `Found ${chalk.green(ports.length)} serial ports` });

				console.log(
					boxen(
						chalk.cyan.bold('Available Ports') +
							'\n\n' +
							ports
								.map((port) => {
									const description = port.manufacturer
										? `${port.manufacturer}${port.serialNumber ? ` (${port.serialNumber})` : ''}`
										: 'Unknown device';
									return `${chalk.green(port.path)} - ${chalk.gray(description)}`;
								})
								.join('\n'),
						{
							padding: 1,
							margin: 1,
							borderStyle: 'round'
						}
					)
				);
			}

			await this.ui.waitForKey();
			return ports;
		} catch (error) {
			spinner.error({ text: `Error scanning ports: ${error.message}` });
			await this.ui.waitForKey();
			return [];
		}
	}

	/**
	 * Select a port from available ports
	 */
	async selectPort() {
		const spinner = createSpinner('Scanning for devices...').start();
		const ports = await SerialPort.list();
		spinner.stop();

		if (ports.length === 0) {
			this.logger.log('No devices found', 'warn');

			if (await confirm({ message: 'Would you like to scan again?', default: true })) {
				return this.selectPort();
			}

			return null;
		}

		// Prepare port choices with better formatting
		const choices = ports.map((port) => {
			const description = port.manufacturer
				? `${port.manufacturer}${port.serialNumber ? ` (${port.serialNumber})` : ''}`
				: 'Unknown device';

			return {
				name: `${port.path} - ${description}`,
				value: port.path,
				description
			};
		});

		console.log('\n' + chalk.bold.blue(' Available Devices ') + '\n');

		const portPath = await select({
			message: 'Select a device to connect:',
			choices: [
				...choices,
				{ name: 'Scan again', value: 'scan' },
				{ name: 'Cancel', value: 'cancel' }
			]
		});

		if (portPath === 'scan') {
			return this.selectPort();
		} else if (portPath === 'cancel') {
			return null;
		}

		return portPath;
	}

	/**
	 * Run benchmark
	 */
	async runBenchmark() {
		if (!this.connection.isConnected()) {
			this.logger.log('Cannot run benchmark: Not connected', 'error');
			await this.ui.waitForKey();
			return;
		}

		const duration = await input({
			message: 'Benchmark duration (seconds):',
			default: '30',
			validate: (value) => {
				const num = parseInt(value);
				return !isNaN(num) && num > 0 ? true : 'Please enter a positive number';
			}
		});

		if (await confirm({ message: `Start benchmark for ${duration} seconds?`, default: true })) {
			await this.benchmark.run(parseInt(duration));
			await this.ui.waitForKey();
		}
	}

	/**
	 * Exit application
	 */
	async exitApplication() {
		if (this.connection.isConnected()) {
			if (await confirm({ message: 'Disconnect before exiting?', default: true })) {
				await this.connection.disconnect();
			}
		}

		this.ui.showGoodbye();
		process.exit(0);
	}

	/**
	 * Set up shutdown handler
	 */
	setupShutdownHandler() {
		const cleanup = async () => {
			console.log('\n');
			this.logger.log('Shutting down...', 'warn');

			if (this.connection.isConnected()) {
				await this.connection.disconnect();
			}

			process.exit(0);
		};

		// Handle Ctrl+C and other termination signals
		process.on('SIGINT', cleanup);
		process.on('SIGTERM', cleanup);
	}
}

// Run application
try {
	const app = new MocapCLI();
	app.init();
} catch (error) {
	console.error(`\n${chalk.red(figures.cross)} Fatal error: ${error.message}`);
	process.exit(1);
}
