<script>
	// Standard prop declarations
	export let connected = false;
	export let onSendCommand = () => {};

	// Command definitions
	const commands = [
		{
			id: 'S',
			label: 'Start Streaming',
			description: 'Start sensor data streaming',
			category: 'streaming',
			confirm: false
		},
		{
			id: 'X',
			label: 'Stop Streaming',
			description: 'Stop sensor data streaming',
			category: 'streaming',
			confirm: false
		},
		{
			id: 'N',
			label: 'Restart Node',
			description: 'Restart the sensor node',
			category: 'system',
			confirm: true
		},
		{
			id: 'R',
			label: 'Restart Receiver',
			description: 'Restart the receiver',
			category: 'system',
			confirm: true
		},
		{
			id: 'C',
			label: 'Check Sensors',
			description: 'Check sensor status',
			category: 'sensors',
			confirm: false
		},
		{
			id: 'I',
			label: 'Initialize Sensors',
			description: 'Reinitialize all sensors',
			category: 'sensors',
			confirm: false
		},
		{
			id: 'P',
			label: 'Ping Node',
			description: 'Ping the node to check connection',
			category: 'system',
			confirm: false
		},
		{
			id: 'D',
			label: 'Debug Mode',
			description: 'Toggle debug mode',
			category: 'system',
			confirm: false
		},
		{
			id: 'Q',
			label: 'Quit Receiver',
			description: 'Shutdown the receiver',
			category: 'system',
			confirm: true
		}
	];

	// Reactive grouping by category
	$: commandsByCategory = commands.reduce((acc, cmd) => {
		(acc[cmd.category] ||= []).push(cmd);
		return acc;
	}, /** @type {Record<string, typeof commands>} */ ({}));

	function handleCommand(id) {
		if (!connected) return;

		const cmd = commands.find((c) => c.id === id);
		if (cmd?.confirm && !confirm(`Are you sure you want to ${cmd.label.toLowerCase()}?`)) {
			return;
		}

		onSendCommand(id);
	}
</script>

<div class="flex h-full flex-col">
	<h2 class="mb-4 text-lg font-semibold text-gray-800">Commands</h2>

	{#if !connected}
		<div class="mb-4 rounded-md bg-yellow-50 p-3 text-yellow-800 shadow-sm">
			Please connect to the system first to send commands.
		</div>
	{/if}

	{#each Object.entries(commandsByCategory) as [category, cmds]}
		<div class="mb-5">
			<h3 class="mb-2 font-medium capitalize text-gray-700">
				{category} Controls
			</h3>
			<div class="space-y-2">
				{#each cmds as command}
					<button
						on:click={() => handleCommand(command.id)}
						disabled={!connected}
						class="flex w-full items-center justify-between rounded border border-gray-300 bg-white px-3 py-2 text-left shadow-sm transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 disabled:opacity-60 disabled:hover:bg-white"
					>
						<div>
							<span class="font-medium">{command.label}</span>
							<span class="block text-xs text-gray-500">{command.description}</span>
						</div>
						<span
							class="flex h-6 min-w-6 items-center justify-center rounded bg-gray-200 px-1.5 py-0.5 text-xs font-semibold text-gray-800"
						>
							{command.id}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>
