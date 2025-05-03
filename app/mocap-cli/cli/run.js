#!/usr/bin/env node

/**
 * Motion Capture CLI Tool Runner
 *
 * This wrapper script:
 * 1. Checks if dependencies are installed
 * 2. If not, asks user for permission to install them
 * 3. Offers choice of package manager (npm, pnpm, or yarn)
 * 4. Installs dependencies if needed
 * 5. Runs the Motion Capture CLI tool
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import readline from 'readline';

// Get directory paths in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to CLI tool
const CLI_DIR = __dirname;
const CLI_SCRIPT = path.join(CLI_DIR, 'index.js');
const NODE_MODULES_PATH = path.join(CLI_DIR, 'node_modules');

// Create logs directory if it doesn't exist
const logsDir = path.join(CLI_DIR, '..', 'logs');
if (!fs.existsSync(logsDir)) {
	fs.mkdirSync(logsDir, { recursive: true });
}

// Create interactive readline interface
global.rlInterface = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

// Promisify readline question
const question = (query) =>
	new Promise((resolve) => {
		// Ensure stdin is in the correct state for readline
		if (process.stdin.isTTY && process.stdin.isRaw) {
			process.stdin.setRawMode(false);
		}

		global.rlInterface.question(query, (answer) => {
			resolve(answer);
		});
	});

/**
 * Checks if essential dependencies are installed
 */
function checkDependenciesInstalled() {
	const nodeModulesExists = fs.existsSync(NODE_MODULES_PATH);
	if (!nodeModulesExists) {
		console.log('Dependency check failed: node_modules directory not found.');
		return false;
	}

	// List essential packages imported by index.js
	const essentialPackages = [
		'@inquirer/prompts',
		'boxen',
		'chalk',
		'chalk-animation',
		'cli-cursor',
		'figlet',
		'figures',
		'inquirer',
		'log-update',
		'nanospinner',
		'serialport',
		'blessed',
		'blessed-contrib'
		// Add any other direct dependencies of index.js here
	];

	for (const pkg of essentialPackages) {
		const packagePath = path.join(NODE_MODULES_PATH, pkg);
		if (!fs.existsSync(packagePath)) {
			console.log(`Dependency check failed: Package "${pkg}" not found at ${packagePath}.`);
			return false; // If any essential package is missing, dependencies are not fully installed
		}
	}

	console.log('Dependency check passed: Essential packages found.');
	return true; // All essential packages checked are present
}

/**
 * Finds the actual path to a package manager command
 */
function findPackageManagerPath(command) {
	try {
		// Try to get the actual path to the command
		const commandPath = execSync(`where ${command}`, { encoding: 'utf8' }).trim().split('\n')[0];
		return commandPath;
	} catch (error) {
		// If "where" command fails, try alternative methods
		try {
			// On Windows, try with "npm root -g" to find the npm installation directory
			if (command === 'npm') {
				const npmRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
				const npmBinPath = path.join(path.dirname(npmRoot), 'npm.cmd');
				if (fs.existsSync(npmBinPath)) {
					return npmBinPath;
				}
			}

			// On Windows, pnpm might be installed via npm
			if (command === 'pnpm') {
				const pnpmPath = path.join(process.env.APPDATA || '', 'npm', 'pnpm.cmd');
				if (fs.existsSync(pnpmPath)) {
					return pnpmPath;
				}
			}
		} catch (e) {
			// Ignore errors in fallback methods
		}

		// Return just the command as a last resort
		return command;
	}
}

/**
 * Installs dependencies using the specified package manager
 */
async function installDependencies(packageManager) {
	console.log(`\nInstalling dependencies using ${packageManager}...\n`);

	try {
		// Find the actual path to the package manager
		const managerPath = findPackageManagerPath(packageManager);

		// Check if we should use .cmd extension on Windows
		const isWindows = process.platform === 'win32';
		let command = managerPath;
		let args = ['install'];

		// Special handling for npx fallback
		if (packageManager === 'npx') {
			command = isWindows ? 'npx.cmd' : 'npx';
			args = ['--yes', 'npm', 'install'];
		}

		console.log(`Using command: ${command} ${args.join(' ')}`);

		return new Promise((resolve, reject) => {
			const installProcess = spawn(command, args, {
				cwd: CLI_DIR,
				stdio: 'inherit', // Show output in console
				shell: isWindows // Use shell on Windows for better compatibility
			});

			installProcess.on('close', (code) => {
				if (code === 0) {
					console.log('\nDependencies installed successfully!\n');
					resolve();
				} else {
					reject(new Error(`Installation failed with code ${code}`));
				}
			});

			installProcess.on('error', (err) => {
				console.error(`Installation process error: ${err.message}`);

				// Try fallback to npx if not already using it
				if (packageManager !== 'npx') {
					console.log('\nTrying fallback to npx...');
					installDependencies('npx').then(resolve).catch(reject);
				} else {
					reject(new Error(`Failed to start installation: ${err.message}`));
				}
			});
		});
	} catch (error) {
		console.error(`Error during installation setup: ${error.message}`);
		throw error;
	}
}

