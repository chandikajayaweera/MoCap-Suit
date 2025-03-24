<script>
	export let connected = false;
	export let onSendCommand = () => {};

	// Command definitions with descriptions
	const commands = [
		{
			id: 'S',
			label: 'Start Streaming',
			description: 'Start sensor data streaming',
			category: 'streaming'
		},
		{
			id: 'X',
			label: 'Stop Streaming',
			description: 'Stop sensor data streaming',
			category: 'streaming'
		},
		{ id: 'N', label: 'Restart Node', description: 'Restart the sensor node', category: 'system' },
		{ id: 'R', label: 'Restart Receiver', description: 'Restart the receiver', category: 'system' },
		{ id: 'C', label: 'Check Sensors', description: 'Check sensor status', category: 'sensors' },
		{
			id: 'I',
			label: 'Initialize Sensors',
			description: 'Reinitialize all sensors',
			category: 'sensors'
		},
		{
			id: 'P',
			label: 'Ping Node',
			description: 'Ping the node to check connection',
			category: 'system'
		},
		{ id: 'D', label: 'Debug Mode', description: 'Toggle debug mode', category: 'system' },
		{ id: 'Q', label: 'Quit Receiver', description: 'Shutdown the receiver', category: 'system' }
	];

	// Group commands by category
	const commandsByCategory = commands.reduce((acc, cmd) => {
		if (!acc[cmd.category]) {
			acc[cmd.category] = [];
		}
		acc[cmd.category].push(cmd);
		return acc;
	}, {});

	function handleCommand(command) {
		if (!connected) return;

		// Special case for dangerous commands
		if (command === 'Q' || command === 'R') {
			if (
				!confirm(
					`Are you sure you want to ${command === 'Q' ? 'shutdown the receiver' : 'restart the receiver'}?`
				)
			) {
				return;
			}
		}

		onSendCommand(command);
	}
</script>

<div class="flex h-full flex-col">
	<h2 class="mb-4 text-lg font-semibold">Commands</h2>

	{#if !connected}
		<div class="mb-4 rounded-md bg-yellow-100 p-3 text-yellow-800">
			Please connect to the system first to send commands.
		</div>
	{/if}

	<!-- Commands grouped by category -->
	{#each Object.entries(commandsByCategory) as [category, categoryCommands]}
		<div class="mb-6">
			<h3 class="mb-2 font-medium text-gray-700 capitalize">{category} Controls</h3>
			<div class="space-y-2">
				{#each categoryCommands as command}
					<button
						on:click={() => handleCommand(command.id)}
						disabled={!connected}
						class="flex w-full items-center justify-between rounded border border-gray-300 px-3 py-2 text-left transition-colors"
						class:bg-gray-100={!connected}
						class:hover:bg-blue-50={connected}
					>
						<div>
							<span class="font-medium">{command.label}</span>
							<span class="block text-xs text-gray-500">{command.description}</span>
						</div>
						<span class="rounded bg-gray-200 px-2 py-1 text-xs">{command.id}</span>
					</button>
				{/each}
			</div>
		</div>
	{/each}

	<div class="mt-auto">
		<div class="rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
			<p class="mb-1 font-medium">Command Legend:</p>
			<ul class="space-y-1 text-xs">
				<li><strong>S</strong> - Start streaming sensor data</li>
				<li><strong>X</strong> - Stop streaming sensor data</li>
				<li><strong>C</strong> - Check sensor status</li>
				<li><strong>I</strong> - Reinitialize sensors</li>
				<li><strong>N</strong> - Restart node</li>
				<li><strong>R</strong> - Restart receiver</li>
				<li><strong>Q</strong> - Quit/shutdown receiver</li>
			</ul>
		</div>
	</div>
</div>
