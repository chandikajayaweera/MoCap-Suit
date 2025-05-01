<script>
	import { onDestroy } from 'svelte';
	import {
		recordedAnimations,
		isRecording,
		startRecording,
		stopRecording,
		playRecording,
		stopPlayback,
		currentPlayback,
		playbackProgress,
		addRecordingFrame,
		sensorData
	} from '$lib/stores/motionStore.js';

	// Props using Svelte 5 $props rune
	let { isConnected = false, isStreaming = false } = $props();

	// Local state with Svelte 5 $state rune
	let selectedRecording = $state(null);
	let playbackInterval = $state(null);
	let recordingName = $state('');

	// Format time in mm:ss format
	function formatTime(ms) {
		const totalSeconds = Math.floor(ms / 1000);
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
	}

	// Start recording with custom name
	function handleStartRecording() {
		startRecording();
		if (recordingName) {
			$recordedAnimations[$recordedAnimations.length - 1].name = recordingName;
		}
		recordingName = '';
	}

	// Start playback of selected recording
	function handlePlayRecording() {
		if (!selectedRecording) return;

		const recording = $recordedAnimations.find((r) => r.id === selectedRecording);
		if (!recording || !recording.frames.length) return;

		playRecording(selectedRecording);

		// Set up interval for playback
		if (playbackInterval) clearInterval(playbackInterval);

		let currentFrameIndex = 0;
		const startTime = Date.now();

		playbackInterval = setInterval(() => {
			const elapsed = Date.now() - startTime;

			// Find frame based on elapsed time
			while (
				currentFrameIndex < recording.frames.length - 1 &&
				recording.frames[currentFrameIndex + 1].relativeTime <= elapsed
			) {
				currentFrameIndex++;
			}

			// Update sensorData with current frame
			const frame = recording.frames[currentFrameIndex];
			sensorData.set(frame.data);

			// Update progress
			playbackProgress.set(elapsed / recording.duration);

			// Stop at end
			if (currentFrameIndex >= recording.frames.length - 1 || elapsed >= recording.duration) {
				clearInterval(playbackInterval);
				playbackInterval = null;
				sensorData.set(recording.frames[recording.frames.length - 1].data);
				playbackProgress.set(1);

				// Reset after 500ms
				setTimeout(() => {
					stopPlayback();
				}, 500);
			}
		}, 16); // ~60fps
	}

	// Stop current playback
	function handleStopPlayback() {
		if (playbackInterval) {
			clearInterval(playbackInterval);
			playbackInterval = null;
		}
		stopPlayback();
	}

	// Delete a recording
	function handleDeleteRecording(id) {
		if (confirm('Are you sure you want to delete this recording?')) {
			// Stop playback if this recording is playing
			if ($currentPlayback && $currentPlayback.id === id) {
				handleStopPlayback();
			}

			// Remove from list
			recordedAnimations.update((recordings) => recordings.filter((r) => r.id !== id));

			// Clear selection if deleted
			if (selectedRecording === id) {
				selectedRecording = null;
			}
		}
	}

	// Update recording frame on new data
	$effect(() => {
		if ($isRecording && $sensorData) {
			addRecordingFrame($sensorData);
		}
	});

	// Cleanup on component destroy
	onDestroy(() => {
		if (playbackInterval) {
			clearInterval(playbackInterval);
		}
	});
</script>

