// Browser port of electron/store.cjs.
//
// The Electron app silently persisted data.json into the OS's app-config
// directory (app.getPath('userData')) on every write. This web build
// intentionally does NOT do that: there is no "save to disk automatically"
// step. Instead:
//   - The working copy lives in memory for the session, mirrored into
//     localStorage purely so an accidental tab refresh doesn't lose work.
//   - The user is in charge of the actual file via three explicit actions:
//     Create (start a blank data.json), Import (load an existing
//     data.json), and Export (download the current state as data.json).
//
// Every list/save/delete function below mirrors store.cjs's behavior and
// shape exactly, so the rest of the app (stores/*.js, which call
// window.api.*) needed zero changes.

const STORAGE_KEY = 'helm:data.json'

const DEFAULT_SETTINGS = {
  trailingAverageMonths: 6,
  theme: 'ledger',
  grossMonthlyIncome: null,
  grossIncomeSources: [],
  defaultMortgageRatePercent: null,
  defaultLoanTermYears: null,
  defaultPropertyTaxRatePercent: null,
  defaultAnnualInsurance: null,
  defaultMonthlyHOA: null,
  defaultOtherMonthlyDebt: null,
  defaultClosingCostsPercent: null,
  defaultPmiRatePercent: null,
}

const STARTER_CATEGORIES = [
  'Rent/Mortgage',
  'Utilities',
  'Groceries',
  'Transportation',
  'Insurance',
  'Subscriptions',
  'Entertainment',
  'Healthcare',
  'Personal',
]

function seedCategories() {
  return STARTER_CATEGORIES.map((name, i) => ({ id: i + 1, name, color: null }))
}

const DEFAULT_HOUSE_ACCOUNT_NAME = 'House Fund'
const DEFAULT_EMERGENCY_ACCOUNT_NAME = 'Emergency Fund'

function emptyData() {
  return {
    version: 2,
    snapshots: [],
    scenarios: [],
    creditCards: [],
    cardBalances: [],
    settings: { ...DEFAULT_SETTINGS },
    categories: seedCategories(),
    fundAccounts: null,
    accounts: [],
    accountBalances: [],
    forecastItems: [],
    incomeOptions: [],
  }
}

let cache = null

function nextId(records) {
  return records.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1
}

// ---------------------------------------------------------------------
// Migrations — identical logic to store.cjs, kept idempotent so importing
// an old-shaped backup (pre fund-accounts, pre unified-accounts) upgrades
// it on the fly.
// ---------------------------------------------------------------------

function migrateAssetFlagsToAccounts(data) {
  if (data.fundAccounts !== null || data.accounts !== null) return data
  data.fundAccounts = []

  let houseAccountId = null
  let emergencyAccountId = null

  function ensureHouseAccount() {
    if (houseAccountId) return houseAccountId
    houseAccountId = nextId(data.fundAccounts)
    data.fundAccounts.push({ id: houseAccountId, name: DEFAULT_HOUSE_ACCOUNT_NAME, type: 'house', annualReturnPercent: 0 })
    return houseAccountId
  }
  function ensureEmergencyAccount() {
    if (emergencyAccountId) return emergencyAccountId
    emergencyAccountId = nextId(data.fundAccounts)
    data.fundAccounts.push({ id: emergencyAccountId, name: DEFAULT_EMERGENCY_ACCOUNT_NAME, type: 'emergency', annualReturnPercent: 0 })
    return emergencyAccountId
  }

  for (const snapshot of data.snapshots) {
    for (const item of snapshot.assetItems || []) {
      if (item.forHouseFund) {
        item.accountId = ensureHouseAccount()
      } else if (item.forEmergencyFund) {
        item.accountId = ensureEmergencyAccount()
      } else if (item.accountId === undefined) {
        item.accountId = null
      }
      delete item.forHouseFund
      delete item.forEmergencyFund
    }
  }

  return data
}

