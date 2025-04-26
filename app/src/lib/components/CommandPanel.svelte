<script>
	// Standard prop declarations
	export let connected = false;
	export let isStreaming = false; // Whether streaming is active
	export let onSendCommand = () => {};

	// Command definitions with better streaming control logic
	const commands = [
		{
			id: 'S',
			label: 'Start Streaming',
			description: 'Start sensor data streaming',
			category: 'streaming',
			confirm: false,
			// Only enable when not streaming
			isDisabled: (connected, streaming) => !connected || streaming,
			highlight: false
		},
		{
			id: 'X',
			label: 'Stop Streaming',
			description: 'Stop sensor data streaming',
			category: 'streaming',
			confirm: false,
			// Only enable when streaming
			isDisabled: (connected, streaming) => !connected || !streaming,
			highlight: true
		},
		{
			id: 'N',
			label: 'Restart Node',
			description: 'Restart the sensor node',
			category: 'system',
			confirm: true,
			// Disable during streaming
			isDisabled: (connected, streaming) => !connected || streaming
		},
		{
			id: 'R',
			label: 'Restart Receiver',
			description: 'Restart the receiver',
			category: 'system',
			confirm: true,
			// Disable during streaming
			isDisabled: (connected, streaming) => !connected || streaming
		},
		{
			id: 'C',
			label: 'Check Sensors',
			description: 'Check sensor status',
			category: 'sensors',
			confirm: false,
			// Disable during streaming
			isDisabled: (connected, streaming) => !connected || streaming
		},
		{
			id: 'I',
			label: 'Initialize Sensors',
			description: 'Reinitialize all sensors',
			category: 'sensors',
			confirm: false,
			// Disable during streaming
			isDisabled: (connected, streaming) => !connected || streaming
		},
		{
			id: 'P',
			label: 'Ping Node',
			description: 'Ping the node to check connection',
			category: 'system',
			confirm: false,
			// Always enabled when connected
			isDisabled: (connected) => !connected
		},
		{
			id: 'D:0',
			label: 'Debug Mode (Verbose)',
			description: 'Set log level to DEBUG (most verbose)',
			category: 'logging',
			confirm: false,
			// Always enabled when connected
			isDisabled: (connected) => !connected
		},
		{
			id: 'D:1',
			label: 'Info Mode',
			description: 'Set log level to INFO (normal)',
			category: 'logging',
			confirm: false,
			// Always enabled when connected
			isDisabled: (connected) => !connected
		},
		{
			id: 'D:2',
			label: 'Warning Mode',
			description: 'Set log level to WARNING (less verbose)',
			category: 'logging',
			confirm: false,
			// Always enabled when connected
			isDisabled: (connected) => !connected
		},
		{
			id: 'D:3',
			label: 'Error Mode',
			description: 'Set log level to ERROR (critical only)',
			category: 'logging',
			confirm: false,
			// Always enabled when connected
			isDisabled: (connected) => !connected
		},
		{
			id: 'Q',
			label: 'Quit Receiver',
			description: 'Shutdown the receiver',
			category: 'system',
			confirm: true,
			// Disable during streaming
			isDisabled: (connected, streaming) => !connected || streaming
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
		if (!cmd) return;

		// Check if command is disabled
		if (cmd.isDisabled(connected, isStreaming)) return;

		// Confirm if needed
		if (cmd.confirm && !confirm(`Are you sure you want to ${cmd.label.toLowerCase()}?`)) {
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

	{#if isStreaming}
		<div class="mb-4 rounded-md bg-green-50 p-3 text-green-800 shadow-sm">
			<div class="flex items-center">
				<span class="mr-2 inline-block h-3 w-3 animate-pulse rounded-full bg-green-500"></span>
				<span>Streaming is active! Some commands are disabled during streaming.</span>
			</div>
		</div>
	{/if}

	{#each Object.entries(commandsByCategory) as [category, cmds]}
		<div class="mb-5">
			<h3 class="mb-2 font-medium capitalize text-gray-700">
				{category} Controls
			</h3>
			<div class="space-y-2">
				{#each cmds as command}
					{@const disabled = command.isDisabled(connected, isStreaming)}
					{@const isStopCmd = command.id === 'X'}
					{@const isActiveStreaming = isStreaming && command.id === 'S'}

					<button
						onclick={() => handleCommand(command.id)}
						{disabled}
						class="group flex w-full items-center justify-between rounded border px-3 py-2 text-left shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
						class:border-gray-300={!isActiveStreaming && !isStopCmd}
						class:border-green-500={isActiveStreaming}
						class:border-red-500={isStopCmd && isStreaming}
						class:bg-white={!isActiveStreaming && !isStopCmd}
						class:bg-green-50={isActiveStreaming}
						class:bg-red-50={isStopCmd && isStreaming}
						class:hover:bg-blue-50={!disabled && !isActiveStreaming && !isStopCmd}
						class:hover:bg-red-100={!disabled && isStopCmd && isStreaming}
						class:opacity-60={disabled}
						class:hover:bg-white={disabled}
					>
						<div>
							<span
								class="font-medium"
								class:text-green-700={isActiveStreaming}
								class:text-red-700={isStopCmd && isStreaming}
							>
								{command.label}
							</span>
							<span class="block text-xs text-gray-500">{command.description}</span>
						</div>
						<span
							class="flex h-6 min-w-6 items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold group-hover:bg-gray-300"
							class:bg-gray-200={!isActiveStreaming && !isStopCmd}
							class:bg-green-200={isActiveStreaming}
							class:bg-red-200={isStopCmd && isStreaming}
							class:text-gray-800={!isActiveStreaming && !isStopCmd}
							class:text-green-800={isActiveStreaming}
							class:text-red-800={isStopCmd && isStreaming}
						>
							{command.id}
						</span>
					</button>
				{/each}
			</div>
		</div>
	{/each}
</div>