<div class="rounded-lg bg-white p-4 shadow-md">
	<h2 class="mb-4 text-lg font-semibold">Motion Recording</h2>

	<!-- Recording controls -->
	<div class="mb-4">
		<div class="flex items-end gap-2">
			<div class="flex-grow">
				<label for="recording-name" class="mb-1 block text-xs font-medium">Recording Name</label>
				<input
					id="recording-name"
					type="text"
					bind:value={recordingName}
					placeholder="New recording"
					class="w-full rounded border border-gray-300 p-1.5 text-sm"
					disabled={$isRecording}
				/>
			</div>

			{#if !$isRecording}
				<button
					onclick={handleStartRecording}
					disabled={!isStreaming}
					class="rounded bg-red-600 px-3 py-1.5 text-white hover:bg-red-700 disabled:bg-red-300"
				>
					Start Recording
				</button>
			{:else}
				<button
					onclick={stopRecording}
					class="rounded bg-gray-600 px-3 py-1.5 text-white hover:bg-gray-700"
				>
					Stop Recording
				</button>
			{/if}
		</div>

		{#if $isRecording}
			<div class="mt-2 flex items-center">
				<span class="mr-2 flex h-3 w-3 items-center">
					<span class="absolute h-3 w-3 animate-ping rounded-full bg-red-400 opacity-75"></span>
					<span class="relative h-2 w-2 rounded-full bg-red-500"></span>
				</span>
				<span class="text-sm">Recording in progress...</span>
			</div>
		{/if}
	</div>

	<!-- Recordings list -->
	<div class="mb-4">
		<h3 class="mb-2 text-sm font-medium">Saved Recordings</h3>

		{#if $recordedAnimations.length === 0}
			<div
				class="rounded border border-dashed border-gray-300 p-4 text-center text-sm text-gray-500"
			>
				No recordings yet. Record a motion sequence to use for testing.
			</div>
		{:else}
			<div class="max-h-48 overflow-y-auto">
				<ul class="divide-y divide-gray-200">
					{#each $recordedAnimations as recording}
						<li class="py-2">
							<div class="flex items-center justify-between">
								<label
									class="flex items-center text-sm"
									class:font-medium={selectedRecording === recording.id}
								>
									<input
										type="radio"
										name="recording"
										value={recording.id}
										bind:group={selectedRecording}
										class="mr-2"
									/>
									<div>
										<div>{recording.name}</div>
										<div class="text-xs text-gray-500">
											{recording.frameCount} frames • {formatTime(recording.duration)}
										</div>
									</div>
								</label>

								<button
									onclick={() => handleDeleteRecording(recording.id)}
									class="rounded p-1 text-red-600 hover:bg-red-50"
									title="Delete recording"
									aria-label="Delete recording"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										class="h-4 w-4"
										viewBox="0 0 20 20"
										fill="currentColor"
									>
										<path
											fill-rule="evenodd"
											d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
											clip-rule="evenodd"
										/>
									</svg>
								</button>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>

	<!-- Playback controls -->
	<div>
		<div class="mb-2 flex gap-2">
			{#if !$currentPlayback}
				<button
					onclick={handlePlayRecording}
					disabled={!selectedRecording}
					class="flex-1 rounded bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 disabled:bg-blue-300"
				>
					Play Selected
				</button>
			{:else}
				<button
					onclick={handleStopPlayback}
					class="flex-1 rounded bg-gray-600 px-3 py-1.5 text-white hover:bg-gray-700"
				>
					Stop Playback
				</button>
			{/if}
		</div>

		{#if $currentPlayback}
			<div class="mb-1 text-sm">
				<div class="flex justify-between">
					<span>Playing: {$currentPlayback.name}</span>
					<span>
						{formatTime($currentPlayback.duration * $playbackProgress)} /
						{formatTime($currentPlayback.duration)}
					</span>
				</div>
			</div>
			<div class="h-2 w-full overflow-hidden rounded-full bg-gray-200">
				<div
					class="h-full bg-blue-600 transition-all"
					style="width: {$playbackProgress * 100}%"
				></div>
			</div>
		{/if}
	</div>

	<!-- Tips -->
	<div class="mt-4 text-xs text-gray-500">
		<p>Tips:</p>
		<ul class="ml-4 list-disc">
			<li>Record a T-pose and common movements for testing</li>
			<li>Use recorded data to test visualizations without wearing sensors</li>
			<li>Recordings are stored in memory only and will be lost on page refresh</li>
		</ul>
	</div>
</div>
