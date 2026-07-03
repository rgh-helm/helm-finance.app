<script setup>
import { ref } from 'vue'
import dataEngine from '../lib/dataEngine.js'

const emit = defineEmits(['ready'])

const importing = ref(false)
const error = ref('')
const dragActive = ref(false)
const fileInput = ref(null)

function startFresh() {
  dataEngine.createNew()
  emit('ready')
}

function openFilePicker() {
  fileInput.value?.click()
}

async function handleFile(file) {
  if (!file) return
  error.value = ''
  importing.value = true
  try {
    const text = await file.text()
    const payload = JSON.parse(text)
    dataEngine.restoreFromPayload(payload)
    emit('ready')
  } catch (err) {
    error.value = err.message || 'Could not read that file. Make sure it is a Helm data.json backup.'
  } finally {
    importing.value = false
  }
}

function onFileInputChange(e) {
  const file = e.target.files?.[0]
  handleFile(file)
  e.target.value = ''
}

function onDrop(e) {
  dragActive.value = false
  const file = e.dataTransfer?.files?.[0]
  handleFile(file)
}
</script>

<template>
  <div class="min-h-dvh flex items-center justify-center bg-base-100 px-4 py-6" data-theme="ledger">
    <div class="w-full max-w-md space-y-6">
      <div class="text-center space-y-2">
        <h1 class="font-display text-3xl font-semibold">Helm</h1>
        <p class="text-sm text-base-content/60">
          Your data lives only in this browser tab and in files you control — nothing is sent
          anywhere. Start a fresh data file, or import a data.json you've exported before.
        </p>
      </div>

      <div class="rounded-lg border border-base-300 bg-base-200 p-5 space-y-3">
        <h2 class="font-display font-semibold">Start fresh</h2>
        <p class="text-sm text-base-content/60">
          Create a new, empty data file and walk through quick setup.
        </p>
        <button type="button" class="btn btn-primary btn-sm" @click="startFresh">
          Create new data file
        </button>
      </div>

      <div
        class="rounded-lg border-2 border-dashed p-5 space-y-3 transition-colors"
        :class="dragActive ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-200'"
        @dragover.prevent="dragActive = true"
        @dragleave.prevent="dragActive = false"
        @drop.prevent="onDrop"
      >
        <h2 class="font-display font-semibold">Import existing data</h2>
        <p class="text-sm text-base-content/60">
          Drag a data.json backup file here, or pick one from your computer.
        </p>
        <button type="button" class="btn btn-outline btn-sm" :disabled="importing" @click="openFilePicker">
          {{ importing ? 'Importing…' : 'Choose data.json file' }}
        </button>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          class="hidden"
          @change="onFileInputChange"
        />
        <p v-if="error" class="text-xs text-error">{{ error }}</p>
      </div>
    </div>
  </div>
</template>