<script setup>
import { onMounted, ref, computed } from 'vue'
import NavBar from './components/NavBar.vue'
import OnboardingWizard from './components/OnboardingWizard.vue'
import ToastNotification from './components/ToastNotification.vue'
import NauticalBackground from './components/NauticalBackground.vue'
import DataGate from './components/DataGate.vue'
import dataEngine from './lib/dataEngine.js'
import { useFinanceStore } from './stores/financeStore'
import { useGoalsStore } from './stores/goalsStore'
import { useCreditCardStore } from './stores/creditCardStore'
import { useSettingsStore } from './stores/settingsStore'
import { useCategoriesStore } from './stores/categoriesStore'
import { useIncomeOptionsStore } from './stores/incomeOptionsStore'
import { useAccountsStore } from './stores/accountsStore'

const finance = useFinanceStore()
const goals = useGoalsStore()
const cards = useCreditCardStore()
const settings = useSettingsStore()
const categoriesStore = useCategoriesStore()
const incomeOptionsStore = useIncomeOptionsStore()
const accountsStore = useAccountsStore()
const appVersion = ref('')

// Unlike the Electron app (which silently created/loaded data.json from
// the OS app-config folder on first run), the web build requires the
// user to explicitly create a new data file or import an existing one
// before the app loads any data. needsDataGate reflects that.
const needsDataGate = ref(!dataEngine.hasData())
const appReady = ref(false)

async function initApp() {
  // Settings/categories/accounts/forecast load alongside the rest —
  // financeStore's house/emergency fund totals and blended growth rates,
  // and the Dashboard/Monthly-Entry forecast features, all read these
  // reactively, so they just need to be in place eventually, not
  // necessarily awaited before anything else.
  await Promise.all([
    finance.loadSnapshots(),
    cards.loadAll(),
    settings.loadSettings(),
    categoriesStore.loadCategories(),
    incomeOptionsStore.loadIncomeOptions(),
    accountsStore.loadAll(),
  ])
  await goals.loadScenarios()
  appVersion.value = await window.api.getAppVersion()
  appReady.value = true
}

onMounted(async () => {
  if (!needsDataGate.value) await initApp()
})

async function handleDataReady() {
  needsDataGate.value = false
  await initApp()
}

const showOnboarding = computed(() => appReady.value && !settings.onboardingComplete)
</script>

<template>
  <DataGate v-if="needsDataGate" @ready="handleDataReady" />
  <div v-else class="min-h-screen flex flex-col" :data-theme="settings.theme">
    <NauticalBackground />
    <NavBar class="sticky top-0 z-10" />
    <div class="flex-1 overflow-y-auto">
      <main class="max-w-6xl mx-auto px-4 lg:px-8 py-8 w-full">
        <div style="position: relative; z-index: 1;">
          <RouterView />
        </div>
      </main>
    </div>
    <footer class="text-center text-xs text-base-content/40 py-3">
      Helm <span v-if="appVersion">v{{ appVersion }}</span>
    </footer>
    <OnboardingWizard v-if="showOnboarding" @done="settings.onboardingComplete = true" />
    <ToastNotification />
  </div>
</template>