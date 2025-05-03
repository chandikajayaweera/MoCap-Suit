import chalk from 'chalk';
import figures from 'figures';

/**
 * Logger - Singleton for consistent logging
 */
class Logger {
	constructor() {
		if (Logger.instance) {
			return Logger.instance;
		}

		Logger.instance = this;
		this.debugMode = false;
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
	 */
	log(message, type = 'info') {
		const timestamp = new Date().toISOString();
		const prefix = `${chalk.gray(`[${timestamp.split('T')[1].split('.')[0]}]`)}`;

		// Skip debug messages if debug mode is off
		if (type === 'debug' && !this.debugMode) {
			return;
		}

		switch (type) {
			case 'error':
				console.error(`${prefix} ${chalk.red(figures.cross)} ${chalk.red(message)}`);
				break;
			case 'warn':
				console.warn(`${prefix} ${chalk.yellow(figures.warning)} ${chalk.yellow(message)}`);
				break;
			case 'success':
				console.log(`${prefix} ${chalk.green(figures.tick)} ${chalk.green(message)}`);
				break;
			case 'debug':
				console.log(`${prefix} ${chalk.blue(figures.info)} ${chalk.blue(message)}`);
				break;
			case 'info':
			default:
				console.log(`${prefix} ${chalk.blue(figures.pointer)} ${message}`);
		}
	}

	/**
	 * Toggle debug mode
	 */
	toggleDebugMode() {
		this.debugMode = !this.debugMode;
		return this.debugMode;
	}

	/**
	 * Set debug mode
	 */
	setDebugMode(enabled) {
		this.debugMode = !!enabled;
		return this.debugMode;
	}

	/**
	 * Check if debug mode is enabled
	 */
	isDebugMode() {
		return this.debugMode;
	}
}

export default Logger;
