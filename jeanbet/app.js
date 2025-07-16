import { Web3ReactProvider } from '@web3-react/core';
import { getLibrary } from './utils/web3';
import WalletConnect from './components/WalletConnect';
import USDTDeposit from './components/USDTDeposit';
import RaceBetting from './components/RaceBetting';

function App() {
  const [activeTab, setActiveTab] = useState('bet');

  return (
    <Web3ReactProvider getLibrary={getLibrary}>
      <div className="min-h-screen bg-gray-900 text-white">
        <header className="p-4 border-b border-gray-700">
          <div className="container mx-auto flex justify-between items-center">
            <h1 className="text-2xl font-bold text-blue-400">CryptoRace USDT</h1>
            <WalletConnect />
          </div>
        </header>

        <main className="container mx-auto p-4 mt-8">
          <div className="flex space-x-4 mb-6">
            <button 
              onClick={() => setActiveTab('bet')}
              className={`px-4 py-2 rounded-lg ${
                activeTab === 'bet' ? 'bg-blue-600' : 'bg-gray-700'
              }`}
            >
              Ставки
            </button>
            <button 
              onClick={() => setActiveTab('deposit')}
              className={`px-4 py-2 rounded-lg ${
                activeTab === 'deposit' ? 'bg-blue-600' : 'bg-gray-700'
              }`}
            >
              Пополнить USDT
            </button>
          </div>

          {activeTab === 'bet' ? <RaceBetting /> : <USDTDeposit />}
        </main>
      </div>
    </Web3ReactProvider>
  );
}