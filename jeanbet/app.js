import { Web3ReactProvider } from '@web3-react/core';
import { getLibrary } from './utils/web3';
import WalletConnect from './components/WalletConnect';
import USDTDeposit from './components/USDTDeposit';
import RaceBetting from './components/RaceBetting';
import BetHistory from './components/BetHistory';
import AdminPanel from './components/AdminPanel';
import { useState, useEffect } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('bet');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [refreshHistory, setRefreshHistory] = useState(false);
  const [balance, setBalance] = useState(0);

  useEffect(() => {
    const checkAdmin = () => {
      try {
        if (window.Telegram?.WebApp?.initDataUnsafe?.user?.username === 'bus1o') {
          setIsAdmin(true);
        }
      } catch (error) {
        console.error('Admin check error:', error);
      }
    };
    
    checkAdmin();
    window.Telegram.WebApp.expand();
    loadBalance();
  }, []);

  const loadBalance = async () => {
    try {
      const userId = window.Telegram.WebApp.initDataUnsafe?.user?.id;
      if (!userId) return;
      
      const response = await fetch(`/api/balance/${userId}`);
      const data = await response.json();
      setBalance(data.balance || 0);
    } catch (error) {
      console.error('Balance load error:', error);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.value.toLowerCase() === 'admin') {
      setShowAdminLogin(true);
      setAdminPassword('');
    }
  };

  const handleBetPlaced = () => {
    setRefreshHistory(prev => !prev);
    setActiveTab('history');
    loadBalance();
  };

  const handleDepositSuccess = () => {
    loadBalance();
  };

  return (
    <Web3ReactProvider getLibrary={getLibrary}>
      <div className="min-h-screen bg-gray-900 text-white">
        <header className="p-3 border-b border-gray-700 sticky top-0 bg-gray-900 z-10">
          <div className="max-w-md mx-auto flex justify-between items-center">
            <h1 className="text-xl font-bold text-blue-400">CryptoRace</h1>
            <WalletConnect />
          </div>
        </header>

        <main className="max-w-md mx-auto p-4 pb-20">
          {showAdminLogin ? (
            <AdminPanel />
          ) : (
            <>
              <div className="flex space-x-2 mb-4 overflow-x-auto pb-2">
                <button 
                  onClick={() => setActiveTab('bet')}
                  className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${
                    activeTab === 'bet' ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  🏎️ Place Bet
                </button>
                <button 
                  onClick={() => setActiveTab('history')}
                  className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${
                    activeTab === 'history' ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  📜 History
                </button>
                <button 
                  onClick={() => setActiveTab('deposit')}
                  className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap ${
                    activeTab === 'deposit' ? 'bg-blue-600' : 'bg-gray-700'
                  }`}
                >
                  💰 Deposit
                </button>
                {isAdmin && (
                  <input
                    type="text"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type 'admin'"
                    className="px-3 py-2 bg-gray-700 rounded-lg text-white text-sm w-24"
                  />
                )}
              </div>

              {activeTab === 'bet' ? <RaceBetting onBetPlaced={handleBetPlaced} /> : 
               activeTab === 'history' ? <BetHistory key={refreshHistory} /> : 
               activeTab === 'deposit' ? <USDTDeposit onSuccess={handleDepositSuccess} /> : null}
            </>
          )}
        </main>

        <div className="fixed bottom-0 left-0 right-0 bg-gray-800 p-3 border-t border-gray-700">
          <div className="max-w-md mx-auto flex justify-between items-center">
            <div>
              <div className="text-xs text-gray-400">Balance</div>
              <div className="font-bold">{balance.toFixed(2)}</div>
            </div>
            <button 
              onClick={() => setActiveTab('deposit')}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm"
            >
              Deposit
            </button>
          </div>
        </div>
      </div>
    </Web3ReactProvider>
  );
}

export default App;