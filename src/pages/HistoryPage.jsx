import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getOrders } from '../lib/api.js';
import OrderRow from '../components/OrderRow.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';

export default function HistoryPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [allOrders, setAllOrders] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['orders', 1],
    queryFn: () => getOrders(1),
    staleTime: 0,
  });

  useEffect(() => {
    if (data) {
      setAllOrders(data.orders || []);
      setHasMore(data.hasNextPage ?? false);
      setPage(1);
    }
  }, [data]);

  async function loadMore() {
    setLoadingMore(true);
    const nextPage = page + 1;
    try {
      const data = await getOrders(nextPage);
      setAllOrders((prev) => [...prev, ...(data.orders || [])]);
      setHasMore(data.hasNextPage ?? false);
      setPage(nextPage);
    } catch (err) {
      // handled by OrderRow error state
    } finally {
      setLoadingMore(false);
    }
  }

  function handleCancelled() {
    // Refresh from page 1
    setPage(1);
    setAllOrders([]);
    setHasMore(true);
    queryClient.invalidateQueries({ queryKey: ['orders'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  }

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
        <p className="text-red-600 text-sm">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col gap-4">
      <h1 className="text-2xl font-bold text-gray-900 pt-2">Order History</h1>

      {allOrders.length === 0 && (
        <div className="text-center py-12 text-gray-400 text-sm">No orders found</div>
      )}

      <div className="flex flex-col gap-3">
        {allOrders.map((order, i) => (
          <OrderRow key={`${order.orderId}-${i}`} order={order} onCancelled={handleCancelled} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full py-3 bg-white border border-gray-200 text-gray-700 font-medium rounded-xl text-sm disabled:opacity-50 active:bg-gray-50 transition-colors"
        >
          {loadingMore ? 'Loading…' : 'Load More'}
        </button>
      )}
    </div>
  );
}
