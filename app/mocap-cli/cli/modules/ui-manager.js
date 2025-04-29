import chalk from 'chalk';
import figlet from 'figlet';
import chalkAnimation from 'chalk-animation';
import boxen from 'boxen';
import { select } from '@inquirer/prompts';
import figures from 'figures';
import readline from 'readline';

/**
 * UIManager - Singleton for managing UI elements
 */
class UIManager {
	constructor() {
		if (UIManager.instance) {
			return UIManager.instance;
		}

		UIManager.instance = this;
		this.APP_VERSION = '1.0.0';
		this.APP_NAME = 'MoCap CLI';
	}

	/**
	 * Clear screen
	 */
	clear() {
		console.clear();
	}

	/**
	 * Wait for key press with safe stdin handling
	 */
	async waitForKey(message = 'Press any key to continue...') {
		console.log(`\n ${chalk.dim(message)}`);

		// Save current stdin state
		const wasRaw = process.stdin.isRaw || false;
		const wasResumed = process.stdin.isPaused() === false;

		// Only set raw mode if not already in raw mode
		if (!wasRaw) {
			process.stdin.setRawMode(true);
		}

		// Only resume if paused
		if (!wasResumed) {
			process.stdin.resume();
		}

		return new Promise((resolve) => {
			// Use 'once' to ensure the listener is removed after execution
			const keypressHandler = (data) => {
				// Restore original state
				if (!wasRaw) {
					process.stdin.setRawMode(false);
				}

				if (!wasResumed) {
					process.stdin.pause();
				}

				// Remove the event listener to avoid duplicates
				process.stdin.removeListener('data', keypressHandler);

				resolve();
			};

			process.stdin.once('data', keypressHandler);
		});
	}

	/**
	 * Get singleton instance
	 */
	static getInstance() {
		if (!UIManager.instance) {
			UIManager.instance = new UIManager();
		}
		return UIManager.instance;
	}

	/**
	 * Clear screen
	 */
	clear() {
		console.clear();
	}

	/**
	 * Show welcome screen
	 */
	async showWelcome() {
		this.clear();

		// Show animated title
		const title = figlet.textSync('MoCap CLI', {
			font: 'Standard',
			horizontalLayout: 'full'
		});

		const titleAnimation = chalkAnimation.rainbow(title);
		await new Promise((resolve) => setTimeout(resolve, 1500));
		titleAnimation.stop();

		console.log(
			boxen(
				`${chalk.bold('Motion Capture System Tool')} ${chalk.gray(`v${this.APP_VERSION}`)}\n` +
					`${chalk.dim('Control and monitor your motion capture hardware')}`,
				{
					padding: 1,
					margin: { top: 0, right: 0, bottom: 1, left: 0 },
					borderStyle: 'round',
					borderColor: '#3B82F6',
					textAlignment: 'center'
				}
			)
		);

		await this.waitForKey('Press any key to continue...');
	}

	/**
	 * Show header
	 */
	showHeader() {
		const headerText = figlet.textSync(this.APP_NAME, {
			font: 'Slant',
			horizontalLayout: 'default'
		});

		console.log(chalk.cyan(headerText));
		console.log(chalk.dim(`v${this.APP_VERSION} - Motion Capture System Tool\n`));
	}

	/**
	 * Show disconnected menu
	 */
	async showDisconnectedMenu() {
		return await select({
			message: 'What would you like to do?',
			choices: [
				{
					name: `${chalk.green(figures.arrowRight)} Connect to a device`,
					value: 'connect',
					description: 'Connect to a motion capture device'
				},
				{
					name: `${chalk.cyan(figures.circleDotted)} Scan for ports`,
					value: 'scan',
					description: 'Search for available serial ports'
				},
				{
					name: `${chalk.yellow(figures.info)} About`,
					value: 'about',
					description: 'Show information about this tool'
				},
				{
					name: `${chalk.red(figures.cross)} Exit`,
					value: 'exit',
					description: 'Exit the application'
				}
			]
		});
	}

