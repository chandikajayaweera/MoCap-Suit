import chalk from 'chalk';
import figlet from 'figlet';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import figures from 'figures';
import { select } from '@inquirer/prompts';

/**
 * UIManager - Singleton for managing UI elements with advanced terminal dashboard
 */
class UIManager {
	constructor() {
		if (UIManager.instance) {
			return UIManager.instance;
		}

		UIManager.instance = this;
		this.APP_VERSION = '1.0.0';
		this.APP_NAME = 'MoCap CLI';

		// UI state
		this.screen = null;
		this.dashboard = null;
		this.isInitialized = false;
		this.isStreaming = false;
		this.statusInfo = {
			connected: false,
			portName: 'None',
			streaming: false,
			activeSensors: 0,
			totalSensors: 8,
			packetCount: 0,
			dataRate: 0,
			missedPackets: 0,
			sequence: 0
		};

		// UI elements
		this.elements = {};

		// Command handlers
		this.commandHandlers = {};

		// Callbacks
		this.exitCallback = null;
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
	 * Initialize the dashboard UI
	 */
	initDashboard() {
		if (this.isInitialized) return;

		// Create screen
		this.screen = blessed.screen({
			smartCSR: true,
			title: `${this.APP_NAME} v${this.APP_VERSION}`,
			dockBorders: true,
			fullUnicode: true
		});

		// Quit on Escape, q, or Ctrl+C
		this.screen.key(['escape', 'q', 'C-c'], () => {
			this.exitApplication();
		});

		// Create grid layout
		this.grid = new contrib.grid({
			rows: 12,
			cols: 12,
			screen: this.screen
		});

		// Header with logo
		this.elements.header = this.grid.set(0, 0, 1, 12, blessed.box, {
			content: chalk.cyan(
				figlet.textSync('MoCap CLI', { font: 'Slant', horizontalLayout: 'fitted' })
			),
			style: {
				fg: 'cyan',
				bg: 'black'
			},
			padding: { top: 0, left: 1, right: 1, bottom: 0 }
		});

		// Status panel
		this.elements.statusPanel = this.grid.set(1, 0, 3, 8, blessed.box, {
			label: ' System Status ',
			tags: true,
			padding: { left: 1, right: 1 },
			border: { type: 'line', fg: 'cyan' },
			style: {
				fg: 'white',
				bg: 'black',
				border: { fg: 'cyan' }
			}
		});

		// Connection details
		this.elements.connectionBox = this.grid.set(1, 8, 3, 4, blessed.box, {
			label: ' Connection ',
			padding: { left: 1, right: 1 },
			tags: true,
			border: { type: 'line', fg: 'cyan' },
			style: {
				fg: 'white',
				bg: 'black',
				border: { fg: 'cyan' }
			}
		});

		// Sensor data line chart
		this.elements.dataChart = this.grid.set(4, 8, 4, 4, contrib.line, {
			label: ' Data Rate (packets/sec) ',
			showLegend: false,
			xLabelPadding: 3,
			xPadding: 5,
			minY: 0,
			maxY: 100,
			style: {
				text: 'white',
				baseline: 'cyan',
				fg: 'white',
				border: { fg: 'cyan' }
			}
		});

		// Command buttons
		this.elements.commandsBox = this.grid.set(4, 0, 4, 8, blessed.box, {
			label: ' Commands ',
			scrollable: true,
			tags: true,
			padding: { left: 1, right: 1 },
			border: { type: 'line', fg: 'cyan' },
			style: {
				fg: 'white',
				bg: 'black',
				border: { fg: 'cyan' },
				scrollbar: { fg: 'blue', bg: 'black' }
			}
		});

		// Log box
		this.elements.logBox = this.grid.set(8, 0, 4, 12, blessed.log, {
			label: ' System Logs ',
			tags: true,
			scrollable: true,
			alwaysScroll: true,
			scrollbar: {
				ch: ' ',
				style: { bg: 'blue' },
				track: {
					bg: 'black'
				}
			},
			border: { type: 'line', fg: 'cyan' },
			style: {
				fg: 'white',
				bg: 'black',
				border: { fg: 'cyan' }
			},
			padding: { left: 1, right: 1 }
		});

		// Create command buttons
		this.createCommandButtons();

		// Initialize data chart
		this.initDataChart();

		// Update status display for the first time
		this.updateStatusDisplay();

		// Set initialized flag
		this.isInitialized = true;

		// Render the screen
		this.screen.render();
	}

	/**
	 * Initialize data chart with empty data
	 */
	initDataChart() {
		// Initialize with empty data
		const series = {
			title: 'packets/sec',
			x: Array(20)
				.fill(0)
				.map((_, i) => (i + 1).toString()),
			y: Array(20).fill(0),
			style: { line: 'cyan' }
		};

		this.elements.dataChart.setData([series]);
	}

	/**
	 * Update data chart with new rate
	 */
	updateDataChart(rate) {
		try {
			// Initialize chart data if it doesn't exist
			if (
				!this.elements.dataChart.data ||
				!Array.isArray(this.elements.dataChart.data) ||
				!this.elements.dataChart.data[0] ||
				!Array.isArray(this.elements.dataChart.data[0].y)
			) {
				// Create new data series
				const series = {
					title: 'packets/sec',
					x: Array(20)
						.fill(0)
						.map((_, i) => (i + 1).toString()),
					y: Array(20).fill(0),
					style: { line: 'cyan' }
				};

				// Set data using direct property assignment first
				this.elements.dataChart.data = [series];

				// Then use the proper method
				this.elements.dataChart.setData([series]);
			}

			// Now data[0] should exist
			const data = this.elements.dataChart.data[0];

			// Update data points
			data.y.shift();
			data.y.push(rate);

			// Set new label max based on rate
			const maxRate = Math.max(...data.y, 10); // Ensure at least 10
			this.elements.dataChart.options.maxY = Math.ceil(maxRate * 1.2);

			// Update chart with new data array reference
			this.elements.dataChart.setData([data]);

			// Render updates
			if (this.screen) this.screen.render();
		} catch (error) {
			console.error('Error updating data chart:', error.message);
		}
	}

	/**
	 * Create command buttons in the commands box
	 */
	createCommandButtons() {
		// Clear any existing buttons
		while (this.elements.commandsBox.children.length > 0) {
			this.elements.commandsBox.remove(this.elements.commandsBox.children[0]);
		}

		// Define button layout
		const columns = 2;
		const buttonWidth = '48%';
		const buttonHeight = 3;
		const margin = 1;

		// Define buttons
		const buttons = [
			{
				id: 'connect',
				label: 'Connect',
				color: 'green',
				disabled: this.statusInfo.connected,
				row: 0,
				col: 0
			},
			{
				id: 'disconnect',
				label: 'Disconnect',
				color: 'red',
				disabled: !this.statusInfo.connected,
				row: 0,
				col: 1
			},
			{
				id: 'start_stream',
				label: 'Start Streaming',
				color: 'green',
				disabled: !this.statusInfo.connected || this.statusInfo.streaming,
				row: 1,
				col: 0
			},
			{
				id: 'stop_stream',
				label: 'Stop Streaming',
				color: 'red',
				disabled: !this.statusInfo.connected || !this.statusInfo.streaming,
				row: 1,
				col: 1
			},
			{
				id: 'check_sensors',
				label: 'Check Sensors',
				color: 'cyan',
				disabled: !this.statusInfo.connected || this.statusInfo.streaming,
				row: 2,
				col: 0
			},
			{
				id: 'init_sensors',
				label: 'Init Sensors',
				color: 'yellow',
				disabled: !this.statusInfo.connected || this.statusInfo.streaming,
				row: 2,
				col: 1
			},
			{
				id: 'restart_node',
				label: 'Restart Node',
				color: 'magenta',
				disabled: !this.statusInfo.connected || this.statusInfo.streaming,
				row: 3,
				col: 0
			},
			{
				id: 'benchmark',
				label: 'Run Benchmark',
				color: 'blue',
				disabled: !this.statusInfo.connected || this.statusInfo.streaming,
				row: 3,
				col: 1
			}
		];

		// Create and add buttons
		buttons.forEach((button) => {
			const isDisabled =
				typeof button.disabled === 'function' ? button.disabled() : button.disabled;

			const bgColor = isDisabled ? 'gray' : button.color;
			const textColor = isDisabled ? 'darkgray' : 'white';

			const buttonElement = blessed.button({
				top: button.row * (buttonHeight + margin),
				left: button.col === 0 ? 0 : '50%-1',
				width: buttonWidth,
				height: buttonHeight,
				content: button.label,
				align: 'center',
				valign: 'middle',
				tags: true,
				border: {
					type: 'line',
					fg: isDisabled ? 'gray' : button.color
				},
				style: {
					fg: textColor,
					bg: 'black',
					border: {
						fg: isDisabled ? 'gray' : button.color
					},
					focus: {
						fg: 'white',
						bg: isDisabled ? 'gray' : button.color
					},
					hover: {
						bg: isDisabled ? 'gray' : button.color,
						fg: 'white'
					}
				}
			});

			// Add button to commands box
			this.elements.commandsBox.append(buttonElement);

			// Add click handler if not disabled
			if (!isDisabled) {
				buttonElement.on('click', () => {
					this.handleCommand(button.id);
				});
			}
		});
	}

	/**
	 * Handle command execution
	 */
	handleCommand(command) {
		if (this.commandHandlers[command]) {
			this.elements.logBox.log(`{yellow-fg}Executing command: ${command}{/}`);

			// Execute the handler
			this.commandHandlers[command]();
		}
	}

	/**
	 * Register command handlers
	 */
	registerCommandHandlers(handlers) {
		this.commandHandlers = handlers;
	}

	/**
	 * Set exit callback
	 */
	onExit(callback) {
		this.exitCallback = callback;
	}

	/**
	 * Handle application exit with streaming check
	 */
	exitApplication() {
		if (this.statusInfo.streaming && typeof this.commandHandlers.stop_stream === 'function') {
			this.showDialog('Streaming is active', 'Do you want to stop streaming before exiting?', [
				{
					text: 'Yes',
					callback: () => {
						this.commandHandlers.stop_stream(() => {
							this.exitAfterConfirmation();
						});
					}
				},
				{
					text: 'No',
					callback: () => {
						this.exitAfterConfirmation();
					}
				},
				{
					text: 'Cancel',
					callback: () => {
						this.screen.render();
					}
				}
			]);
		} else {
			this.exitAfterConfirmation();
		}
	}

	/**
	 * Exit after confirmation
	 */
	exitAfterConfirmation() {
		this.showDialog('Confirm Exit', 'Are you sure you want to exit?', [
			{
				text: 'Yes',
				callback: () => {
					if (this.exitCallback) {
						this.exitCallback();
					} else {
						this.screen.destroy();
						process.exit(0);
					}
				}
			},
			{
				text: 'No',
				callback: () => {
					this.screen.render();
				}
			}
		]);
	}

	/**
	 * Show a dialog with buttons
	 */
	showDialog(title, message, buttons) {
		const dialog = blessed.box({
			top: 'center',
			left: 'center',
			width: '50%',
			height: 'shrink',
			tags: true,
			border: {
				type: 'line',
				fg: 'yellow'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'yellow'
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
		dialog.append(
			blessed.text({
				top: 0,
				left: 'center',
				content: `{bold}${title}{/bold}`,
				tags: true
			})
		);

		// Add message
		dialog.append(
			blessed.text({
				top: 2,
				left: 'center',
				content: message,
				tags: true,
				align: 'center'
			})
		);

		// Add buttons
		const buttonWidth = Math.floor(100 / buttons.length) - 5;
		buttons.forEach((button, i) => {
			const buttonElement = blessed.button({
				top: 4,
				left: `${i * (buttonWidth + 5) + 5}%`,
				width: `${buttonWidth}%`,
				height: 1,
				content: button.text,
				align: 'center',
				valign: 'middle',
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
					},
					focus: {
						fg: 'black',
						bg: 'cyan'
					},
					hover: {
						bg: 'cyan',
						fg: 'black'
					}
				}
			});

			buttonElement.on('click', () => {
				dialog.detach();
				this.screen.render();
				button.callback();
			});

			dialog.append(buttonElement);
		});

		// Add dialog to screen
		this.screen.append(dialog);

		// Set focus to dialog
		dialog.focus();

		// Render the screen
		this.screen.render();
	}

	/**
	 * Show a notification message that disappears after a delay
	 */
	showNotification(message, type = 'info', duration = 3000) {
		const colors = {
			info: 'blue',
			success: 'green',
			warning: 'yellow',
			error: 'red'
		};

		const notification = blessed.box({
			top: 1,
			right: 3,
			width: '40%',
			height: 'shrink',
			content: message,
			tags: true,
			border: {
				type: 'line',
				fg: colors[type] || 'white'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: colors[type] || 'white'
				}
			},
			padding: {
				top: 1,
				right: 2,
				bottom: 1,
				left: 2
			}
		});

		// Add to screen
		this.screen.append(notification);
		this.screen.render();

		// Remove after duration
		setTimeout(() => {
			notification.detach();
			this.screen.render();
		}, duration);
	}

	/**
	 * Update status display with current information
	 */
	updateStatusDisplay() {
		// Format connection status
		const connStatus = this.statusInfo.connected
			? `{green-fg}Connected{/} to ${this.statusInfo.portName}`
			: '{red-fg}Disconnected{/}';

		const streamStatus = this.statusInfo.streaming
			? `{green-fg}${figures.circleFilled} Active{/}`
			: '{gray-fg}${figures.circle} Inactive{/}';

		// Format sensor status
		const sensorStatus = `{cyan-fg}${this.statusInfo.activeSensors}{/}/{cyan-fg}${this.statusInfo.totalSensors}{/}`;

		// Update connection box
		this.elements.connectionBox.setContent(
			`Status: ${connStatus}\n` +
				`Port: ${this.statusInfo.portName || 'None'}\n` +
				`Connection: ${this.statusInfo.connected ? '{green-fg}Active{/}' : '{red-fg}Inactive{/}'}`
		);

		// Update status panel
		this.elements.statusPanel.setContent(
			`{bold}Streaming:{/bold} ${streamStatus}     ` +
				`{bold}Active Sensors:{/bold} ${sensorStatus}\n\n` +
				`{bold}Packets Received:{/bold} ${this.statusInfo.packetCount.toLocaleString()}\n` +
				`{bold}Current Rate:{/bold} ${this.statusInfo.dataRate.toFixed(1)} packets/sec\n` +
				`{bold}Packets Missed:{/bold} ${this.statusInfo.missedPackets}     ` +
				`{bold}Current Sequence:{/bold} ${this.statusInfo.sequence}\n\n` +
				`{cyan-fg}Press ESC, Q, or Ctrl+C to exit{/}`
		);

		// Re-create buttons with updated status
		this.createCommandButtons();

		// Render the screen
		if (this.screen) {
			this.screen.render();
		}
	}

	/**
	 * Update status information
	 */
	updateStatus(status) {
		// Update status info
		this.statusInfo = { ...this.statusInfo, ...status };

		// Update data chart if data rate changed
		if (status.dataRate !== undefined) {
			this.updateDataChart(status.dataRate);
		}

		// Update display
		this.updateStatusDisplay();
	}

	/**
	 * Add a log message
	 */
	log(message, type = 'info') {
		if (!this.elements.logBox) return;

		const colors = {
			info: 'white-fg',
			success: 'green-fg',
			warning: 'yellow-fg',
			error: 'red-fg',
			debug: 'blue-fg'
		};

		const color = colors[type] || 'white-fg';
		const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

		this.elements.logBox.log(`{gray-fg}[${timestamp}]{/} {${color}}${message}{/}`);
		this.screen.render();
	}

	/**
	 * Show loading spinner
	 * Returns a function to hide the spinner
	 */
	showSpinner(message) {
		// Create loading box
		const loadingBox = blessed.box({
			top: 'center',
			left: 'center',
			width: '50%',
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

		// Add spinner text
		const spinnerText = blessed.text({
			top: 1,
			left: 'center',
			content: `${figures.circleDotted} ${message}`,
			tags: true,
			align: 'center'
		});

		loadingBox.append(spinnerText);

		// Add to screen
		this.screen.append(loadingBox);
		this.screen.render();

		// Animation frames
		const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
		let frameIndex = 0;

		// Create interval for spinner animation
		const interval = setInterval(() => {
			frameIndex = (frameIndex + 1) % frames.length;
			spinnerText.setContent(`{cyan-fg}${frames[frameIndex]}{/} ${message}`);
			this.screen.render();
		}, 80);

		// Return function to hide spinner
		return (newMessage = null, type = null) => {
			clearInterval(interval);

			if (newMessage) {
				// Show final message with appropriate icon
				const icons = {
					success: `{green-fg}${figures.tick}{/}`,
					error: `{red-fg}${figures.cross}{/}`,
					warning: `{yellow-fg}${figures.warning}{/}`
				};

				const icon = type && icons[type] ? icons[type] : `{cyan-fg}${figures.info}{/}`;
				spinnerText.setContent(`${icon} ${newMessage}`);
				this.screen.render();

				// Remove after a delay
				setTimeout(() => {
					loadingBox.detach();
					this.screen.render();
				}, 2000);
			} else {
				// Just remove
				loadingBox.detach();
				this.screen.render();
			}
		};
	}

	/**
	 * Show select port dialog
	 */
	async showPortSelector(ports) {
		// Detach from screen temporarily
		this.screen.leave();

		// Get port selection via inquirer
		const portPath = await select({
			message: 'Select a device to connect:',
			choices: [
				...ports.map((port) => {
					const description = port.manufacturer
						? `${port.manufacturer}${port.serialNumber ? ` (${port.serialNumber})` : ''}`
						: 'Unknown device';

					return {
						name: `${port.path} - ${description}`,
						value: port.path,
						description
					};
				}),
				{ name: 'Cancel', value: 'cancel' }
			]
		});

		// Return to screen
		this.screen.enter();
		this.screen.render();

		return portPath === 'cancel' ? null : portPath;
	}

	/**
	 * Show benchmark settings dialog
	 */
	showBenchmarkSettings(callback) {
		// Create dialog
		const dialog = blessed.form({
			top: 'center',
			left: 'center',
			width: '50%',
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
		dialog.append(
			blessed.text({
				top: 0,
				left: 'center',
				content: '{bold}Benchmark Settings{/bold}',
				tags: true
			})
		);

		// Add label
		dialog.append(
			blessed.text({
				top: 2,
				left: 0,
				content: 'Duration (seconds):',
				tags: true
			})
		);

		// Add input
		const input = blessed.textbox({
			top: 2,
			left: 20,
			width: 10,
			height: 1,
			inputOnFocus: true,
			content: '30',
			border: {
				type: 'line',
				fg: 'blue'
			},
			style: {
				fg: 'white',
				bg: 'black',
				focus: {
					bg: 'blue',
					fg: 'white'
				}
			}
		});

		dialog.append(input);

		// Add buttons
		const startButton = blessed.button({
			top: 4,
			left: '25%-10',
			width: 20,
			height: 1,
			content: 'Start Benchmark',
			align: 'center',
			valign: 'middle',
			tags: true,
			border: {
				type: 'line',
				fg: 'green'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'green'
				},
				focus: {
					fg: 'black',
					bg: 'green'
				},
				hover: {
					bg: 'green',
					fg: 'black'
				}
			}
		});

		const cancelButton = blessed.button({
			top: 4,
			left: '75%-10',
			width: 20,
			height: 1,
			content: 'Cancel',
			align: 'center',
			valign: 'middle',
			tags: true,
			border: {
				type: 'line',
				fg: 'red'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'red'
				},
				focus: {
					fg: 'black',
					bg: 'red'
				},
				hover: {
					bg: 'red',
					fg: 'black'
				}
			}
		});

		dialog.append(startButton);
		dialog.append(cancelButton);

		// Add handlers
		startButton.on('click', () => {
			const duration = parseInt(input.value || input.content);
			if (isNaN(duration) || duration <= 0) {
				this.showNotification('Please enter a valid duration (positive number)', 'error');
				return;
			}

			dialog.detach();
			this.screen.render();
			callback(duration);
		});

		cancelButton.on('click', () => {
			dialog.detach();
			this.screen.render();
		});

		// Add dialog to screen
		this.screen.append(dialog);
		input.focus();

		// Render the screen
		this.screen.render();
	}

	/**
	 * Show benchmark results
	 */
	showBenchmarkResults(results) {
		// Create dialog
		const dialog = blessed.box({
			top: 'center',
			left: 'center',
			width: '70%',
			height: '70%',
			tags: true,
			scrollable: true,
			border: {
				type: 'line',
				fg: 'cyan'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'cyan'
				},
				scrollbar: {
					bg: 'blue'
				}
			},
			padding: {
				top: 1,
				right: 2,
				bottom: 1,
				left: 2
			},
			keys: true,
			vi: true
		});

		// Add title
		dialog.append(
			blessed.text({
				top: 0,
				left: 'center',
				content: '{bold}{cyan-fg}Benchmark Results{/}{/bold}',
				tags: true
			})
		);

		// Format results
		let content = '\n';
		content += `{bold}Test Duration:{/bold} {yellow-fg}${results.duration.toFixed(2)}{/} seconds\n`;
		content += `{bold}Total Packets:{/bold} {yellow-fg}${results.totalPackets.toLocaleString()}{/}\n`;
		content += `{bold}Overall Rate:{/bold} {yellow-fg}${results.overallRate.toFixed(2)}{/} packets/second\n\n`;

		content += `{bold}{blue-fg}Performance Metrics:{/}{/bold}\n`;
		content += `  {bold}Minimum Rate:{/bold} {green-fg}${results.minRate}{/} packets/second\n`;
		content += `  {bold}Average Rate:{/bold} {green-fg}${results.avgRate.toFixed(1)}{/} packets/second\n`;
		content += `  {bold}Maximum Rate:{/bold} {green-fg}${results.maxRate}{/} packets/second\n\n`;

		content += `{bold}{blue-fg}Reliability Metrics:{/}{/bold}\n`;
		content += `  {bold}Missing Packets:{/bold} ${results.missedPackets > 0 ? `{red-fg}${results.missedPackets.toLocaleString()}{/}` : '{green-fg}0{/}'}\n`;
		content += `  {bold}Out-of-order:{/bold} ${results.outOfOrder > 0 ? `{yellow-fg}${results.outOfOrder.toLocaleString()}{/}` : '{green-fg}0{/}'}\n`;
		content += `  {bold}Packet Loss Rate:{/bold} ${results.lossRate > 0 ? `{red-fg}${results.lossRate.toFixed(2)}%{/}` : '{green-fg}0.00%{/}'}\n\n`;

		if (results.logFile) {
			content += `{bold}Detailed report saved to:{/bold} {cyan-fg}${results.logFile}{/}\n\n`;
		}

		content += '{center}-- Press ESC or Q to close --{/center}';

		dialog.setContent(content);

		// Add key handler to close
		dialog.key(['escape', 'q'], () => {
			dialog.detach();
			this.screen.render();
		});

		// Add close button
		const closeButton = blessed.button({
			bottom: 1,
			left: 'center',
			width: 20,
			height: 1,
			content: 'Close',
			align: 'center',
			valign: 'middle',
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
				},
				focus: {
					fg: 'black',
					bg: 'cyan'
				},
				hover: {
					bg: 'cyan',
					fg: 'black'
				}
			}
		});

		closeButton.on('click', () => {
			dialog.detach();
			this.screen.render();
		});

		dialog.append(closeButton);

		// Add dialog to screen
		this.screen.append(dialog);
		dialog.focus();

		// Render the screen
		this.screen.render();
	}

