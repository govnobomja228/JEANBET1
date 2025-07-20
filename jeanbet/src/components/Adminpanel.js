import { useState, useEffect } from 'react';
import axios from 'axios';

export default function AdminPanel() {
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState('racers');
  const [racers, setRacers] = useState([]);
  const [newRacer, setNewRacer] = useState({ name: '', odds: 2.00, is_active: true });
  const [winner, setWinner] = useState('');
  const [message, setMessage] = useState('');
  const [siteSettings, setSiteSettings] = useState({
    siteName: 'JEAN Bet',
    minBet: 50,
    minDeposit: 100
  });

  useEffect(() => {
    if (isAuthenticated) {
      loadRacers();
      loadSettings();
    }
  }, [isAuthenticated]);

  const loadRacers = async () => {
    try {
      const response = await axios.get('/api/racers');
      setRacers(response.data.racers);
    } catch (error) {
      setMessage('Error loading racers: ' + error.message);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await axios.get('/api/settings');
      if (response.data.settings) {
        setSiteSettings(response.data.settings);
      }
    } catch (error) {
      setMessage('Error loading settings: ' + error.message);
    }
  };

  const handleLogin = async () => {
    try {
      const response = await axios.post('/api/admin/login', { password });
      if (response.data.success) {
        setIsAuthenticated(true);
        setMessage('');
      } else {
        setMessage('Invalid password');
      }
    } catch (error) {
      setMessage('Error: ' + error.message);
    }
  };

  const handleAddRacer = async () => {
    if (!newRacer.name) {
      setMessage('Name is required');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('name', newRacer.name);
      formData.append('odds', newRacer.odds);
      formData.append('is_active', newRacer.is_active);
      
      if (newRacer.image) {
        formData.append('image', newRacer.image);
      }

      const response = await axios.post('/api/admin/racers', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setRacers([...racers, response.data.racer]);
      setNewRacer({ name: '', odds: 2.00, is_active: true, image: null });
      setMessage('Racer added successfully');
    } catch (error) {
      setMessage('Error adding racer: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleUpdateRacer = async (id, updates) => {
    try {
      const formData = new FormData();
      if (updates.name) formData.append('name', updates.name);
      if (updates.odds) formData.append('odds', updates.odds);
      if (updates.is_active !== undefined) formData.append('is_active', updates.is_active);
      if (updates.image) formData.append('image', updates.image);

      const response = await axios.put(`/api/admin/racers/${id}`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      setRacers(racers.map(r => r.id === id ? response.data.racer : r));
      setMessage('Racer updated successfully');
    } catch (error) {
      setMessage('Error updating racer: ' + (error.response?.data?.error || error.message));
    }
  };

  const declareWinner = async () => {
    if (!winner) {
      setMessage('Please select winner');
      return;
    }

    try {
      const response = await axios.post('/api/admin/declare-winner', { winner });
      setMessage(response.data.message || 'Winner declared successfully!');
      setWinner('');
      loadRacers();
    } catch (error) {
      setMessage('Error declaring winner: ' + (error.response?.data?.error || error.message));
    }
  };

  const updateSetting = async (key, value) => {
    try {
      await axios.post('/api/admin/settings', { key, value });
      setSiteSettings({ ...siteSettings, [key]: value });
      setMessage('Setting updated successfully');
    } catch (error) {
      setMessage('Error updating setting: ' + (error.response?.data?.error || error.message));
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="bg-gray-800 p-6 rounded-lg max-w-md mx-auto mt-10">
        <h2 className="text-xl font-bold mb-4">Admin Login</h2>
        <div className="mb-4">
          <label className="block mb-2">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-2 bg-gray-700 rounded"
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
        </div>
        <button
          onClick={handleLogin}
          className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded w-full"
        >
          Login
        </button>
        {message && (
          <div className="mt-4 p-2 bg-red-800 rounded text-center">
            {message}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-800 p-4 rounded-lg max-w-full mx-2">
      <div className="flex space-x-2 mb-4 overflow-x-auto pb-2">
        <button 
          onClick={() => setActiveTab('racers')}
          className={`px-4 py-2 rounded-lg text-sm ${activeTab === 'racers' ? 'bg-blue-600' : 'bg-gray-700'}`}
        >
          Racers
        </button>
        <button 
          onClick={() => setActiveTab('winner')}
          className={`px-4 py-2 rounded-lg text-sm ${activeTab === 'winner' ? 'bg-blue-600' : 'bg-gray-700'}`}
        >
          Declare Winner
        </button>
        <button 
          onClick={() => setActiveTab('settings')}
          className={`px-4 py-2 rounded-lg text-sm ${activeTab === 'settings' ? 'bg-blue-600' : 'bg-gray-700'}`}
        >
          Settings
        </button>
      </div>

      {activeTab === 'racers' && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Manage Racers</h3>
          
          <div className="mb-4 bg-gray-700 p-3 rounded-lg">
            <h4 className="font-medium mb-2">Add New Racer</h4>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs mb-1">Name</label>
                <input
                  type="text"
                  value={newRacer.name}
                  onChange={(e) => setNewRacer({...newRacer, name: e.target.value})}
                  className="w-full p-2 bg-gray-600 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Odds</label>
                <input
                  type="number"
                  step="0.01"
                  min="1.00"
                  value={newRacer.odds}
                  onChange={(e) => setNewRacer({...newRacer, odds: parseFloat(e.target.value) || 2.00})}
                  className="w-full p-2 bg-gray-600 rounded text-sm"
                />
              </div>
              <div>
                <label className="block text-xs mb-1">Image</label>
                <input
                  type="file"
                  onChange={(e) => setNewRacer({...newRacer, image: e.target.files[0]})}
                  className="w-full p-1 bg-gray-600 rounded text-xs"
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={handleAddRacer}
                  className="bg-green-600 hover:bg-green-700 px-2 py-2 rounded w-full text-sm"
                >
                  Add Racer
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left p-2">ID</th>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Odds</th>
                  <th className="text-left p-2">Image</th>
                  <th className="text-left p-2">Active</th>
                  <th className="text-left p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {racers.map(racer => (
                  <tr key={racer.id} className="border-b border-gray-700">
                    <td className="p-2">{racer.id}</td>
                    <td className="p-2">
                      <input
                        type="text"
                        value={racer.name}
                        onChange={(e) => handleUpdateRacer(racer.id, { name: e.target.value })}
                        className="w-full p-1 bg-gray-600 rounded text-sm"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.01"
                        min="1.00"
                        value={racer.odds}
                        onChange={(e) => handleUpdateRacer(racer.id, { odds: parseFloat(e.target.value) || 2.00 })}
                        className="w-full p-1 bg-gray-600 rounded text-sm"
                      />
                    </td>
                    <td className="p-2">
                      {racer.image_url && (
                        <img src={racer.image_url} alt={racer.name} className="w-10 h-10 rounded-full object-cover" />
                      )}
                      <input
                        type="file"
                        onChange={(e) => handleUpdateRacer(racer.id, { image: e.target.files[0] })}
                        className="w-full p-1 bg-gray-600 rounded mt-1 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <select
                        value={racer.is_active}
                        onChange={(e) => handleUpdateRacer(racer.id, { is_active: e.target.value === 'true' })}
                        className="bg-gray-600 rounded p-1 text-sm"
                      >
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => handleUpdateRacer(racer.id, { is_active: !racer.is_active })}
                        className={`px-2 py-1 rounded text-xs ${racer.is_active ? 'bg-yellow-600' : 'bg-green-600'}`}
                      >
                        {racer.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'winner' && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Declare Winner</h3>
          <div className="mb-4">
            <label className="block mb-2 text-sm">Select Winner</label>
            <select
              value={winner}
              onChange={(e) => setWinner(e.target.value)}
              className="w-full p-2 bg-gray-700 rounded text-sm"
            >
              <option value="">-- Select Winner --</option>
              {racers.filter(r => r.is_active).map(racer => (
                <option key={racer.id} value={racer.id}>
                  {racer.name} (x{racer.odds})
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={declareWinner}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded w-full"
          >
            Declare Winner
          </button>
        </div>
      )}

      {activeTab === 'settings' && (
        <div>
          <h3 className="text-lg font-semibold mb-4">Site Settings</h3>
          
          <div className="grid grid-cols-1 gap-4">
            <div className="bg-gray-700 p-4 rounded-lg">
              <h4 className="font-medium mb-2">General Settings</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs mb-1">Site Name</label>
                  <input
                    type="text"
                    value={siteSettings.siteName}
                    onChange={(e) => updateSetting('siteName', e.target.value)}
                    className="w-full p-2 bg-gray-600 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Minimum Bet</label>
                  <input
                    type="number"
                    value={siteSettings.minBet}
                    onChange={(e) => updateSetting('minBet', parseInt(e.target.value) || 50)}
                    className="w-full p-2 bg-gray-600 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1">Minimum Deposit</label>
                  <input
                    type="number"
                    value={siteSettings.minDeposit}
                    onChange={(e) => updateSetting('minDeposit', parseInt(e.target.value) || 100)}
                    className="w-full p-2 bg-gray-600 rounded text-sm"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {message && (
        <div className={`mt-4 p-3 rounded-lg text-center ${
          message.includes('success') ? 'bg-green-800' : 'bg-red-800'
        }`}>
          {message}
        </div>
      )}
    </div>
  );
}