import { useState } from 'react';

export default function AdminPanel() {
  const [raceId, setRaceId] = useState('');
  const [winner, setWinner] = useState('');
  const [message, setMessage] = useState('');

  const declareWinner = async () => {
    if (!raceId || !winner) {
      setMessage('Please fill all fields');
      return;
    }

    try {
      const response = await fetch('/api/admin/declare-winner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ raceId, winner }),
      });
      
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }

      const data = await response.json();
      setMessage(data.message || 'Winner declared successfully!');
    } catch (error) {
      setMessage('Error declaring winner: ' + error.message);
    }
  };

  return (
    <div className="bg-gray-800 p-6 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Admin Panel</h2>
      
      <div className="mb-4">
        <label className="block mb-2">Race ID</label>
        <input
          type="text"
          value={raceId}
          onChange={(e) => setRaceId(e.target.value)}
          className="w-full p-2 bg-gray-700 rounded"
          required
        />
      </div>
      
      <div className="mb-4">
        <label className="block mb-2">Winner</label>
        <select
          value={winner}
          onChange={(e) => setWinner(e.target.value)}
          className="w-full p-2 bg-gray-700 rounded"
          required
        >
          <option value="">Select winner</option>
          <option value="1">Max Verstappen</option>
          <option value="2">Lewis Hamilton</option>
        </select>
      </div>
      
      <button
        onClick={declareWinner}
        className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded"
      >
        Declare Winner
      </button>
      
      {message && <div className="mt-4 p-2 bg-gray-700 rounded">{message}</div>}
    </div>
  );
}