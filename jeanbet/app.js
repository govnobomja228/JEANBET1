import { Web3ReactProvider } from '@web3-react/core';
import { getLibrary } from './utils/web3';
import WalletConnect from './components/WalletConnect';
import USDTDeposit from './components/USDTDeposit';
import RaceBetting from './components/RaceBetting';
import AdminPanel from './components/AdminPanel';
import { useState, useEffect } from 'react';

function App() {
  const [activeTab, setActiveTab] = useState('bet');
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  useEffect(() => {
    const checkAdmin = async () => {
      try {
        if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.initDataUnsafe) {
          const user = window.Telegram.WebApp.initDataUnsafe.user;
          if (user && user.username === 'bus1o') {
            setIsAdmin(true);
          }
        }
      } catch (error) {
        console.error('Admin check error:', error);
      }
    };
    checkAdmin();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.value.toLowerCase() === 'admin') {
      setShowAdminLogin(true);
      setAdminPassword('');
    }
  };

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
          {showAdminLogin ? (
            <AdminPanel />
          ) : (
            <>
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
                {isAdmin && (
                  <input
                    type="text"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Enter admin password"
                    className="px-4 py-2 bg-gray-700 rounded-lg text-white"
                  />
                )}
              </div>

              {activeTab === 'bet' ? <RaceBetting /> : 
               activeTab === 'deposit' ? <USDTDeposit /> : null}
            </>
          )}
        </main>
      </div>
    </Web3ReactProvider>
  );
}

export default App;