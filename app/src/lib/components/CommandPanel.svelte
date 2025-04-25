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
	<h2 class="mb-4 text-lg font-semibold text-gray-800">Commands</h2>

	{#if !connected}
		<div class="mb-4 rounded-md bg-yellow-50 p-3 text-yellow-800 shadow-sm">
			Please connect to the system first to send commands.
		</div>
	{/if}

	<!-- Commands grouped by category -->
	{#each Object.entries(commandsByCategory) as [category, categoryCommands]}
		<div class="mb-5">
			<h3 class="mb-2 font-medium capitalize text-gray-700">{category} Controls</h3>
			<div class="space-y-2">
				{#each categoryCommands as command}
					<button
						on:click={() => handleCommand(command.id)}
						disabled={!connected}
						class="flex w-full items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-left shadow-sm transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-60 disabled:hover:bg-white"
						class:bg-gray-100={!connected}
						class:hover:bg-blue-50={connected}
					>
						<div>
							<span class="font-medium">{command.label}</span>
							<span class="block text-xs text-gray-500">{command.description}</span>
						</div>
						<span
							class="flex h-6 min-w-6 items-center justify-center rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-800"
							>{command.id}</span
						>
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>