function migrateToUnifiedAccounts(data) {
  if (data.accounts !== null) return data
  data.accounts = []
  data.accountBalances = []

  const fundAccountIdMap = new Map()
  for (const fa of data.fundAccounts || []) {
    const newId = nextId(data.accounts)
    fundAccountIdMap.set(fa.id, newId)
    data.accounts.push({
      id: newId,
      name: fa.name,
      kind: 'asset',
      goalType: fa.type,
      annualReturnPercent: fa.annualReturnPercent || 0,
      monthlyTargetContribution: fa.monthlyTargetContribution ?? null,
      isRetirement: false,
      interestRatePercent: 0,
      minimumPayment: null,
      extraMonthlyPayment: null,
      isTransactionAccount: false,
    })
  }

  const assetLabelMap = new Map()
  const debtLabelMap = new Map()

  function ensureLabelAccount(map, label, kind) {
    const key = label.trim().toLowerCase()
    if (map.has(key)) return map.get(key)
    const newId = nextId(data.accounts)
    data.accounts.push({
      id: newId,
      name: label.trim() || (kind === 'asset' ? 'Untitled asset' : 'Untitled debt'),
      kind,
      goalType: null,
      annualReturnPercent: 0,
      monthlyTargetContribution: null,
      isRetirement: false,
      interestRatePercent: 0,
      minimumPayment: null,
      extraMonthlyPayment: null,
      isTransactionAccount: false,
    })
    map.set(key, newId)
    return newId
  }

  function addBalance(accountId, month, amount) {
    const existing = data.accountBalances.find((b) => b.accountId === accountId && b.month === month)
    if (existing) {
      existing.amount += amount
    } else {
      data.accountBalances.push({ id: nextId(data.accountBalances), accountId, month, amount, updatedAt: new Date().toISOString() })
    }
  }

  for (const snapshot of data.snapshots) {
    for (const item of snapshot.assetItems || []) {
      const amount = Number(item.amount) || 0
      const label = (item.label || '').trim()
      if (!label && !amount) continue
      let accountId
      if (item.accountId != null && fundAccountIdMap.has(item.accountId)) {
        accountId = fundAccountIdMap.get(item.accountId)
      } else {
        accountId = ensureLabelAccount(assetLabelMap, item.label || '', 'asset')
      }
      addBalance(accountId, snapshot.month, amount)
    }
    for (const item of snapshot.debtItems || []) {
      const amount = Number(item.amount) || 0
      const label = (item.label || '').trim()
      if (!label && !amount) continue
      const accountId = ensureLabelAccount(debtLabelMap, item.label || '', 'debt')
      addBalance(accountId, snapshot.month, amount)
    }
    delete snapshot.assetItems
    delete snapshot.debtItems
  }

  delete data.fundAccounts
  return data
}

function normalize(parsed) {
  const data = {
    version: parsed.version ?? 2,
    snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    scenarios: Array.isArray(parsed.scenarios) ? parsed.scenarios : [],
    creditCards: Array.isArray(parsed.creditCards) ? parsed.creditCards : [],
    cardBalances: Array.isArray(parsed.cardBalances) ? parsed.cardBalances : [],
    settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
    categories: Array.isArray(parsed.categories) ? parsed.categories : seedCategories(),
    fundAccounts: Array.isArray(parsed.fundAccounts) ? parsed.fundAccounts : null,
    accounts: Array.isArray(parsed.accounts) ? parsed.accounts : null,
    accountBalances: Array.isArray(parsed.accountBalances) ? parsed.accountBalances : [],
    forecastItems: Array.isArray(parsed.forecastItems) ? parsed.forecastItems : [],
    incomeOptions: Array.isArray(parsed.incomeOptions) ? parsed.incomeOptions : [],
  }
  migrateAssetFlagsToAccounts(data)
  migrateToUnifiedAccounts(data)
  return data
}

// True once a data.json has actually been established this session
// (created fresh, or imported) — i.e. whether the app should show the
// normal UI or the Create/Import gate.
function hasData() {
  return localStorage.getItem(STORAGE_KEY) !== null
}

function load() {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw == null) throw new Error('no data yet')
    cache = normalize(JSON.parse(raw))
  } catch {
    // No data created/imported yet this session — fall back to an
    // in-memory empty shape so reads don't throw. Nothing is written
    // until createNew()/importPayload()/persist() runs.
    cache = emptyData()
  }
  return cache
}

