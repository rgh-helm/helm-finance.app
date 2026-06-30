// Browser replacement for electron/preload.cjs. The rest of the app talks
// to `window.api` exactly as it did under Electron — only what's behind
// that interface changes: IPC + fs calls become calls into dataEngine.js
// (in-memory/localStorage) plus real browser file pickers and downloads
// for CSV import and data.json export/import.

import dataEngine from './dataEngine.js'
import { parseCardCsv } from './csvImport.js'

const APP_VERSION = '0.52.1'

// Opens a native file picker for the given accept type and resolves with
// the selected File, or null if the user cancels. There's no reliable
// cancel event on <input type="file">, so a window focus listener is used
// as a heuristic: if the window regains focus and no change fired shortly
// after, treat it as canceled.
function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'

    let settled = false
    function cleanup() {
      window.removeEventListener('focus', onFocus)
      input.remove()
    }
    function settle(file) {
      if (settled) return
      settled = true
      cleanup()
      resolve(file)
    }

    input.addEventListener('change', () => {
      settle(input.files && input.files[0] ? input.files[0] : null)
    })

    function onFocus() {
      // Give the change event a moment to fire first if a file was picked.
      setTimeout(() => settle(null), 300)
    }
    window.addEventListener('focus', onFocus)

    document.body.appendChild(input)
    input.click()
  })
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'))
    reader.readAsText(file)
  })
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

const api = {
  snapshots: {
    list: async () => dataEngine.listSnapshots(),
    save: async (snapshot) => dataEngine.saveSnapshot(snapshot),
    delete: async (id) => dataEngine.deleteSnapshot(id),
  },
  scenarios: {
    list: async () => dataEngine.listScenarios(),
    save: async (scenario) => dataEngine.saveScenario(scenario),
    delete: async (id) => dataEngine.deleteScenario(id),
  },
  cards: {
    list: async () => dataEngine.listCards(),
    save: async (card) => dataEngine.saveCard(card),
    delete: async (id) => dataEngine.deleteCard(id),
  },
  balances: {
    list: async () => dataEngine.listBalances(),
    save: async (balance) => dataEngine.saveBalance(balance),
    delete: async (id) => dataEngine.deleteBalance(id),
  },
  settings: {
    get: async () => dataEngine.getSettings(),
    save: async (settings) => dataEngine.saveSettings(settings),
  },
  categories: {
    list: async () => dataEngine.listCategories(),
    save: async (category) => dataEngine.saveCategory(category),
    delete: async (id) => dataEngine.deleteCategory(id),
  },
  accounts: {
    list: async () => dataEngine.listAccounts(),
    save: async (account) => dataEngine.saveAccount(account),
    delete: async (id) => dataEngine.deleteAccount(id),
  },
  accountBalances: {
    list: async () => dataEngine.listAccountBalances(),
    save: async (balance) => dataEngine.saveAccountBalance(balance),
    delete: async (id) => dataEngine.deleteAccountBalance(id),
  },
  forecastItems: {
    list: async () => dataEngine.listForecastItems(),
    save: async (item) => dataEngine.saveForecastItem(item),
    delete: async (id) => dataEngine.deleteForecastItem(id),
  },
  incomeOptions: {
    list: async () => dataEngine.listIncomeOptions(),
    save: async (option) => dataEngine.saveIncomeOption(option),
    delete: async (id) => dataEngine.deleteIncomeOption(id),
  },

  csv: {
    async import() {
      const file = await pickFile('.csv,text/csv')
      if (!file) return { canceled: true }
      try {
        const text = await readFileAsText(file)
        const result = parseCardCsv(text)
        return { ok: true, ...result }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    },
  },

  backup: {
    async export() {
      try {
        const payload = dataEngine.getBackupPayload()
        const filename = `helm-backup-${new Date().toISOString().slice(0, 10)}.json`
        downloadJson(payload, filename)
        return { ok: true, path: filename }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    },
    async import() {
      const file = await pickFile('.json,application/json')
      if (!file) return { canceled: true }
      try {
        const raw = await readFileAsText(file)
        const payload = JSON.parse(raw)
        dataEngine.restoreFromPayload(payload)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    },
  },

  getStoragePath: async () => dataEngine.getStorageDescription(),
  getAppVersion: async () => APP_VERSION,
}

export function installApi() {
  window.api = api
}

export default api