	/**
	 * Clear the terminal
	 */
	clear() {
		if (this.isInitialized && this.screen) {
			this.screen.clearRegion(0, this.screen.width, 0, this.screen.height);
			this.screen.render();
		} else {
			console.clear();
		}
	}

	/**
	 * Show welcome screen
	 */
	async showWelcome() {
		this.clear();

		// Show ASCII art title directly in console
		console.log(chalk.cyan(figlet.textSync(this.APP_NAME, { font: 'Standard' })));
		console.log(chalk.bold.cyan(`v${this.APP_VERSION} - Motion Capture System Tool\n`));
		console.log(
			chalk.white('A professional command-line interface for controlling motion capture hardware\n')
		);
		console.log(chalk.dim('Press any key to continue...'));

		// Wait for key press
		return new Promise((resolve) => {
			process.stdin.setRawMode(true);
			process.stdin.resume();
			process.stdin.once('data', () => {
				process.stdin.setRawMode(false);
				process.stdin.pause();
				resolve();
			});
		});
	}

	/**
	 * Show header in console (used before dashboard init)
	 */
	showHeader() {
		console.log(chalk.cyan(figlet.textSync(this.APP_NAME, { font: 'Slant' })));
		console.log(chalk.dim(`v${this.APP_VERSION} - Motion Capture System Tool\n`));
	}

