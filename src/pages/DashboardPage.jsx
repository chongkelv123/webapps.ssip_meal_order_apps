import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getDashboard, cancelOrder } from '../lib/api.js';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { format, parseISO } from 'date-fns';

function SpendTile({ title, amount, sub, bgClass }) {
  return (
    <div className={`${bgClass} rounded-2xl p-4 flex-1`}>
      <p className="text-xs text-gray-500 mb-1">{title}</p>
      <p className="text-2xl font-bold text-gray-900">{amount}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

function StatusBadge({ status }) {
  const norm = status.toLowerCase().replace(/[-\s]/g, '');
  const isCompleted = norm.includes('completemp') || norm.includes('completed');
  return (
    <span
      className={`text-xs px-2 py-1 rounded font-medium text-white ${
        isCompleted ? 'bg-green-500' : 'bg-red-500'
      }`}
    >
      {status}
    </span>
  );
}

function CancelDialog({ meal, onConfirm, onDismiss, isCancelling }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
        <h2 className="text-base font-bold text-gray-900 mb-2">Cancel Order?</h2>
        <p className="text-sm text-gray-600 mb-1">{meal.mealName}</p>
        <p className="text-sm text-gray-400 mb-5">
          {format(parseISO(meal.date), 'MMMM d, yyyy')} &bull;{' '}
          {format(parseISO(meal.date), 'EEEE')}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            disabled={isCancelling}
            className="flex-1 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700"
          >
            No, Keep
          </button>
          <button
            onClick={onConfirm}
            disabled={isCancelling}
            className="flex-1 py-2 rounded-xl bg-red-500 text-white text-sm font-medium disabled:opacity-50"
          >
            {isCancelling ? 'Cancelling…' : 'Yes, Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [cancelTarget, setCancelTarget] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
  });

  const { mutate: doCancel, isPending: isCancelling } = useMutation({
    mutationFn: cancelOrder,
    onSuccess: () => {
      setCancelTarget(null);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
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
        <button onClick={refetch} className="text-blue-600 font-medium text-sm">
          Retry
        </button>
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
    <>
      <div className="p-4 flex flex-col gap-4">
        {/* Header */}
        <div className="pt-2">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-blue-500">{monthLabel}</p>
        </div>

        {/* Spend tiles — top, like Android */}
        <div className="flex gap-3">
          <SpendTile
            title="Planned Spend"
            amount={`$${plannedSpend.toFixed(2)}`}
            sub="Orders On Hold"
            bgClass="bg-blue-50"
          />
          <SpendTile
            title="Actual Spend"
            amount={`$${actualSpend.toFixed(2)}`}
            sub="Completed Orders"
            bgClass="bg-green-50"
          />
        </div>

        {/* Wallet Balance — yellow, like Android */}
        <div className="bg-yellow-100 rounded-2xl p-5">
          <p className="text-sm text-gray-600">Wallet Balance</p>
          <p className="text-4xl font-bold text-gray-900 mt-1">${walletBalance.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">Available Funds</p>
        </div>

        {/* Today's Meal */}
        {todaysMeal ? (
          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-900 mb-2">Today's Meal</p>
            <p className="font-semibold text-gray-900">{todaysMeal.mealName}</p>
            <p className="text-xs text-gray-500 mt-0.5">${todaysMeal.price?.toFixed(2)}</p>
            <div className="mt-2">
              <StatusBadge status={todaysMeal.status} />
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
            <p className="text-sm text-gray-400">No meal ordered for today</p>
          </div>
        )}

        {/* Upcoming Meals */}
        {upcomingMeals.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-gray-900 mb-3">
              Upcoming Meals ({upcomingMeals.length})
            </h2>
            <div className="flex flex-col gap-2">
              {upcomingMeals.map((meal, i) => (
                <div key={i} className="bg-gray-100 rounded-2xl p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-blue-600 mb-0.5">
                      {format(parseISO(meal.date), 'MMMM d')} &bull;{' '}
                      {format(parseISO(meal.date), 'EEEE')}
                    </p>
                    <p className="text-sm font-semibold text-gray-900 truncate">{meal.mealName}</p>
                    <p className="text-xs text-gray-500">${meal.price?.toFixed(2)}</p>
                  </div>
                  {meal.cancelUrl && (
                    <button
                      onClick={() => setCancelTarget(meal)}
                      className="flex-shrink-0 flex items-center gap-1 border border-gray-400 rounded-full px-3 py-1.5 text-xs font-medium text-gray-700"
                    >
                      ✕ Cancel
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Cancel confirmation dialog */}
      {cancelTarget && (
        <CancelDialog
          meal={cancelTarget}
          isCancelling={isCancelling}
          onConfirm={() => doCancel(cancelTarget.cancelUrl)}
          onDismiss={() => setCancelTarget(null)}
        />
      )}
    </>
  );
}
