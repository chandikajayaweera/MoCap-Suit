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
		setLoading,
		toggleDebug
	} from '$lib/stores/motionStore.js';

	import ModelSelector from './ModelSelector.svelte';
	import EnvironmentSelector from './EnvironmentSelector.svelte';
	import { setupScene, cleanupScene } from '$lib/three/engine.js';
	import { createBasicModel, loadModel } from '$lib/three/models.js';
	import { applyEnvironment } from '$lib/three/environments.js';
	import { updateModelWithSensorData, setSkeletonVisibility } from '$lib/three/animation.js';

	// Props
	export let data;
	export let isConnected = false;

	// Local
	let container;
	let sceneContext = null;
	let initialized = false;

	// Push incoming props/data into the stores
	$: setConnected(isConnected);
	$: if (data?.sensorData) {
		updateSensorData(data.sensorData);
	}

	// Once the scene exists, react to store changes:
	$: if (initialized && sceneContext) {
		applyEnvironment(sceneContext, $selectedEnvironment);
		loadModelIntoScene($selectedModel);
		setSkeletonVisibility(sceneContext, $showSkeleton);
	}

	// Animate when new sensor data arrives
	$: if (initialized && sceneContext && data?.sensorData) {
		updateModelWithSensorData(sceneContext, data.sensorData, $selectedModel);
	}

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

	$: if (sceneContext) {
		setSkeletonVisibility(sceneContext, $showSkeleton);
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
			<input type="checkbox" bind:checked={$showSkeleton} class="mr-1" />
			Show Skeleton
		</label>

		{#if import.meta.env.DEV}
			<label class="ml-auto flex items-center">
				<input type="checkbox" bind:checked={$debugMode} on:change={toggleDebug} class="mr-1" />
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

	<!-- Canvas container (now properly closed!) -->
	<div bind:this={container} class="relative flex-grow"></div>
</div>

<style>
	/* Add component-scoped styles here if needed */
</style>