function persist() {
  const data = load()
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

// Starts a brand-new, blank data.json (mirrors first-run behavior of the
// Electron app, but triggered explicitly by the user instead of silently
// on first launch).
function createNew() {
  cache = emptyData()
  persist()
  return cache
}

// Wipes the working copy and the local mirror entirely, so the next load
// shows the Create/Import gate again.
function clearAll() {
  cache = null
  localStorage.removeItem(STORAGE_KEY)
}

function getStorageDescription() {
  return 'This browser only — no file is written automatically. Use Export to save a data.json file, and Import to load one back in.'
}

// ---------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------

function listSnapshots() {
  return [...load().snapshots].sort((a, b) => a.month.localeCompare(b.month))
}

function saveSnapshot(plain) {
  const data = load()
  const existing = plain.id ? data.snapshots.find((s) => s.id === plain.id) : data.snapshots.find((s) => s.month === plain.month)
  const record = {
    ...plain,
    id: existing ? existing.id : nextId(data.snapshots),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const idx = data.snapshots.findIndex((s) => s.id === record.id)
  if (idx >= 0) data.snapshots[idx] = record
  else data.snapshots.push(record)
  persist()
  return record
}

function deleteSnapshot(id) {
  const data = load()
  data.snapshots = data.snapshots.filter((s) => s.id !== id)
  persist()
}

// ---------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------

function listScenarios() {
  return [...load().scenarios]
}

function saveScenario(plain) {
  const data = load()
  const existing = plain.id ? data.scenarios.find((s) => s.id === plain.id) : null
  const record = { ...plain, id: existing ? existing.id : nextId(data.scenarios) }
  const idx = data.scenarios.findIndex((s) => s.id === record.id)
  if (idx >= 0) data.scenarios[idx] = record
  else data.scenarios.push(record)
  persist()
  return record
}

function deleteScenario(id) {
  const data = load()
  data.scenarios = data.scenarios.filter((s) => s.id !== id)
  persist()
}

// ---------------------------------------------------------------------
// Credit cards
// ---------------------------------------------------------------------

function listCards() {
  return [...load().creditCards]
}

function saveCard(plain) {
  const data = load()
  const existing = plain.id ? data.creditCards.find((c) => c.id === plain.id) : null
  const record = { ...plain, id: existing ? existing.id : nextId(data.creditCards) }
  const idx = data.creditCards.findIndex((c) => c.id === record.id)
  if (idx >= 0) data.creditCards[idx] = record
  else data.creditCards.push(record)
  persist()
  return record
}

function deleteCard(id) {
  const data = load()
  data.creditCards = data.creditCards.filter((c) => c.id !== id)
  data.cardBalances = data.cardBalances.filter((b) => b.cardId !== id)
  persist()
}

// ---------------------------------------------------------------------
// Card balances
// ---------------------------------------------------------------------

function listBalances() {
  return [...load().cardBalances]
}

function saveBalance({ cardId, month, amount, categories, settlementDate }) {
  const data = load()
  const existing = data.cardBalances.find((b) => b.cardId === cardId && b.month === month)
  const record = {
    id: existing ? existing.id : nextId(data.cardBalances),
    cardId,
    month,
    amount: Number(amount) || 0,
    settlementDate: settlementDate ?? existing?.settlementDate ?? null,
    updatedAt: new Date().toISOString(),
  }
  if (Array.isArray(categories) && categories.length) {
    record.categories = categories.map((c) => ({ category: String(c.category || '').trim() || 'Uncategorized', amount: Number(c.amount) || 0 }))
  }
  const idx = data.cardBalances.findIndex((b) => b.id === record.id)
  if (idx >= 0) data.cardBalances[idx] = record
  else data.cardBalances.push(record)
  persist()
  return record
}

function deleteBalance(id) {
  const data = load()
  data.cardBalances = data.cardBalances.filter((b) => b.id !== id)
  persist()
}

// ---------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------

function getSettings() {
  return { ...load().settings }
}

function saveSettings(partial) {
  const data = load()
  data.settings = { ...data.settings, ...partial }
  persist()
  return { ...data.settings }
}

// ---------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------

function listCategories() {
  return [...load().categories].map((c) => ({ ...c, color: c.color ?? null })).sort((a, b) => a.name.localeCompare(b.name))
}

function renameCategoryEverywhere(data, oldName, newName) {
  for (const snapshot of data.snapshots) {
    for (const item of snapshot.expenseItems || []) {
      if (item.category === oldName) item.category = newName
    }
  }
  for (const balance of data.cardBalances) {
    for (const c of balance.categories || []) {
      if (c.category === oldName) c.category = newName
    }
  }
}

function saveCategory({ id, name, color }) {
  const data = load()
  const trimmedName = String(name || '').trim()
  if (!trimmedName) throw new Error('Category name cannot be empty.')
  const existing = id ? data.categories.find((c) => c.id === id) : null
  const oldName = existing?.name
  const duplicate = data.categories.find((c) => c.name.toLowerCase() === trimmedName.toLowerCase() && c.id !== id)
  if (duplicate) throw new Error(`"${trimmedName}" already exists.`)
  const resolvedColor = color !== undefined ? color || null : existing?.color ?? null
  const record = { id: existing ? existing.id : nextId(data.categories), name: trimmedName, color: resolvedColor }
  const idx = data.categories.findIndex((c) => c.id === record.id)
  if (idx >= 0) data.categories[idx] = record
  else data.categories.push(record)
  if (oldName && oldName !== trimmedName) renameCategoryEverywhere(data, oldName, trimmedName)
  persist()
  return record
}

function deleteCategory(id) {
  const data = load()
  data.categories = data.categories.filter((c) => c.id !== id)
  persist()
}

// ---------------------------------------------------------------------
// Accounts (Assets & Debts)
// ---------------------------------------------------------------------

function listAccounts() {
  return [...load().accounts]
    .map((a) => ({
      ...a,
      isRetirement: !!a.isRetirement,
      interestRatePercent: a.interestRatePercent ?? 0,
      minimumPayment: a.minimumPayment ?? null,
      extraMonthlyPayment: a.extraMonthlyPayment ?? null,
      isTransactionAccount: !!a.isTransactionAccount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function saveAccount({
  id, name, kind, goalType, annualReturnPercent, monthlyTargetContribution,
  isRetirement, interestRatePercent, minimumPayment, extraMonthlyPayment,
  paymentDayOfMonth, isTransactionAccount,
}) {
  const data = load()
  const trimmedName = String(name || '').trim()
  if (!trimmedName) throw new Error('Account name cannot be empty.')
  if (kind !== 'asset' && kind !== 'debt') throw new Error('Account kind must be "asset" or "debt".')
  if (goalType != null && goalType !== 'house' && goalType !== 'emergency') {
    throw new Error('Goal type must be "house", "emergency", or unset.')
  }

  function optionalDollarField(value) {
    return value !== null && value !== undefined && value !== '' ? Number(value) || 0 : null
  }

  const existing = id ? data.accounts.find((a) => a.id === id) : null
  const record = {
    id: existing ? existing.id : nextId(data.accounts),
    name: trimmedName,
    kind,
    goalType: kind === 'asset' ? goalType ?? null : null,
    annualReturnPercent: kind === 'asset' ? Number(annualReturnPercent) || 0 : 0,
    monthlyTargetContribution: kind === 'asset' ? optionalDollarField(monthlyTargetContribution) : null,
    isRetirement: kind === 'asset' ? !!isRetirement : false,
    interestRatePercent: kind === 'debt' ? Number(interestRatePercent) || 0 : 0,
    minimumPayment: kind === 'debt' ? optionalDollarField(minimumPayment) : null,
    extraMonthlyPayment: kind === 'debt' ? optionalDollarField(extraMonthlyPayment) : null,
    paymentDayOfMonth: kind === 'debt' ? (Number(paymentDayOfMonth) || null) : null,
    isTransactionAccount: kind === 'asset' ? !!isTransactionAccount : false,
  }

  const idx = data.accounts.findIndex((a) => a.id === record.id)
  if (idx >= 0) data.accounts[idx] = record
  else data.accounts.push(record)

  if (record.isTransactionAccount) {
    for (const a of data.accounts) {
      if (a.id !== record.id) a.isTransactionAccount = false
    }
  }

  persist()
  return record
}

function deleteAccount(id) {
  const data = load()
  data.accounts = data.accounts.filter((a) => a.id !== id)
  data.accountBalances = data.accountBalances.filter((b) => b.accountId !== id)
  persist()
}

function listAccountBalances() {
  return [...load().accountBalances]
}

function saveAccountBalance({ accountId, month, amount }) {
  const data = load()
  const existing = data.accountBalances.find((b) => b.accountId === accountId && b.month === month)
  const record = {
    id: existing ? existing.id : nextId(data.accountBalances),
    accountId,
    month,
    amount: Number(amount) || 0,
    updatedAt: new Date().toISOString(),
  }
  const idx = data.accountBalances.findIndex((b) => b.id === record.id)
  if (idx >= 0) data.accountBalances[idx] = record
  else data.accountBalances.push(record)
  persist()
  return record
}

function deleteAccountBalance(id) {
  const data = load()
  data.accountBalances = data.accountBalances.filter((b) => b.id !== id)
  persist()
}

// ---------------------------------------------------------------------
// Forecast items
// ---------------------------------------------------------------------

function listForecastItems() {
  return [...load().forecastItems].sort((a, b) => a.month.localeCompare(b.month))
}

function saveForecastItem({ id, type, month, label, amount, category }) {
  const data = load()
  if (type !== 'income' && type !== 'expense') throw new Error('Forecast item type must be "income" or "expense".')
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('Forecast item needs a valid month.')
  const existing = id ? data.forecastItems.find((f) => f.id === id) : null
  const record = {
    id: existing ? existing.id : nextId(data.forecastItems),
    type,
    month,
    label: String(label || '').trim(),
    amount: Number(amount) || 0,
    category: type === 'expense' ? String(category || '').trim() || null : null,
  }
  const idx = data.forecastItems.findIndex((f) => f.id === record.id)
  if (idx >= 0) data.forecastItems[idx] = record
  else data.forecastItems.push(record)
  persist()
  return record
}

function deleteForecastItem(id) {
  const data = load()
  data.forecastItems = data.forecastItems.filter((f) => f.id !== id)
  persist()
}

// ---------------------------------------------------------------------
// Income options
// ---------------------------------------------------------------------

function listIncomeOptions() {
  return [...load().incomeOptions].sort((a, b) => a.name.localeCompare(b.name))
}

function renameIncomeOptionEverywhere(data, oldName, newName) {
  for (const snapshot of data.snapshots) {
    for (const item of snapshot.incomeItems || []) {
      if (item.label === oldName) item.label = newName
    }
  }
}

function saveIncomeOption({ id, name, schedule }) {
  const data = load()
  const trimmedName = String(name || '').trim()
  if (!trimmedName) throw new Error('Income option name cannot be empty.')
  const existing = id ? data.incomeOptions.find((o) => o.id === id) : null
  const oldName = existing?.name
  const duplicate = data.incomeOptions.find((o) => o.name.toLowerCase() === trimmedName.toLowerCase() && o.id !== id)
  if (duplicate) throw new Error(`"${trimmedName}" already exists.`)
  const record = {
    id: existing ? existing.id : nextId(data.incomeOptions),
    name: trimmedName,
    schedule: schedule !== undefined ? schedule : (existing?.schedule ?? null),
  }
  const idx = data.incomeOptions.findIndex((o) => o.id === record.id)
  if (idx >= 0) data.incomeOptions[idx] = record
  else data.incomeOptions.push(record)
  if (oldName && oldName !== trimmedName) renameIncomeOptionEverywhere(data, oldName, trimmedName)
  persist()
  return record
}

function deleteIncomeOption(id) {
  const data = load()
  data.incomeOptions = data.incomeOptions.filter((o) => o.id !== id)
  persist()
}

// ---------------------------------------------------------------------
// Backup / restore payload (also doubles as the data.json file format)
// ---------------------------------------------------------------------

function getBackupPayload() {
  const data = load()
  return {
    exportedAt: new Date().toISOString(),
    version: 2,
    snapshots: data.snapshots,
    scenarios: data.scenarios,
    creditCards: data.creditCards,
    cardBalances: data.cardBalances,
    settings: data.settings,
    categories: data.categories,
    accounts: data.accounts,
    accountBalances: data.accountBalances,
    forecastItems: data.forecastItems,
    incomeOptions: data.incomeOptions,
  }
}

function restoreFromPayload(payload) {
  if (!payload || !Array.isArray(payload.snapshots) || !Array.isArray(payload.scenarios)) {
    throw new Error('Invalid backup file format.')
  }
  const warnings = []
  const creditCardsIn = Array.isArray(payload.creditCards) ? payload.creditCards : []
  const cardBalancesIn = Array.isArray(payload.cardBalances) ? payload.cardBalances : []
  if (!Array.isArray(payload.creditCards)) {
    warnings.push('No credit card data found in the file — starting with none.')
  }

  const cardIdMap = new Map()
  const creditCards = creditCardsIn.map((c, i) => {
    const newId = i + 1
    cardIdMap.set(c.id, newId)
    const { id, ...rest } = c
    return { ...rest, id: newId }
  })
  const cardBalances = cardBalancesIn.map((b, i) => {
    const { id, ...rest } = b
    return { ...rest, id: i + 1, cardId: cardIdMap.get(b.cardId) ?? b.cardId }
  })

  const scenarios = payload.scenarios.map((s, i) => {
    const { id, ...rest } = s
    return { ...rest, id: i + 1 }
  })

  const current = load()
  if (!payload.settings) {
    warnings.push('No settings found in the file — using the app\'s current defaults.')
  }
  const settings = { ...DEFAULT_SETTINGS, ...(current.settings || {}), ...(payload.settings || {}) }
  const categories = Array.isArray(payload.categories) && payload.categories.length
    ? payload.categories.map((c, i) => ({ id: i + 1, name: c.name }))
    : current.categories
  if (!Array.isArray(payload.categories) || !payload.categories.length) {
    warnings.push('No categories found in the file — kept the starter categories.')
  }

  let snapshots, accounts, accountBalances, fundAccounts

  if (Array.isArray(payload.accounts)) {
    const accountIdMap = new Map()
    accounts = payload.accounts.map((a, i) => {
      const newId = i + 1
      accountIdMap.set(a.id, newId)
      const { id, ...rest } = a
      return { ...rest, id: newId }
    })
    const accountBalancesIn = Array.isArray(payload.accountBalances) ? payload.accountBalances : []
    accountBalances = accountBalancesIn.map((b, i) => {
      const { id, ...rest } = b
      return { ...rest, id: i + 1, accountId: accountIdMap.get(b.accountId) ?? b.accountId }
    })
    snapshots = payload.snapshots.map((s, i) => {
      const { id, ...rest } = s
      delete rest.assetItems
      delete rest.debtItems
      return { ...rest, id: i + 1 }
    })
    fundAccounts = null
  } else {
    warnings.push('This backup uses an older data format — accounts will be reconstructed automatically from monthly history.')
    const fundAccountsIn = Array.isArray(payload.fundAccounts) ? payload.fundAccounts : null
    const fundAccountIdMap = new Map()
    fundAccounts = fundAccountsIn
      ? fundAccountsIn.map((a, i) => {
          const newId = i + 1
          fundAccountIdMap.set(a.id, newId)
          const { id, ...rest } = a
          return { ...rest, id: newId }
        })
      : null
    snapshots = payload.snapshots.map((s, i) => {
      const { id, ...rest } = s
      const assetItems = (rest.assetItems || []).map((item) => {
        if (item.accountId == null) return item
        return { ...item, accountId: fundAccountIdMap?.get(item.accountId) ?? null }
      })
      return { ...rest, assetItems, id: i + 1 }
    })
    accounts = null
    accountBalances = []
  }

  const forecastItems = Array.isArray(payload.forecastItems)
    ? payload.forecastItems.map((f, i) => { const { id, ...rest } = f; return { ...rest, id: i + 1 } })
    : []
  if (!Array.isArray(payload.forecastItems)) {
    warnings.push('No forecast items found in the file — starting with none.')
  }
  const incomeOptions = Array.isArray(payload.incomeOptions)
    ? payload.incomeOptions.map((o, i) => { const { id, ...rest } = o; return { ...rest, id: i + 1 } })
    : []
  if (!Array.isArray(payload.incomeOptions)) {
    warnings.push('No income source presets found in the file — starting with none.')
  }

  cache = { version: 2, snapshots, scenarios, creditCards, cardBalances, settings, categories, fundAccounts, accounts, accountBalances, forecastItems, incomeOptions }
  migrateAssetFlagsToAccounts(cache)
  migrateToUnifiedAccounts(cache)
  persist()
  return { warnings }
}

export default {
  STORAGE_KEY,
  hasData,
  createNew,
  clearAll,
  getStorageDescription,
  listSnapshots, saveSnapshot, deleteSnapshot,
  listScenarios, saveScenario, deleteScenario,
  listCards, saveCard, deleteCard,
  listBalances, saveBalance, deleteBalance,
  getSettings, saveSettings,
  listCategories, saveCategory, deleteCategory,
  listAccounts, saveAccount, deleteAccount,
  listAccountBalances, saveAccountBalance, deleteAccountBalance,
  listForecastItems, saveForecastItem, deleteForecastItem,
  listIncomeOptions, saveIncomeOption, deleteIncomeOption,
  getBackupPayload, restoreFromPayload,
}