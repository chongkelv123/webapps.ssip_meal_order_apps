import { useNavigate } from 'react-router-dom';

export default function AboutPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-white flex flex-col">
      {/* Header */}
      <div className="flex items-center px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="p-2 -ml-2 text-gray-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-6 h-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-xl font-bold text-gray-900 ml-2">About</h1>
      </div>

      <div className="flex-1 px-4 pb-10 flex flex-col gap-6">
        {/* App Icon + Title */}
        <div className="flex flex-col items-center py-6">
          <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mb-4 shadow-md">
            <span className="text-white text-4xl font-bold">S</span>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">SSIP Meal Order</h2>
          <p className="text-sm text-gray-400 mt-1">Version 1.0.0</p>
        </div>

        {/* About SSIP */}
        {/*
        <div className="bg-gray-50 rounded-2xl p-4 flex flex-col gap-2">
          <h3 className="font-semibold text-gray-900">About SSIP</h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            SSIP stands for <strong>Shimano Singapore Intelligent Plant</strong> — a manufacturing
            facility in Singapore operated by Shimano, a global leader in cycling components and
            fishing tackle equipment.
          </p>
        </div>
        */}

        {/* About the App */}
        <div className="bg-gray-50 rounded-2xl p-4 flex flex-col gap-2">
          <h3 className="font-semibold text-gray-900">About This App</h3>
          <p className="text-sm text-gray-600 leading-relaxed">
            SSIP Meal Order is the web version of the SSIP cafeteria ordering app, built so that
            all SSIP employees — including iPhone users — can pre-order their daily cafeteria meals
            conveniently from any device.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            Browse menus, place orders, check your wallet balance, and manage your order history
            — all in one place.
          </p>
        </div>

        {/* Features */}
        <div className="bg-gray-50 rounded-2xl p-4 flex flex-col gap-3">
          <h3 className="font-semibold text-gray-900">Features</h3>
          <div className="flex flex-col gap-2.5">
            {[
              ['Browse daily cafeteria menus', '🍽️'],
              ['Pre-order meals with delivery time slots', '🕐'],
              ['Check WooWallet balance', '💳'],
              ['View and cancel pending orders', '📋'],
              ['Batch ordering support', '⚡'],
            ].map(([text, emoji]) => (
              <div key={text} className="flex items-center gap-3">
                <span className="text-lg w-6 text-center">{emoji}</span>
                <span className="text-sm text-gray-600">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col items-center gap-1 pt-2">
          <p className="text-xs text-gray-400">Built by Kelvin Chong</p>
          <p className="text-xs text-gray-400">© 2026 SSIP Meal Order. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
