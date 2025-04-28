<script>
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import {
		selectedModel,
		selectedEnvironment,
		showSkeleton,
		debugMode,
		loading,
		updateSensorData,
		setConnected,
		setLoading
	} from '$lib/stores/motionStore.js';

	import ModelSelector from './ModelSelector.svelte';
	import EnvironmentSelector from './EnvironmentSelector.svelte';
	import { setupScene, cleanupScene } from '$lib/three/engine.js';
	import { createBasicModel, loadModel } from '$lib/three/models.js';
	import { applyEnvironment } from '$lib/three/environments.js';
	import { updateModelWithSensorData, setSkeletonVisibility } from '$lib/three/animation.js';

	// Props using Svelte 5 runes syntax
	let { data, isConnected = false } = $props();

	// Local
	let container;
	let sceneContext = null;
	let initialized = false;

	// Local state for toggles (to ensure reactivity in Svelte 5)
	let showSkeletonValue = $state(false);
	let debugModeValue = $state(false);

	// Sync local state with store values initially and when changed
	$effect(() => {
		showSkeletonValue = $showSkeleton;
	});

	$effect(() => {
		debugModeValue = $debugMode;
	});

	// Push incoming props/data into the stores
	$effect(() => {
		setConnected(isConnected);
	});

	$effect(() => {
		if (data?.sensorData) {
			updateSensorData(data.sensorData);
		}
	});

	// Once the scene exists, react to store changes:
	$effect(() => {
		if (initialized && sceneContext) {
			applyEnvironment(sceneContext, $selectedEnvironment);
			loadModelIntoScene($selectedModel);
		}
	});

	// Animate when new sensor data arrives
	$effect(() => {
		if (initialized && sceneContext && data?.sensorData) {
			updateModelWithSensorData(sceneContext, data.sensorData, $selectedModel);
		}
	});

	// React to skeleton visibility changes
	$effect(() => {
		if (sceneContext && sceneContext.skeleton) {
			setSkeletonVisibility(sceneContext, showSkeletonValue);
		}
	});

	// Helper to load a model
	async function loadModelIntoScene(modelId) {
		setLoading(true);
		if (modelId === 'basic') {
			await createBasicModel(sceneContext);
		} else {
			await loadModel(sceneContext, modelId);
		}
		setLoading(false);
	}

	// Toggle handlers with direct store updates
	function handleSkeletonToggle() {
		// Update local state
		showSkeletonValue = !showSkeletonValue;

		// Update the store
		showSkeleton.set(showSkeletonValue);

		console.log(`Show skeleton toggled to: ${showSkeletonValue}`);

		// Update visualization immediately
		if (sceneContext) {
			setSkeletonVisibility(sceneContext, showSkeletonValue);
		}
	}

	function handleDebugToggle() {
		// Update local state
		debugModeValue = !debugModeValue;

		// Update the store
		debugMode.set(debugModeValue);

		console.log(`Debug mode toggled to: ${debugModeValue}`);

		// Send debug state to server
		if (browser) {
			fetch('/api/debug', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({ debug: debugModeValue })
			}).catch((err) => console.error('Failed to update debug setting:', err));
		}
	}

	onMount(() => {
		if (!browser) return;

		let cleanup = () => {};

		(async () => {
			try {
				sceneContext = await setupScene(container);

				// initial environment & model
				applyEnvironment(sceneContext, $selectedEnvironment);
				await loadModelIntoScene($selectedModel);

				// Initialize skeleton visibility
				if (sceneContext.skeleton) {
					setSkeletonVisibility(sceneContext, showSkeletonValue);
				}

				initialized = true;

				cleanup = () => {
					cleanupScene(sceneContext);
					sceneContext = null;
				};
			} catch (err) {
				console.error('Error initializing 3D scene:', err);
			}
		})();

		return () => cleanup();
	});

	onDestroy(() => {
		if (sceneContext) cleanupScene(sceneContext);
	});
</script>

<div class="flex h-full flex-col">
	<!-- Controls bar -->
	<div class="mb-2 flex flex-wrap items-center gap-2 bg-gray-100 p-2">
		<ModelSelector />
		<EnvironmentSelector />

		<label class="flex items-center">
			<input
				type="checkbox"
				checked={showSkeletonValue}
				onclick={handleSkeletonToggle}
				class="mr-1"
			/>
			Show Skeleton
		</label>

		{#if import.meta.env.DEV || true}
			<label class="ml-auto flex items-center">
				<input type="checkbox" checked={debugModeValue} onclick={handleDebugToggle} class="mr-1" />
				Debug Mode
			</label>
		{/if}
	</div>

	<!-- Loader overlay -->
	{#if $loading}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-black bg-opacity-30">
			<div class="rounded bg-white p-4 shadow-lg">
				<p class="text-lg">Loading model…</p>
			</div>
		</div>
	{/if}

	<!-- Inactive state -->
	{#if !isConnected}
		<div class="absolute inset-0 z-10 flex items-center justify-center bg-gray-100 bg-opacity-80">
			<div class="rounded bg-white p-4 text-center shadow-md">
				<h3 class="mb-2 text-lg font-medium text-gray-800">Visualization Inactive</h3>
				<p class="text-gray-600">
					Connect to the system and start streaming to see sensor data visualization.
				</p>
			</div>
		</div>
	{/if}

	<!-- Canvas container -->
	<div bind:this={container} class="relative flex-grow"></div>
</div>