	/**
	 * Destroy the UI
	 */
	destroy() {
		if (this.screen) {
			this.screen.destroy();
		}
	}

	/**
	 * Show about screen dialog
	 */
	showAbout() {
		const dialog = blessed.box({
			top: 'center',
			left: 'center',
			width: '60%',
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
				bottom: 2,
				left: 2
			}
		});

		// Add content
		dialog.setContent(
			`{center}{cyan-fg}{bold}${this.APP_NAME} v${this.APP_VERSION}{/bold}{/}{/center}\n\n` +
				`{center}Motion Capture System Tool{/center}\n\n` +
				`{cyan-fg}Overview:{/}\n` +
				`This application provides a comprehensive interface for controlling and monitoring ` +
				`motion capture hardware systems. It enables real-time data visualization, ` +
				`sensor management, and performance benchmarking capabilities.\n\n` +
				`{cyan-fg}Key Features:{/}\n` +
				`{bold}${figures.bullet}{/} Live streaming of sensor data\n` +
				`{bold}${figures.bullet}{/} Sensor diagnostics and management\n` +
				`{bold}${figures.bullet}{/} Performance benchmarking\n` +
				`{bold}${figures.bullet}{/} System status monitoring\n\n` +
				`{center}{dim}-- Press ESC or Q to close this dialog --{/}{/center}`
		);

		// Add key handler to close
		dialog.key(['escape', 'q'], () => {
			dialog.detach();
			this.screen.render();
		});

		// Add button to close
		const closeButton = blessed.button({
			bottom: 0,
			left: 'center',
			width: 20,
			height: 1,
			content: 'Close',
			align: 'center',
			valign: 'middle',
			tags: true,
			border: {
				type: 'line',
				fg: 'blue'
			},
			style: {
				fg: 'white',
				bg: 'black',
				border: {
					fg: 'blue'
				},
				focus: {
					fg: 'black',
					bg: 'blue'
				},
				hover: {
					bg: 'blue',
					fg: 'black'
				}
			}
		});

		closeButton.on('click', () => {
			dialog.detach();
			this.screen.render();
		});

		dialog.append(closeButton);

		// Add dialog to screen
		this.screen.append(dialog);
		dialog.focus();

		// Render the screen
		this.screen.render();
	}
}

export default UIManager;
