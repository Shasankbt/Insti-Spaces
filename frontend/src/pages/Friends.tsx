import { useEffect, useRef, useState, useCallback } from 'react';
import useRequireAuth from '../hooks/useRequireAuth';
import { createFriendRequest, searchUsers } from '../Api';
import { useDeltaSync } from '../hooks/useDeltaSync';
import { POLL_INTERVAL } from '../constants';
import type { Friend, UserSearchResult } from '../types';

export default function Friends() {
  const { user, token, loading: authLoading, isAuthenticated } = useRequireAuth();

  const [activeTab, setActiveTab] = useState<'friends' | 'search'>('friends');

  // --- My Friends (delta sync) ---
  const {
    data: friends,
    loading: friendsLoading,
    error: friendsError,
  } = useDeltaSync<Friend>('http://localhost:3000/friends', {
    token,
    interval: POLL_INTERVAL,
    pause: !isAuthenticated || activeTab !== 'friends',
  });

  // --- Search state ---
  const [prefix, setPrefix] = useState('');
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const lastPrefixRef = useRef<string | null>(null);

  const refreshSearch = useCallback(
    async (searchPrefix: string | null) => {
      if (!searchPrefix || !token) return;
      try {
        const res = await searchUsers({ prefix: searchPrefix, token });
        setResults((res.data as { users?: UserSearchResult[] }).users ?? []);
      } catch {
        // silent — don't overwrite searchError on background poll
      }
    },
    [token],
  );

  useEffect(() => {
    if (!user || !token || activeTab !== 'search') return;
    const interval = setInterval(() => void refreshSearch(lastPrefixRef.current), POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [activeTab, user, token, refreshSearch]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearchError(null);
    const clean = prefix.trim();
    if (!clean) {
      setResults([]);
      lastPrefixRef.current = null;
      return;
    }
    try {
      setLoading(true);
      const res = await searchUsers({ prefix: clean, token: token! });
      setResults((res.data as { users?: UserSearchResult[] }).users ?? []);
      lastPrefixRef.current = clean;
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setSearchError(apiErr?.error ?? 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (toUserId: number) => {
    setSearchError(null);
    try {
      setAddingId(toUserId);
      await createFriendRequest({ toUserId, token: token! });
      setResults((prev) =>
        prev.map((u) => (u.id === toUserId ? { ...u, relationship: 'pending' as const } : u)),
      );
    } catch (err: unknown) {
      const apiErr = (err as { response?: { data?: { error?: string } } }).response?.data;
      setSearchError(apiErr?.error ?? 'Failed to send friend request');
    } finally {
      setAddingId(null);
    }
  };

  if (authLoading) return <p className="add-friends__empty">Loading…</p>;
  if (!isAuthenticated) return null;

  return (
    <div className="add-friends">
      <div className="add-friends__tabs">
        <button
          className={`add-friends__tab ${activeTab === 'friends' ? 'add-friends__tab--active' : ''}`}
          onClick={() => setActiveTab('friends')}
        >
          My Friends
        </button>
        <button
          className={`add-friends__tab ${activeTab === 'search' ? 'add-friends__tab--active' : ''}`}
          onClick={() => setActiveTab('search')}
        >
          Add Friends
        </button>
      </div>

      {activeTab === 'friends' && (
        <div className="add-friends__panel">
          {friendsLoading && <p className="add-friends__empty">Loading…</p>}
          {friendsError && <p className="add-friends__error">{friendsError}</p>}
          {!friendsLoading && !friendsError && friends.length === 0 && (
            <p className="add-friends__empty">You have no friends yet. Search and add some!</p>
          )}
          {friends.length > 0 && (
            <div className="add-friends__list">
              {friends.map((f) => (
                <div key={f.id} className="add-friends__user-card">
                  <div>
                    <div className="add-friends__username">{f.username}</div>
                    <div className="add-friends__status">Friends</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'search' && (
        <div className="add-friends__panel">
          <form onSubmit={(e) => void handleSearch(e)} className="add-friends__form">
            <input
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="Search username prefix (e.g. 'ni')"
              className="add-friends__input"
            />
            <button type="submit" disabled={loading}>
              {loading ? 'Searching…' : 'Search'}
            </button>
          </form>
          {searchError && <p className="add-friends__error">{searchError}</p>}
          <div className="add-friends__results">
            {results.length === 0 && prefix.trim() && !loading ? (
              <p className="add-friends__empty">No users found.</p>
            ) : null}
            {results.length > 0 && (
              <div className="add-friends__list">
                {results.map((u) => (
                  <div key={u.id} className="add-friends__user-card">
                    <div>
                      <div className="add-friends__username">{u.username}</div>
                      {u.relationship === 'friends' && (
                        <div className="add-friends__status">Friends</div>
                      )}
                      {u.relationship === 'pending' && (
                        <div className="add-friends__status">Request pending</div>
                      )}
                    </div>
                    {u.relationship === 'none' && (
                      <button onClick={() => void handleAdd(u.id)} disabled={addingId === u.id}>
                        {addingId === u.id ? 'Adding…' : 'Add'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
