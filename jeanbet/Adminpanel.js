import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function AdminPanel() {
  const [raceId, setRaceId] = useState('');
  const [winner, setWinner] = useState('');
  const [message, setMessage] = useState('');
  const [activeBets, setActiveBets] = useState([]);
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [balanceAdjustment, setBalanceAdjustment] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      await Promise.all([
        loadActiveBets(),
        loadUsers(),
        loadStats()
      ]);
    } catch (error) {
      setMessage('Error loading data: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadActiveBets = async () => {
    const response = await fetch('/api/admin/active-bets');
    const data = await response.json();
    setActiveBets(data.bets);
  };

  const loadUsers = async () => {
    const response = await fetch('/api/admin/users');
    const data = await response.json();
    setUsers(data.users);
  };

  const loadStats = async () => {
    const response = await fetch('/api/admin/stats');
    const data = await response.json();
    setStats(data.stats);
  };

  const declareWinner = async () => {
    if (!raceId || !winner) {
      setMessage('Please fill all fields');
      return;
    }

    try {
      const response = await fetch('/api/admin/settle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raceId, winner })
      });
      
      const data = await response.json();
      setMessage(data.success ? 'Winner declared successfully!' : 'Error declaring winner');
      loadData();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const adjustUserBalance = async () => {
    if (!selectedUser || !balanceAdjustment) {
      setMessage('Please select user and enter amount');
      return;
    }

    try {
      const response = await fetch('/api/admin/adjust-balance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          userId: selectedUser, 
          amount: parseFloat(balanceAdjustment)
        })
      });
      
      const data = await response.json();
      setMessage(`Balance adjusted: ${data.message}`);
      loadUsers();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const cancelBet = async (betId) => {
    try {
      const response = await fetch('/api/admin/cancel-bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ betId })
      });
      
      const data = await response.json();
      setMessage(data.message || 'Bet cancelled successfully!');
      loadActiveBets();
      loadUsers();
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg space-y-6">
      <h2 className="text-2xl font-bold mb-6 text-center">Admin Dashboard</h2>
      
      {isLoading && (
        <div className="text-center py-4">Loading data...</div>
      )}

      {/* Статистика */}
      {stats && (
        <div className="bg-gray-700 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-3">Statistics</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-gray-600 p-3 rounded">
              <p className="text-gray-300">Total Users</p>
              <p className="text-xl font-bold">{stats.totalUsers}</p>
            </div>
            <div className="bg-gray-600 p-3 rounded">
              <p className="text-gray-300">Active Bets</p>
              <p className="text-xl font-bold">{stats.activeBets}</p>
            </div>
            <div className="bg-gray-600 p-3 rounded">
              <p className="text-gray-300">Total Volume</p>
              <p className="text-xl font-bold">${stats.totalVolume.toFixed(2)}</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.betsByHour}>
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="bets" fill="#3b82f6" name="Bets per hour" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      
      {/* Управление ставками */}
      <div className="bg-gray-700 p-4 rounded-lg">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-semibold">Active Bets ({activeBets.length})</h3>
          <button 
            onClick={loadActiveBets}
            className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
          >
            Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full bg-gray-800 rounded-lg overflow-hidden">
            <thead className="bg-gray-900">
              <tr>
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Racer</th>
                <th className="px-4 py-2">Odds</th>
                <th className="px-4 py-2">Time</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeBets.map(bet => (
                <tr key={bet.id} className="border-t border-gray-600 hover:bg-gray-700">
                  <td className="px-4 py-2">{bet.id}</td>
                  <td className="px-4 py-2">{bet.username || `User ${bet.user_id}`}</td>
                  <td className="px-4 py-2">${bet.amount.toFixed(2)}</td>
                  <td className="px-4 py-2">{bet.racer_id === 1 ? 'Max Verstappen' : 'Lewis Hamilton'}</td>
                  <td className="px-4 py-2">x{bet.odds.toFixed(2)}</td>
                  <td className="px-4 py-2">{new Date(bet.created_at).toLocaleTimeString()}</td>
                  <td className="px-4 py-2">
                    <button 
                      onClick={() => cancelBet(bet.id)}
                      className="bg-red-600 hover:bg-red-700 px-2 py-1 rounded text-sm"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      {/* Управление пользователями */}
      <div className="bg-gray-700 p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-3">User Management</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block mb-2">Select User</label>
            <select
              value={selectedUser || ''}
              onChange={(e) => setSelectedUser(e.target.value)}
              className="w-full p-2 bg-gray-600 rounded"
            >
              <option value="">Select user</option>
              {users.map(user => (
                <option key={user.telegram_id} value={user.telegram_id}>
                  {user.username || `User ${user.telegram_id}`} (${user.balance.toFixed(2)})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block mb-2">Balance Adjustment</label>
            <div className="flex space-x-2">
              <input
                type="number"
                value={balanceAdjustment}
                onChange={(e) => setBalanceAdjustment(e.target.value)}
                className="flex-1 p-2 bg-gray-600 rounded"
                placeholder="Amount"
                step="0.01"
              />
              <button
                onClick={adjustUserBalance}
                className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Объявление победителя */}
      <div className="bg-gray-700 p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-3">Race Control</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block mb-2">Race ID</label>
            <input
              type="text"
              value={raceId}
              onChange={(e) => setRaceId(e.target.value)}
              className="w-full p-2 bg-gray-600 rounded"
              placeholder="Race identifier"
            />
          </div>
          <div>
            <label className="block mb-2">Winner</label>
            <select
              value={winner}
              onChange={(e) => setWinner(e.target.value)}
              className="w-full p-2 bg-gray-600 rounded"
            >
              <option value="">Select winner</option>
              <option value="1">Max Verstappen</option>
              <option value="2">Lewis Hamilton</option>
            </select>
          </div>
          <div className="flex items-end">
            <button
              onClick={declareWinner}
              className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded w-full"
            >
              Declare Winner
            </button>
          </div>
        </div>
      </div>
      
      {/* Сообщения */}
      {message && (
        <div className={`mt-4 p-3 rounded ${
          message.toLowerCase().includes('success') ? 'bg-green-800' : 'bg-red-800'
        }`}>
          {message}
        </div>
      )}
    </div>
  );
}