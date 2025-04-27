#!/usr/bin/env node

/**
 * Smart Benchmark Runner Script
 *
 * This wrapper script:
 * 1. Checks if dependencies are installed
 * 2. If not, asks user for permission to install them
 * 3. Offers choice of package manager (npm or pnpm)
 * 4. Installs dependencies if needed
 * 5. Runs the benchmark tool
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import readline from 'readline';

// Get directory paths in ESM context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to benchmark tool
const BENCHMARK_DIR = __dirname;
const BENCHMARK_SCRIPT = path.join(BENCHMARK_DIR, 'index.js');
const NODE_MODULES_PATH = path.join(BENCHMARK_DIR, 'node_modules');

// Create logs directory if it doesn't exist
const logsDir = path.join(BENCHMARK_DIR, '..', 'logs');
if (!fs.existsSync(logsDir)) {
	fs.mkdirSync(logsDir, { recursive: true });
}

// Create interactive readline interface
const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

// Promisify readline question
const question = (query) => new Promise((resolve) => rl.question(query, resolve));

/**
 * Checks if dependencies are installed
 */
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
		'serialport',
		'log-update',
		'inquirer',
		'chalk',
		'ora',
		'boxen'
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
				cwd: BENCHMARK_DIR,
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
 * Runs the benchmark tool
 */
function runBenchmark() {
	return new Promise((resolve, reject) => {
		const isWindows = process.platform === 'win32';

		const benchProcess = spawn('node', [BENCHMARK_SCRIPT], {
			stdio: 'inherit', // Show output in console
			shell: isWindows // Use shell on Windows for better compatibility
		});

		benchProcess.on('close', (code) => {
			resolve(code);
		});

		benchProcess.on('error', (err) => {
			reject(new Error(`Failed to start benchmark: ${err.message}`));
		});
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
		console.log(`Current directory: ${BENCHMARK_DIR}`);

		// Check if benchmark script exists
		if (!fs.existsSync(BENCHMARK_SCRIPT)) {
			console.error(`Error: Benchmark script not found at ${BENCHMARK_SCRIPT}`);
			console.error('Please make sure all required files are in place.');
			process.exit(1);
		}

		// Check if package.json exists for installation
		const packageJsonPath = path.join(BENCHMARK_DIR, 'package.json');
		if (!fs.existsSync(packageJsonPath)) {
			console.error(`Error: package.json not found at ${packageJsonPath}`);
			console.error('Cannot install dependencies without package.json');
			process.exit(1);
		}

		// Check if dependencies are installed
		const dependenciesInstalled = checkDependenciesInstalled();

		if (!dependenciesInstalled) {
			console.log('Motion Capture Benchmark Tool dependencies are not installed.');

			const installAnswer = await question('Would you like to install them now? (y/n): ');

			if (installAnswer.toLowerCase() === 'y' || installAnswer.toLowerCase() === 'yes') {
				// Detect available package managers
				const availableManagers = await detectPackageManagers();

				// Let user select package manager with retry capability
				const packageManager = await selectPackageManager(availableManagers);

				// Install dependencies
				await installDependencies(packageManager);
			} else {
				console.log('Dependencies are required to run the benchmark tool.');
				process.exit(1);
			}
		}

		// Run the benchmark
		const exitCode = await runBenchmark();
		process.exit(exitCode);
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	} finally {
		rl.close();
	}
}

// Run the main function
main();
