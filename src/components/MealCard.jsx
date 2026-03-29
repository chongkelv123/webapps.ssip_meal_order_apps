import { useState } from 'react';

const STALL_COLORS = {
  Chinese: 'bg-red-100 text-red-700',
  Malay: 'bg-green-100 text-green-700',
  International: 'bg-purple-100 text-purple-700',
  Other: 'bg-gray-100 text-gray-700',
};

export default function MealCard({ meal, onOrder, ordering }) {
  const [imgError, setImgError] = useState(false);
  const stallColor = STALL_COLORS[meal.stall] || STALL_COLORS.Other;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden flex flex-col">
      {/* Image */}
      <div className="w-full h-36 bg-gray-100 flex-shrink-0">
        {meal.imageUrl && !imgError ? (
          <img
            src={meal.imageUrl}
            alt={meal.name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 21h18M3.75 3h16.5M4.5 3v18m15-18v18" />
            </svg>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full self-start ${stallColor}`}>
          {meal.stall}
        </span>
        <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{meal.name}</p>
        <div className="flex items-center justify-between mt-auto">
          <span className="text-base font-bold text-blue-600">${meal.price.toFixed(2)}</span>
          <button
            onClick={() => onOrder(meal)}
            disabled={ordering}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm font-semibold rounded-xl disabled:opacity-50 active:bg-blue-700 transition-colors"
          >
            {ordering ? 'Ordering…' : 'Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
