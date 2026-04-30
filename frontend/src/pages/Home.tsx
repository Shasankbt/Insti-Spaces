import { useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const FEATURES = [
  {
    icon: '🗂️',
    title: 'Spaces',
    description:
      'Create shared spaces for clubs, events, or any group. Upload photos and videos, organise them into folders, and control who can view or contribute.',
  },
  {
    icon: '🖼️',
    title: 'Feed & Explorer',
    description:
      'Browse uploads as a visual feed or navigate the full folder tree in Explorer. Like photos, open them in full view, and flip through with keyboard arrows.',
  },
  {
    icon: '🧹',
    title: 'Cleanup tools',
    description:
      'Trash, Duplicates, and Similars tabs let you reclaim space. Exact duplicates are detected by content hash; visually similar images are clustered by perceptual hash.',
  },
  {
    icon: '👥',
    title: 'Members & roles',
    description:
      'Invite people as viewers, contributors, moderators, or admins. Each role controls what they can upload, move, trash, or manage.',
  },
  {
    icon: '🤝',
    title: 'Friends',
    description:
      'Connect with people across your institute. Send friend requests, see mutual connections, and discover people you might know.',
  },
  {
    icon: '>_',
    title: 'Terminal',
    description:
      'A VS Code-style terminal docked at the bottom of every space. Run commands scoped to your space — handy for power users and quick operations.',
    mono: true,
  },
];

export default function Home() {
  const { user, logout, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) void navigate('/login');
  }, [user, loading, navigate]);

  const handleLogout = () => {
    logout();
    void navigate('/login');
  };

  if (loading) return <p className="home__loading">Loading…</p>;
  if (!user) return null;

  return (
    <div className="home">
      <div className="home__hero">
        <div className="home__hero-text">
          <p className="home__greeting">Hey, {user.username} 👋</p>
          <h1 className="home__title">Welcome to InstiSpace</h1>
          <p className="home__subtitle">
            Your institute's private platform for sharing photos, videos, and memories —
            organised by spaces, powered by your community.
          </p>
          <div className="home__hero-actions">
            <Link className="home__cta" to="/spaces">Browse spaces</Link>
            <button className="home__logout" onClick={handleLogout}>Log out</button>
          </div>
        </div>
        <div className="home__hero-accent" aria-hidden="true" />
      </div>

      <div className="home__section">
        <h2 className="home__section-title">What you can do</h2>
        <div className="home__features">
          {FEATURES.map((f) => (
            <div key={f.title} className="home__feature-card">
              <span className={`home__feature-icon${f.mono ? ' home__feature-icon--mono' : ''}`}>
                {f.icon}
              </span>
              <h3 className="home__feature-title">{f.title}</h3>
              <p className="home__feature-desc">{f.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="home__section home__section--tip">
        <p className="home__tip">
          <span className="home__tip-label">Tip</span>
          Open any space and press <code>Ctrl K</code> (or click the terminal icon) to launch the built-in terminal.
        </p>
      </div>
    </div>
  );
}