	/**
	 * Show connected menu
	 */
	async showConnectedMenu(portName, isStreaming, debugMode) {
		const commandChoices = [
			{
				name: `${chalk.yellow(figures.warning)} Disconnect from ${portName}`,
				value: 'disconnect',
				description: 'Disconnect from the current device'
			},
			{ type: 'separator', line: chalk.dim('─'.repeat(20) + ' Commands ' + '─'.repeat(20)) }
		];

		// Add streaming commands based on current state
		if (isStreaming) {
			commandChoices.push({
				name: `${chalk.red(figures.squareSmall)} Stop streaming (X)`,
				value: 'stream_stop',
				description: 'Stop sensor data streaming'
			});
		} else {
			commandChoices.push({
				name: `${chalk.green(figures.play)} Start streaming (S)`,
				value: 'stream_start',
				description: 'Start sensor data streaming'
			});
		}

		// Add other commands
		commandChoices.push(
			{
				name: `${chalk.cyan(figures.info)} Check sensors (C)`,
				value: 'check_sensors',
				description: 'Check the status of all sensors'
			},
			{
				name: `${chalk.green(figures.circleDotted)} Initialize sensors (I)`,
				value: 'init_sensors',
				description: 'Reinitialize all sensors'
			},
			{
				name: `${chalk.cyan(figures.arrowReturn)} Ping node (P)`,
				value: 'ping',
				description: 'Ping the node to check connection'
			},
			{
				name: `${chalk.yellow(figures.warning)} Restart node (N)`,
				value: 'restart_node',
				description: 'Restart the sensor node'
			},
			{
				name: `${chalk.yellow(figures.warning)} Restart receiver (R)`,
				value: 'restart_receiver',
				description: 'Restart the receiver'
			},
			{ type: 'separator', line: chalk.dim('─'.repeat(20) + ' Debug ' + '─'.repeat(20)) },
			{
				name: `${chalk.blue(figures.triangleRight)} Set debug level (D:0-3)`,
				value: 'debug_level',
				description: 'Change the verbosity of device logs'
			},
			{
				name: `${chalk.blue(figures.hamburger)} ${debugMode ? 'Disable' : 'Enable'} debug mode`,
				value: 'toggle_debug',
				description: 'Toggle extended debugging information'
			},
			{ type: 'separator', line: chalk.dim('─'.repeat(20) + ' Tools ' + '─'.repeat(20)) },
			{
				name: `${chalk.magenta(figures.radioOn)} Run benchmark test`,
				value: 'benchmark',
				description: 'Test sensor data reception rates'
			},
			{ type: 'separator' },
			{
				name: `${chalk.red(figures.cross)} Exit`,
				value: 'exit',
				description: 'Exit the application'
			}
		);

		return await select({
			message: 'Select a command:',
			choices: commandChoices,
			pageSize: 15
		});
	}

	/**
	 * Show debug level menu
	 */
	async showDebugLevelMenu() {
		return await select({
			message: 'Select debug level:',
			choices: [
				{
					name: 'Debug (most verbose)',
					value: 'D:0',
					description: 'Show all debug messages'
				},
				{
					name: 'Info (normal)',
					value: 'D:1',
					description: 'Show normal information messages'
				},
				{
					name: 'Warning (less verbose)',
					value: 'D:2',
					description: 'Show only warnings and errors'
				},
				{
					name: 'Error (critical only)',
					value: 'D:3',
					description: 'Show only error messages'
				}
			]
		});
	}

	/**
	 * Show about screen
	 */
	async showAbout() {
		this.clear();
		this.showHeader();

		console.log(
			boxen(
				`${chalk.bold.cyan('About This Tool')}\n\n` +
					`${chalk.white('The Motion Capture CLI is a comprehensive tool for controlling and monitoring')}\n` +
					`${chalk.white('your motion capture hardware system. It provides real-time data visualization,')}\n` +
					`${chalk.white('sensor management, and performance benchmarking capabilities.')}\n\n` +
					chalk.dim('Press any key to return to the main menu...'),
				{
					padding: 1,
					margin: 1,
					borderStyle: 'round',
					borderColor: '#3B82F6',
					textAlignment: 'center'
				}
			)
		);

		await this.waitForKey();
	}

	/**
	 * Show goodbye message
	 */
	showGoodbye() {
		this.clear();

		const goodbyeText = figlet.textSync('Thank You!', {
			font: 'Standard',
			horizontalLayout: 'default'
		});

		console.log(chalk.green(goodbyeText));
		console.log(
			boxen(chalk.green('Thanks for using the Motion Capture CLI Tool'), {
				padding: 1,
				margin: 1,
				borderStyle: 'round',
				borderColor: 'green',
				textAlignment: 'center'
			})
		);
	}

	/**
	 * Wait for key press
	 */
	async waitForKey(message = 'Press any key to continue...') {
		console.log(`\n ${chalk.dim(message)}`);

		// Save current stdin state
		const wasRaw = process.stdin.isRaw || false;
		const wasResumed = process.stdin.isPaused() === false;

		// Only set raw mode if not already in raw mode
		if (!wasRaw) {
			process.stdin.setRawMode(true);
		}

		// Only resume if paused
		if (!wasResumed) {
			process.stdin.resume();
		}

		return new Promise((resolve) => {
			// Use 'once' to ensure the listener is removed after execution
			const keypressHandler = (data) => {
				// Restore original state
				if (!wasRaw) {
					process.stdin.setRawMode(false);
				}

				if (!wasResumed) {
					process.stdin.pause();
				}

				// Remove the event listener to avoid duplicates
				process.stdin.removeListener('data', keypressHandler);

				resolve();
			};

			process.stdin.once('data', keypressHandler);
		});
	}
}

export default UIManager;
