import { useQuery } from '@tanstack/react-query';
import { getDashboard } from '../lib/api.js';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { format, parseISO } from 'date-fns';

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-col gap-1">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function MealBadge({ meal, label }) {
  if (!meal) return null;
  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm">
      <p className="text-xs text-gray-500 mb-2">{label}</p>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 truncate">{meal.mealName}</p>
          <p className="text-xs text-gray-500 mt-0.5">{meal.date}</p>
        </div>
        <span className="text-sm font-bold text-blue-600 flex-shrink-0">${meal.price?.toFixed(2)}</span>
      </div>
      <div className="mt-2">
        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">
          {meal.status}
        </span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-600 text-sm mb-4">{error.message}</p>
        <button onClick={refetch} className="text-blue-600 font-medium text-sm">Retry</button>
      </div>
    );
  }

  const {
    walletBalance = 0,
    todaysMeal,
    upcomingMeals = [],
    plannedSpend = 0,
    actualSpend = 0,
    currentMonth,
  } = data || {};

  const monthLabel = currentMonth
    ? format(parseISO(`${currentMonth}-01`), 'MMMM yyyy')
    : '';

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Header */}
      <div className="pt-2">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">{monthLabel}</p>
      </div>

      {/* Wallet balance */}
      <div className="bg-blue-600 rounded-2xl p-5 text-white shadow">
        <p className="text-sm opacity-80">Wallet Balance</p>
        <p className="text-4xl font-bold mt-1">${walletBalance.toFixed(2)}</p>
      </div>

      {/* Today's meal */}
      {todaysMeal ? (
        <MealBadge meal={todaysMeal} label="Today's Meal" />
      ) : (
        <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
          <p className="text-sm text-gray-400">No meal ordered for today</p>
        </div>
      )}

      {/* Monthly stats */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Planned Spend"
          value={`$${plannedSpend.toFixed(2)}`}
          sub="On-hold orders"
        />
        <StatCard
          label="Actual Spend"
          value={`$${actualSpend.toFixed(2)}`}
          sub="Completed orders"
        />
      </div>

      {/* Upcoming meals */}
      {upcomingMeals.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-3">Upcoming Meals</h2>
          <div className="flex flex-col gap-2">
            {upcomingMeals.map((meal, i) => (
              <div key={i} className="bg-white rounded-2xl p-4 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-600 font-semibold text-sm">
                    {format(parseISO(meal.date), 'd')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{meal.mealName}</p>
                  <p className="text-xs text-gray-500">{format(parseISO(meal.date), 'EEEE, MMM d')}</p>
                </div>
                <span className="text-sm font-bold text-blue-600 flex-shrink-0">
                  ${meal.price?.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