/**
 * Runs the Motion Capture CLI
 */
function runCliTool() {
	return new Promise((resolve, reject) => {
		const isWindows = process.platform === 'win32';

		// Reset stdin state before spawning child process
		if (process.stdin.isTTY) {
			process.stdin.setRawMode(false);
		}
		process.stdin.pause();

		// Close readline interface to ensure clean handoff
		if (global.rlInterface) {
			global.rlInterface.close();
		}

		// Wait a moment for I/O streams to reset
		setTimeout(() => {
			// Create a detached process with separate stdio
			const cliProcess = spawn('node', [CLI_SCRIPT], {
				stdio: 'inherit', // Show output in console
				shell: isWindows, // Use shell on Windows for better compatibility
				detached: false // Keep it attached to parent's lifetime
			});

			cliProcess.on('close', (code) => {
				resolve(code);
			});

			cliProcess.on('error', (err) => {
				reject(new Error(`Failed to start CLI tool: ${err.message}`));
			});
		}, 100); // Small delay to ensure cleanup completes
	});
}

/**
 * Detect available package managers
 */
async function detectPackageManagers() {
	const managers = [];

	try {
		execSync('npm --version', { stdio: 'ignore' });
		managers.push('npm');
	} catch (e) {
		// npm not available
	}

	try {
		execSync('pnpm --version', { stdio: 'ignore' });
		managers.push('pnpm');
	} catch (e) {
		// pnpm not available
	}

	try {
		execSync('yarn --version', { stdio: 'ignore' });
		managers.push('yarn');
	} catch (e) {
		// yarn not available
	}

	// Add npx as a last resort if nothing else is available
	if (managers.length === 0) {
		try {
			execSync('npx --version', { stdio: 'ignore' });
			managers.push('npx');
		} catch (e) {
			// npx not available
		}
	}

	return managers;
}

/**
 * Ask user to select a package manager
 */
async function selectPackageManager(availableManagers) {
	if (availableManagers.length === 0) {
		console.error('Error: No package managers (npm, pnpm, or yarn) found.');
		console.error('Please install npm or pnpm to continue.');
		process.exit(1);
	}

	if (availableManagers.length === 1) {
		console.log(`Using ${availableManagers[0]} (only available option)`);
		return availableManagers[0];
	}

	while (true) {
		const managerOptions = availableManagers.join(', ');
		const managerAnswer = await question(
			`Which package manager would you like to use? (${managerOptions}): `
		);

		if (availableManagers.includes(managerAnswer)) {
			return managerAnswer;
		}

		console.log(`Invalid selection. Please choose from: ${managerOptions}`);
	}
}

/**
 * Main function
 */
async function main() {
	try {
		// Verify files and directories
		console.log(`Current directory: ${CLI_DIR}`);

		// Check if CLI script exists
		if (!fs.existsSync(CLI_SCRIPT)) {
			console.error(`Error: CLI script not found at ${CLI_SCRIPT}`);
			console.error('Please make sure all required files are in place.');
			process.exit(1);
		}

		// Check if package.json exists for installation
		const packageJsonPath = path.join(CLI_DIR, 'package.json');
		if (!fs.existsSync(packageJsonPath)) {
			console.error(`Error: package.json not found at ${packageJsonPath}`);
			console.error('Cannot install dependencies without package.json');
			process.exit(1);
		}

		// Check if dependencies are installed
		const dependenciesInstalled = checkDependenciesInstalled();

		if (!dependenciesInstalled) {
			console.log('Motion Capture CLI Tool dependencies are not installed.');

			const installAnswer = await question('Would you like to install them now? (y/n): ');

			if (installAnswer.toLowerCase() === 'y' || installAnswer.toLowerCase() === 'yes') {
				// Detect available package managers
				const availableManagers = await detectPackageManagers();

				// Let user select package manager with retry capability
				const packageManager = await selectPackageManager(availableManagers);

				// Install dependencies
				await installDependencies(packageManager);
			} else {
				console.log('Dependencies are required to run the CLI tool.');
				process.exit(1);
			}
		}

		// Run the CLI tool
		const exitCode = await runCliTool();
		process.exit(exitCode);
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	} finally {
		if (global.rlInterface) {
			global.rlInterface.close();
		}
	}
}

// Run the main function
main();
