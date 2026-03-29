import { useState } from 'react';
import { cancelOrder } from '../lib/api.js';
import { useToast } from '../hooks/useToast.jsx';

const STATUS_STYLES = {
  'on-hold': 'bg-yellow-100 text-yellow-700',
  'on hold': 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  completemp: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
  processing: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
};

function statusStyle(status) {
  const key = status.toLowerCase().replace(/-/g, ' ');
  return STATUS_STYLES[key] || 'bg-gray-100 text-gray-600';
}

function isCancellable(status) {
  const s = status.toLowerCase().replace(/[-\s]/g, '');
  return s.includes('onhold') || s.includes('processing');
}

export default function OrderRow({ order, onCancelled }) {
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (!order.cancelUrl) return;
    setCancelling(true);
    try {
      const data = await cancelOrder(order.cancelUrl);
      if (data.success) {
        toast.success('Order cancelled');
        onCancelled?.();
      } else {
        toast.error('Failed to cancel order');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{order.mealName}</p>
          <p className="text-xs text-gray-500">{order.date}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full flex-shrink-0 ${statusStyle(order.status)}`}>
          {order.status}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-blue-600">${order.price?.toFixed(2)}</span>
        {isCancellable(order.status) && order.cancelUrl && (
          <button
            onClick={handleCancel}
            disabled={cancelling}
            className="text-xs text-red-600 font-medium border border-red-200 px-3 py-1 rounded-xl disabled:opacity-50 active:bg-red-50 transition-colors"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
    </div>
  );
}
