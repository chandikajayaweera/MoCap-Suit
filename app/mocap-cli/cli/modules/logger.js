import chalk from 'chalk';
import figures from 'figures';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Enhanced Logger - Singleton for consistent logging with file output
 */
class Logger {
	constructor() {
		if (Logger.instance) {
			return Logger.instance;
		}

		Logger.instance = this;

		// Logger state
		this.debugMode = false;
		this.logToFile = false;
		this.logStream = null;
		this.logFilename = null;

		// Log callback for UI integration
		this.logCallback = null;

		// Set up log directory
		try {
			// Get directory path in ESM context
			const __filename = fileURLToPath(import.meta.url);
			const __dirname = path.dirname(__filename);

			// Create logs directory
			this.logsDir = path.join(__dirname, '..', '..', 'logs');
			if (!fs.existsSync(this.logsDir)) {
				fs.mkdirSync(this.logsDir, { recursive: true });
			}
		} catch (error) {
			console.error(`Error setting up log directory: ${error.message}`);
		}
	}

	/**
	 * Get singleton instance
	 */
	static getInstance() {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	/**
	 * Log a message with specified level
	 * @param {string} message - Message to log
	 * @param {string} type - Log level (info, error, warn, success, debug)
	 */
	log(message, type = 'info') {
		// Skip debug messages if debug mode is off
		if (type === 'debug' && !this.debugMode) {
			return;
		}

		// Format timestamp
		const timestamp = new Date().toISOString();
		const timeString = `${timestamp.split('T')[1].split('.')[0]}`;
		const prefix = `${chalk.gray(`[${timeString}]`)}`;

		// Format message by type
		let formattedMessage;
		switch (type) {
			case 'error':
				formattedMessage = `${prefix} ${chalk.red(figures.cross)} ${chalk.red(message)}`;
				break;
			case 'warn':
				formattedMessage = `${prefix} ${chalk.yellow(figures.warning)} ${chalk.yellow(message)}`;
				break;
			case 'success':
				formattedMessage = `${prefix} ${chalk.green(figures.tick)} ${chalk.green(message)}`;
				break;
			case 'debug':
				formattedMessage = `${prefix} ${chalk.blue(figures.info)} ${chalk.blue(message)}`;
				break;
			case 'info':
			default:
				formattedMessage = `${prefix} ${chalk.blue(figures.pointer)} ${message}`;
		}

		// Send to log callback for UI integration
		if (this.logCallback) {
			this.logCallback(message, type);
		} else {
			// Fall back to console if no callback
			console.log(formattedMessage);
		}

		// Write to log file if enabled
		this.writeToLogFile(timestamp, type, message);
	}

	/**
	 * Write to log file if enabled
	 * @param {string} timestamp - Log timestamp
	 * @param {string} level - Log level
	 * @param {string} message - Log message
	 */
	writeToLogFile(timestamp, level, message) {
		if (!this.logToFile || !this.logStream) return;

		try {
			// Format for file (plain text)
			const line = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;

			// Write to file
			this.logStream.write(line);
		} catch (error) {
			console.error(`Error writing to log file: ${error.message}`);
			this.disableFileLogging(); // Disable on error
		}
	}

	/**
	 * Enable logging to file
	 * @param {string} filename - Custom filename (optional)
	 */
	enableFileLogging(filename = null) {
		// Check if already logging
		if (this.logToFile && this.logStream) {
			this.log('File logging already enabled', 'warn');
			return false;
		}

		try {
			// Generate filename if not provided
			if (!filename) {
				const timestamp = new Date()
					.toISOString()
					.replace(/:/g, '')
					.replace(/T/, '_')
					.replace(/\..+/, '');

				filename = path.join(this.logsDir, `mocap_cli_${timestamp}.log`);
			}

			// Create write stream
			this.logStream = fs.createWriteStream(filename, { flags: 'a' });
			this.logFilename = filename;
			this.logToFile = true;

			// Write header
			const header =
				`=== MOTION CAPTURE CLI LOG ===\n` +
				`Started: ${new Date().toISOString()}\n` +
				`===============================\n\n`;

			this.logStream.write(header);

			this.log(`File logging enabled: ${path.basename(filename)}`, 'success');
			return true;
		} catch (error) {
			console.error(`Error enabling file logging: ${error.message}`);
			return false;
		}
	}

	/**
	 * Disable logging to file
	 */
	disableFileLogging() {
		if (!this.logToFile || !this.logStream) return false;

		try {
			// Write footer
			const footer =
				`\n==============================\n` +
				`Ended: ${new Date().toISOString()}\n` +
				`==============================\n`;

			this.logStream.write(footer);

			// Close stream
			this.logStream.end();
			this.logStream = null;
			this.logToFile = false;

			this.log(`File logging disabled: ${path.basename(this.logFilename)}`, 'info');
			this.logFilename = null;
			return true;
		} catch (error) {
			console.error(`Error disabling file logging: ${error.message}`);
			return false;
		}
	}

	/**
	 * Toggle debug mode
	 * @returns {boolean} New debug mode state
	 */
	toggleDebugMode() {
		this.debugMode = !this.debugMode;
		return this.debugMode;
	}

	/**
	 * Set debug mode
	 * @param {boolean} enabled - Debug mode enabled
	 * @returns {boolean} New debug mode state
	 */
	setDebugMode(enabled) {
		this.debugMode = !!enabled;
		return this.debugMode;
	}

	/**
	 * Check if debug mode is enabled
	 * @returns {boolean} Debug mode state
	 */
	isDebugMode() {
		return this.debugMode;
	}

	/**
	 * Set log callback for UI integration
	 * @param {Function} callback - Log callback function
	 */
	setLogCallback(callback) {
		if (typeof callback === 'function') {
			this.logCallback = callback;
		}
	}
}

export default Logger;
