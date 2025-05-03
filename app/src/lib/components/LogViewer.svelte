<script>
	let { logs = [], onClearLogs = () => {} } = $props();

	let filterText = $state('');
	let filterLevel = $state('all');
	let autoscroll = $state(true);

	let logContainer;

	const filteredLogs = $derived(
		logs.filter((log) => {
			const matchesText =
				!filterText || log.message.toLowerCase().includes(filterText.toLowerCase());
			const matchesLevel =
				filterLevel === 'all' ||
				(filterLevel === 'error' && log.message.includes('[ERROR]')) ||
				(filterLevel === 'warning' && log.message.includes('[WARNING]')) ||
				(filterLevel === 'debug' && log.message.includes('[DEBUG]'));

			return matchesText && matchesLevel;
		})
	);

	function getLogStyle(message) {
		if (message.includes('[ERROR]')) return 'text-red-600';
		if (message.includes('[WARNING]')) return 'text-yellow-600';
		if (message.includes('[DEBUG]')) return 'text-blue-600';
		return 'text-gray-800';
	}

	function formatTimestamp(date) {
		return date.toLocaleTimeString();
	}

	function scrollToBottom() {
		if (logContainer) {
			logContainer.scrollTop = logContainer.scrollHeight;
		}
	}

	$effect(() => {
		if (autoscroll && logContainer && filteredLogs.length > 0) {
			setTimeout(scrollToBottom, 10);
		}
	});

	function handleScroll() {
		if (!logContainer) return;

		const atBottom =
			Math.abs(logContainer.scrollHeight - logContainer.clientHeight - logContainer.scrollTop) <
			300;

		if (!atBottom && autoscroll) {
			autoscroll = false;
		}
	}

	function handleClear() {
		if (typeof onClearLogs === 'function') {
			onClearLogs();
		}
	}

	function isSensorMessage(message) {
		return message.includes('Command successful:') && message.includes('Sensor ');
	}

	function isLogGroupMessage(message) {
		return message.includes('LOG:') && message.split('LOG:').length > 2;
	}

	function parseSensorData(message) {
		if (!isSensorMessage(message)) return null;

		const parts = message.split('Sensor ');
		const prefix = parts[0];
		const sensors = parts.slice(1).map((part) => 'Sensor ' + part.trim());

		return {
			prefix,
			sensors
		};
	}

	function parseLogGroup(message) {
		if (!isLogGroupMessage(message)) return null;

		return message
			.split('LOG:')
			.filter((part) => part.trim().length > 0)
			.map((part) => 'LOG:' + part.trim());
	}
</script>

<div class="flex h-full flex-col">
	<!-- Log controls -->
	<div class="mb-2 space-y-2 border-b border-gray-200 pb-2">
		<div class="flex items-center gap-2">
			<input
				type="text"
				bind:value={filterText}
				placeholder="Filter logs..."
				class="flex-grow rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			/>

			<select
				bind:value={filterLevel}
				class="rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
			>
				<option value="all">All Levels</option>
				<option value="error">Errors</option>
				<option value="warning">Warnings</option>
				<option value="debug">Debug</option>
			</select>

			<button
				onclick={handleClear}
				class="rounded bg-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-400"
			>
				Clear
			</button>
		</div>

		<div class="flex items-center">
			<label class="flex items-center text-sm text-gray-700">
				<input
					type="checkbox"
					bind:checked={autoscroll}
					class="mr-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
				/>
				Auto-scroll
			</label>
		</div>
	</div>

	<!-- Log display -->
	<div
		bind:this={logContainer}
		onscroll={handleScroll}
		class="mb-4 flex-grow overflow-y-auto rounded bg-gray-50 p-2 font-mono text-xs shadow-inner"
	>
		{#if filteredLogs.length === 0}
			<div class="italic text-gray-500">No logs to display.</div>
		{:else}
			{#each filteredLogs as log}
				<div class={getLogStyle(log.message)}>
					<div class="mb-1 leading-normal">
						<span class="text-gray-500">[{formatTimestamp(log.timestamp)}]</span>

						{#if isSensorMessage(log.message)}
							{@const sensorData = parseSensorData(log.message)}
							<span>{sensorData.prefix}</span>
							{#each sensorData.sensors as sensor, i}
								<div class="ml-4 mt-2">{sensor}</div>
							{/each}
						{:else if isLogGroupMessage(log.message)}
							{@const logGroups = parseLogGroup(log.message)}
							{#each logGroups as logMsg, i}
								<div class={i > 0 ? 'mt-2' : ''}>{logMsg}</div>
							{/each}
						{:else}
							<span>{log.message}</span>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
</div>
